// 引文抓取器：quotes.toscrape.com
// v2：定位为 example / regression scraper（通用能力请用 runtime/scraper.js 的 scrape_page）
// 演示：登录表单填充与提交、认证状态检测、登录失败降级（edge case 处理）、分页
const config = require('../config');
const logger = require('../utils/logger');
const { withRetry } = require('../runtime/retry');
const { clickAndWait, navigate } = require('../runtime/wait');
const { beforePagination } = require('../policies/behavior');

const SELECTORS = {
  quote: 'div.quote',
  text: 'span.text',
  author: 'small.author',
  tag: 'div.tags a.tag',
  nextButton: 'li.next a',

  // 登录表单
  usernameInput: '#username',
  passwordInput: '#password',
  submitButton: 'input[type="submit"]',
  loginError: '.alert',
  logoutLink: 'a[href="/logout"]',
};

/**
 * 尝试登录。练习站的凭据不保证有效，失败时返回原因而不是抛错。
 * @param {import('playwright').Page} page
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function tryLogin(page) {
  logger.info('尝试登录', { url: config.targets.quotesLogin });
  await navigate(page, config.targets.quotesLogin);

  await page.fill(SELECTORS.usernameInput, config.quotesCredentials.username);
  await page.fill(SELECTORS.passwordInput, config.quotesCredentials.password);
  await beforePagination(page);
  await clickAndWait(page, page.locator(SELECTORS.submitButton));

  // 判定结果：有退出链接说明登录成功；有 alert 说明凭据被拒
  const loggedOut = (await page.locator(SELECTORS.logoutLink).count()) === 0;
  if (!loggedOut) {
    logger.info('登录成功');
    return { ok: true };
  }
  const errorText = await page
    .locator(SELECTORS.loginError)
    .first()
    .innerText()
    .catch(() => '');
  return { ok: false, reason: errorText || 'unexpected login result' };
}

/**
 * 抓取当前页的所有引文。
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<object>>}
 */
async function scrapeQuotesPage(page) {
  const quotes = page.locator(SELECTORS.quote);
  const count = await quotes.count();
  const records = [];

  for (let i = 0; i < count; i += 1) {
    const quote = quotes.nth(i);
    const text = (await quote.locator(SELECTORS.text).innerText()).trim();
    const author = (await quote.locator(SELECTORS.author).innerText()).trim();
    const tagCount = await quote.locator(SELECTORS.tag).count();
    const tags = [];
    for (let t = 0; t < tagCount; t += 1) {
      tags.push((await quote.locator(SELECTORS.tag).nth(t).innerText()).trim());
    }
    records.push({ text, author, tags: tags.join('|') });
  }

  return records;
}

/**
 * 抓取引文：先尝试登录（失败降级为匿名），再翻页抓取。
 * @param {import('playwright').Page} page
 * @param {number} [maxPages]
 * @returns {Promise<{records: Array<object>, pages: number}>}
 */
async function scrapeQuotes(page, maxPages = 3) {
  const login = await withRetry(() => tryLogin(page), { label: 'quotes login' });
  if (!login.ok) {
    logger.warn('登录失败，降级为匿名抓取', { reason: login.reason });
    // 登录失败时页面停留在 /login（无引文元素），必须回到首页再匿名抓取
    await navigate(page, config.targets.quotes);
  }

  const all = [];
  let pageNumber = 0;
  while (pageNumber < maxPages) {
    pageNumber += 1;
    logger.info(`抓取引文页 ${pageNumber}`);
    const records = await withRetry(() => scrapeQuotesPage(page), {
      label: `quotes page ${pageNumber}`,
    });
    all.push(...records);
    logger.info(`本页 ${records.length} 条，累计 ${all.length} 条`);

    const nextButton = page.locator(SELECTORS.nextButton);
    if ((await nextButton.count()) === 0) break;
    await beforePagination(page);
    // 与 books 抓取器同理：不用 networkidle（可能提前满足），
    // 用 load 事件 + 关键元素等待确保页面就绪
    await clickAndWait(page, nextButton, { afterSelector: SELECTORS.quote });
  }

  return { records: all, pages: pageNumber };
}

module.exports = { scrapeQuotes, tryLogin, scrapeQuotesPage, SELECTORS };
