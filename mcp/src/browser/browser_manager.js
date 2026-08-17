// Browser singleton：浏览器进程常驻，每次任务只创建/销毁独立 BrowserContext
//
//   MCP server
//   └── Browser singleton
//       ├── Context/task A
//       ├── Context/task B
//       └── Context/task C
//
// 收益：避免每次 MCP 调用都启动/关闭 Chrome（首次启动约 1-2s）。
// 隔离：context 之间 cookies/session 天然隔离，任务结束即清理。
//
// 代理（policies/proxy.js）：配置了 PROXY_LIST 时，浏览器启动绑定一个池内代理；
// 任务失败连续达阈值会剔除该代理并重启单例，下次任务自动换代理。
const { chromium } = require('playwright');
const config = require('../config');
const logger = require('../utils/logger');
const { createPool, loadProxies, parseProxyUrl } = require('../policies/proxy');

let browserPromise = null;
let browser = null;
let shutdownHooks = [];

// 进程级代理池单例：跨任务共享失败计数与冷却状态
const proxyPool = createPool(loadProxies());

/** 带代理的浏览器启动；启动失败时标记代理失效（剔除逻辑在 reportProxyResult） */
async function launchWithProxy() {
  const proxy = proxyPool.getProxy();
  const launchOptions = {
    headless: config.browser.headless,
    channel: config.browser.channel,
    args: config.browser.launchArgs,
  };
  if (proxy) {
    launchOptions.proxy = parseProxyUrl(proxy);
    logger.info(`浏览器走代理启动：${proxy}`);
  }
  try {
    const instance = await chromium.launch(launchOptions);
    instance.__proxyUrl = proxy;
    return instance;
  } catch (err) {
    // launch 失败往往意味着代理不可达；记失败，下次尝试下一个/直连
    if (proxy) proxyPool.markFailure(proxy);
    throw err;
  }
}

/**
 * 获取浏览器实例（单例）。首次调用时启动，之后复用。
 * 崩溃/进程被关闭后自动重置单例，下次调用重新启动。
 * @returns {Promise<import('playwright').Browser>}
 */
async function getBrowser() {
  if (browser) {
    if (browser.isConnected()) return browser;
    logger.warn('浏览器连接已断开，重置单例');
    browser = null;
    browserPromise = null;
  }
  if (!browserPromise) {
    browserPromise = launchWithProxy()
      .then((instance) => {
        browser = instance;
        // 进程异常断开（崩溃/被杀）时重置单例，下次调用重新启动
        instance.on('disconnected', () => {
          if (browser === instance) {
            logger.warn('浏览器进程断开（崩溃或被关闭），单例已重置');
            browser = null;
            browserPromise = null;
          }
        });
        logger.info(`浏览器已启动（${config.browser.channel}，headless，singleton）`);
        return instance;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

/**
 * 任务结束后上报代理成败。
 * 成功清零失败计数；失败累计，达阈值剔除该代理并重启单例（下次任务自动换代理）。
 * 无代理配置或任务未绑定代理时是 no-op。
 * @param {import('playwright').Browser} browserInstance
 * @param {boolean} ok
 */
function reportProxyResult(browserInstance, ok) {
  const proxy = browserInstance && browserInstance.__proxyUrl;
  if (!proxy) return;
  if (ok) {
    proxyPool.markSuccess(proxy);
    return;
  }
  const ejected = proxyPool.markFailure(proxy);
  if (ejected) {
    logger.warn('代理被剔除，重启浏览器以切换代理');
    // 不 await：当前任务已结束，下次 getBrowser 会以新代理重建
    invalidate();
  }
}

/** 关闭当前单例（代理剔除/配置变化时强制下次任务重启） */
async function invalidate() {
  if (!browser) return;
  const instance = browser;
  browser = null;
  browserPromise = null;
  await instance.close().catch((err) => logger.warn('浏览器关闭失败', { error: err.message }));
  logger.info('浏览器单例已失效（等待下次任务重建）');
}

/**
 * 注册关闭钩子（browser_manager 自身关闭后清理）。
 * 用于防止「进程退出但 Chrome 还挂着」。
 * @param {Function} fn
 */
function onShutdown(fn) {
  shutdownHooks.push(fn);
}

/**
 * 关闭浏览器与所有 context（MCP server 退出时调用）。
 */
async function shutdown() {
  for (const hook of shutdownHooks.splice(0)) {
    try {
      await hook();
    } catch (err) {
      logger.warn('关闭钩子执行失败', { error: err.message });
    }
  }
  shutdownHooks = [];
  if (browser) {
    const instance = browser;
    browser = null;
    browserPromise = null;
    await instance.close().catch((err) => logger.warn('浏览器关闭失败', { error: err.message }));
    logger.info('浏览器已关闭');
  }
}

// 进程退出时尽力关闭浏览器（MCP stdio 断开 / 被 kill）
process.once('SIGINT', () => shutdown());
process.once('SIGTERM', () => shutdown());
process.stdin.once('close', () => shutdown());

module.exports = { getBrowser, shutdown, onShutdown, reportProxyResult, invalidate, proxyPool };
