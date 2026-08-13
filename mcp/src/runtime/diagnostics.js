// 失败诊断收集：把页面现场（标题/URL/截图/HTML 快照/文本样本/选择器匹配数）
// 组装成 Agent 可以直接消费的 diagnostics 对象。
// 收集过程永不抛错 —— 页面都挂了也要尽量留下现场。
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * 收集页面现场诊断信息。
 * @param {import('playwright').Page} page
 * @param {{
 *   selectors?: Array<string>,     // 要统计匹配数的选择器
 *   label?: string,                // 文件前缀（默认 page）
 * }} [options]
 * @returns {Promise<object>}
 */
async function collectDiagnostics(page, { selectors = [], label = 'page' } = {}) {
  const result = {
    pageTitle: '',
    finalUrl: '',
    status: null,
    screenshot: '',
    htmlSnapshot: '',
    textSample: '',
    matchedSelectors: {},
  };

  try {
    result.pageTitle = (await page.title()).slice(0, 200);
  } catch {}
  try {
    result.finalUrl = page.url();
  } catch {}
  try {
    const response = await page.request.get(result.finalUrl).catch(() => null);
    result.status = response ? response.status() : null;
  } catch {}

  const dir = config.debugDir;
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${label}_diag_${Date.now()}`);

  try {
    const screenshotPath = `${base}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    result.screenshot = screenshotPath;
  } catch {}

  try {
    const html = await page.content();
    if (html) {
      const htmlPath = `${base}.html`;
      fs.writeFileSync(htmlPath, html, 'utf8');
      result.htmlSnapshot = htmlPath;
    }
  } catch {}

  try {
    const text = await page.locator('body').innerText().catch(() => '');
    result.textSample = text.slice(0, 1500);
  } catch {}

  for (const selector of selectors) {
    try {
      result.matchedSelectors[selector] = await page.locator(selector).count();
    } catch {
      result.matchedSelectors[selector] = -1;
    }
  }

  logger.info('已收集诊断现场', {
    title: result.pageTitle,
    screenshot: result.screenshot,
    matched: result.matchedSelectors,
  });
  return result;
}

module.exports = { collectDiagnostics };
