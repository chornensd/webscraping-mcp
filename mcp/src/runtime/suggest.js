// 选择器推荐：输入目标 URL（可选候选选择器），返回每个候选的匹配数与样本文本。
// 把「猜选择器 → 抓 → 失败 → 再猜」变成「先探测 DOM → 选高匹配选择器 → 抓」。
const { validateUrl } = require('../policies/security');
const { navigate } = require('./wait');
const { randomDelay } = require('../utils/humanize');

// 内置候选池：覆盖常见列表容器模式（无语义类名站点也尽量命中）
const DEFAULT_CANDIDATES = [
  'article',
  'li',
  'tr',
  '.card',
  '.item',
  '[class*="item"]',
  '[class*="card"]',
  '[class*="list"] > li',
  '[class*="row"]',
  '[class*="feed"]',
  'div[class*="content"] > div',
  'h2, h3',
  'a[href]',
];

/**
 * 对候选选择器做匹配统计（count + 首个元素样本文本），按匹配数降序。
 * @param {import('playwright').Page} page
 * @param {string} url 目标 URL（会先通过 security 校验）
 * @param {{ candidates?: string[], waitForSelector?: string, maxSampleLength?: number }} [options]
 * @returns {Promise<Array<{selector: string, count: number, sample?: string, error?: string}>>}
 */
async function suggestSelectors(page, url, options = {}) {
  await validateUrl(url);
  await navigate(page, url);
  await randomDelay();

  if (options.waitForSelector) {
    await page.locator(options.waitForSelector).first().waitFor({ timeout: 15_000 }).catch(() => {});
  }

  const candidates =
    options.candidates && options.candidates.length > 0
      ? options.candidates
      : DEFAULT_CANDIDATES;
  const maxSampleLength = options.maxSampleLength || 120;

  const results = [];
  for (const selector of candidates) {
    try {
      const locator = page.locator(selector);
      const count = await locator.count();
      if (count === 0) {
        results.push({ selector, count: 0 });
        continue;
      }
      const sample = (
        await locator.first().innerText({ timeout: 5_000 }).catch(() => '')
      )
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, maxSampleLength);
      results.push({ selector, count, sample });
    } catch (err) {
      results.push({ selector, count: -1, error: err.message.split('\n')[0] });
    }
  }

  results.sort((a, b) => b.count - a.count);
  return results;
}

module.exports = { suggestSelectors, DEFAULT_CANDIDATES };
