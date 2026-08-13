// 反检测：隐藏浏览器自动化特征，让站点难以区分爬虫与真人
// 原理：addInitScript 会在页面任何脚本执行前注入，伪装代码先于站点脚本生效
// v2：语言列表与 platform 来自完整 browser profile，保证内部一致
const logger = require('./logger');

/**
 * 生成反检测初始化脚本。
 * 覆盖常见检测点：
 * - navigator.webdriver：最经典的自动化特征，置为 undefined
 * - window.chrome：headless 构建常缺失此对象
 * - navigator.plugins / navigator.languages：空数组是自动化特征
 * - navigator.permissions：自动化浏览器常缺失 notifications 权限
 * - navigator.platform / userAgent：与 profile 对齐
 *
 * 未覆盖（需要真实环境数据，留作扩展点）：
 * - WebGL vendor/renderer 伪装
 * - canvas 指纹
 * - 音频指纹
 * @param {object} [profile] browser/profiles.js 中的完整 profile
 */
function buildStealthScript(profile = {}) {
  const languages = JSON.stringify(profile.languages || ['en-US', 'en']);
  const platform = JSON.stringify(profile.platform || 'Win32');
  const ua = profile.userAgent || '';
  return `
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = window.chrome || { runtime: {} };
    Object.defineProperty(navigator, 'languages', { get: () => ${languages} });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'platform', { get: () => ${platform} });
    const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    }
    ${ua ? `Object.defineProperty(navigator, 'userAgent', { get: () => ${JSON.stringify(ua)} });` : ''}
  `;
}

/**
 * 对浏览器上下文注入反检测脚本。
 * @param {import('playwright').BrowserContext} context
 * @param {object} [profile] 完整 browser profile（语言/platform/UA 与其保持一致）
 */
function applyStealth(context, profile) {
  context.addInitScript(buildStealthScript(profile));
  logger.info('已注入反检测脚本（webdriver/chrome/plugins/languages/permissions/platform）', {
    profile: profile?.name,
  });
  return context;
}

module.exports = { applyStealth, buildStealthScript };
