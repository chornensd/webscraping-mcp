// 代理池：轮询分配、失败剔除、冷却恢复、全挂降级直连
//
// 代理来源（按优先级）：
//   1. 环境变量 PROXY_LIST（逗号分隔，格式 scheme://user:pass@host:port）
//   2. 配置文件 proxy.list（config.js，数组）
// 未配置代理时全部直连，行为与无代理版本完全一致（所有函数可安全调用）。
//
// 与 Browser singleton 的配合（browser/browser_manager.js）：
//   - 浏览器启动时取一个可用代理；任务结束通过 reportProxyResult 上报成败
//   - 连续失败达阈值剔除该代理，并触发单例浏览器重启（下次任务自动换代理）
const config = require('../config');
const logger = require('../utils/logger');

/** 读取代理列表：环境变量优先，其次 config 文件 */
function loadProxies() {
  const fromEnv = process.env.PROXY_LIST;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return Array.isArray(config.proxy.list) ? [...config.proxy.list] : [];
}

/**
 * 创建代理池。
 * @param {string[]} [proxies] 代理 URL 列表，缺省从 env/config 加载
 * @param {{ maxFailures?: number, coolDownMs?: number }} [opts] 覆盖 config 的阈值与冷却时长
 */
function createPool(proxies, opts = {}) {
  const maxFails = opts.maxFailures ?? config.proxy.maxFailures;
  const coolMs = opts.coolDownMs ?? config.proxy.coolDownMs;
  const entries = (proxies ?? loadProxies()).map((url) => ({
    url,
    down: false,
    failCount: 0,
    coolUntil: 0,
  }));
  // 随机起点轮询，避免多个实例同时打同一个代理
  let cursor = entries.length > 0 ? Math.floor(Math.random() * entries.length) : 0;

  /**
   * 取下一个可用代理；全部失效或未配置时返回 null（调用方直连）。
   * @returns {string|null}
   */
  function getProxy() {
    if (entries.length === 0) return null;
    const now = Date.now();
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[cursor];
      cursor = (cursor + 1) % entries.length;
      // 冷却期已过则自动恢复
      if (entry.down && now >= entry.coolUntil) {
        entry.down = false;
        entry.failCount = 0;
        logger.info(`代理 ${entry.url} 冷却结束，恢复可用`);
      }
      if (!entry.down) return entry.url;
    }
    logger.warn('代理池全部失效，本次请求降级直连');
    return null;
  }

  /** 报告一次成功：清零失败计数 */
  function markSuccess(url) {
    const entry = entries.find((e) => e.url === url);
    if (entry) {
      entry.failCount = 0;
      entry.down = false;
    }
  }

  /**
   * 报告一次失败：连续失败达阈值则标记 down 并进入冷却期。
   * @returns {boolean} true = 本次失败导致该代理被剔除（调用方应切换代理/重启浏览器）
   */
  function markFailure(url) {
    const entry = entries.find((e) => e.url === url);
    if (!entry || entry.down) return false;
    entry.failCount += 1;
    if (entry.failCount >= maxFails) {
      entry.down = true;
      entry.coolUntil = Date.now() + coolMs;
      logger.warn(`代理 ${url} 连续失败 ${maxFails} 次，剔除 ${coolMs}ms`, {
        failCount: entry.failCount,
      });
      return true;
    }
    return false;
  }

  /** 池状态快照，供指标与调试 */
  function snapshot() {
    return entries.map((e) => ({
      url: e.url,
      down: e.down,
      failCount: e.failCount,
    }));
  }

  return { getProxy, markSuccess, markFailure, snapshot };
}

/** 把 "scheme://user:pass@host:port"（或 "user:pass@host:port"）转成 Playwright proxy 配置对象 */
function parseProxyUrl(url) {
  const at = url.lastIndexOf('@');
  if (at === -1) {
    return { server: url, username: undefined, password: undefined };
  }
  // 认证段在 scheme 之后（http://user:pass@host）或整串开头（user:pass@host）
  const schemeEnd = url.indexOf('://');
  const authStart = schemeEnd === -1 ? 0 : schemeEnd + 3;
  const auth = url.slice(authStart, at);
  const colon = auth.indexOf(':');
  return {
    server: url.slice(at + 1),
    username: decodeURIComponent(colon === -1 ? auth : auth.slice(0, colon)),
    password: decodeURIComponent(colon === -1 ? '' : auth.slice(colon + 1)),
  };
}

module.exports = { createPool, loadProxies, parseProxyUrl };
