// 任务级 BrowserContext：每个任务创建独立 context（cookies/session 隔离），
// 应用完整 browser profile（UA/locale/timezone/languages/viewport/platform）+ stealth。
const config = require('../config');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const { applyStealth } = require('../utils/stealth');
const { resolveProfile } = require('./profiles');
const { installPrivateNetworkGuard } = require('../policies/security');

/**
 * 为任务创建独立 context 与页面。
 * @param {import('playwright').Browser} browser
 * @param {{ profile?: object, timeoutMs?: number }} [options]
 * @returns {Promise<{ context: import('playwright').BrowserContext, page: import('playwright').Page, profile: object }>}
 */
async function createTaskContext(browser, options = {}) {
  const profile = options.profile || resolveProfile(config.stealth.profile);

  const context = await browser.newContext({
    viewport: profile.viewport,
    locale: profile.locale,
    timezoneId: profile.timezone,
    userAgent: profile.userAgent,
    extraHTTPHeaders: {
      ...config.stealth.extraHeaders,
      // 关键：CDP 覆盖 UA 后 Chrome 不再自动发 client hints（sec-ch-ua*），
      // 与 UA 不一致会被 WAF 拒绝（如国内招聘平台返回空壳）。手工补上匹配的头。
      ...(profile.secChUa || {}),
    },
  });
  if (config.stealth.enabled) applyStealth(context, profile);
  // SSRF 防护：重定向/子请求打到内网时实时拦截（初始 URL 由 validateUrl 校验）
  installPrivateNetworkGuard(context);

  const page = await context.newPage();
  page.setDefaultTimeout(options.timeoutMs || config.navigation.timeoutMs);
  page.setDefaultNavigationTimeout(options.timeoutMs || config.navigation.timeoutMs);

  // 页面内未捕获错误与资源加载失败，记录到日志，便于事后排查
  page.on('pageerror', (err) => logger.warn('页面 JS 错误', { error: err.message }));
  page.on('requestfailed', (req) =>
    logger.warn('请求失败', { url: req.url(), error: req.failure()?.errorText })
  );
  // 指标埋点：每个文档请求记一次，成功/失败分别计数
  page.on('response', (res) => {
    if (res.request().resourceType() === 'document') {
      metrics.inc('requests');
      if (res.status() >= 400) metrics.inc('requestsFailed');
    }
  });

  logger.info('任务 context 已创建', { profile: profile.name });
  return { context, page, profile };
}

/**
 * 任务结束清理 context（cookies/session 不跨任务共享）。
 * @param {{ context: import('playwright').BrowserContext }}
 */
async function closeTaskContext({ context }) {
  if (!context) return;
  await context.close().catch((err) => logger.warn('context 关闭失败', { error: err.message }));
}

module.exports = { createTaskContext, closeTaskContext };
