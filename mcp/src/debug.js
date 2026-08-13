// 选择器调试工具：打开任意 URL，截图 + 收集页面 JS/网络错误 + 导出页面文本
// 用途：目标站点选择器失效、页面报错时，用本工具留下现场证据
// v2.1：调试逻辑基于传入的 page（context 由调用方管理，避免双 context）
const path = require('path');
const fs = require('fs');
const config = require('./config');
const logger = require('./utils/logger');
const { getBrowser } = require('./browser/browser_manager');
const { createTaskContext, closeTaskContext } = require('./browser/context');
const { resolveProfile } = require('./browser/profiles');
const { validateUrl } = require('./policies/security');
const { ScrapeError } = require('./runtime/errors');
const { navigate } = require('./runtime/wait');

/**
 * 在给定 page 上执行调试（不管理 context 生命周期，MCP 调用走这里）。
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {number} [waitMs]
 * @returns {Promise<object>} { title, errors, screenshotPath, textPath, fingerprint }
 */
async function debugPageInPage(page, url, waitMs = 3000) {
  await validateUrl(url);
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('requestfailed', (req) =>
    errors.push(`requestfailed: ${req.url()} (${req.failure()?.errorText || 'unknown'})`)
  );

  logger.info('打开页面', { url });
  await navigate(page, url, { waitUntil: config.navigation.debugWaitUntil });
  await page.waitForTimeout(waitMs);

  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').innerText().catch(() => '');

  // 指纹检测：验证 stealth 是否生效，以及当前暴露的自动化特征
  const fingerprint = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    webdriver: navigator.webdriver,
    languages: navigator.languages,
    plugins: navigator.plugins.length,
    hardwareConcurrency: navigator.hardwareConcurrency,
    chrome: typeof window.chrome,
    platform: navigator.platform,
  }));
  logger.info('指纹检测（webdriver 应为 undefined，否则 stealth 未生效）', fingerprint);

  fs.mkdirSync(config.debugDir, { recursive: true });
  const base = path.join(config.debugDir, `debug_${Date.now()}`);
  const screenshotPath = `${base}.png`;
  const textPath = `${base}.txt`;
  const errorPath = `${base}.errors.json`;

  await page.screenshot({ path: screenshotPath, fullPage: true });
  fs.writeFileSync(textPath, bodyText, 'utf8');
  fs.writeFileSync(errorPath, JSON.stringify(errors, null, 2), 'utf8');

  logger.info('调试现场已保存', {
    title,
    screenshot: screenshotPath,
    text: textPath,
    errors: `${errors.length} 条`,
  });

  return { title, errors, screenshotPath, textPath, fingerprint };
}

/**
 * 完整调试入口：校验 URL、创建 context、执行调试、清理（CLI 用）。
 * @param {string} url
 * @param {number} [waitMs]
 * @param {string} [profileName] 浏览器身份（browser/profiles.js 中的名称）
 */
async function debugPage(url, waitMs = 3000, profileName) {
  await validateUrl(url);
  const browser = await getBrowser();
  const profile = profileName ? resolveProfile(profileName) : undefined;
  const { context, page, profile: usedProfile } = await createTaskContext(browser, { profile });
  try {
    logger.info('调试身份', { profile: usedProfile.name });
    return await debugPageInPage(page, url, waitMs);
  } catch (err) {
    if (err instanceof ScrapeError) throw err;
    throw new ScrapeError('navigation_error', err.message, { url, cause: err });
  } finally {
    await closeTaskContext({ context });
  }
}

module.exports = { debugPage, debugPageInPage };

// 直接运行：node src/debug.js <url> [waitMs] [profileName]
if (require.main === module) {
  const url = process.argv[2] || config.targets.books;
  const waitMs = Number(process.argv[3] || 3000);
  const profileName = process.argv[4];
  debugPage(url, waitMs, profileName).catch((err) => {
    logger.error('调试失败', { error: err.message });
    process.exitCode = 1;
  });
}
