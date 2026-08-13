// 书籍列表抓取器：books.toscrape.com
// v2：定位为 example / regression scraper（通用能力请用 runtime/scraper.js 的 scrape_page）
// 演示：分页遍历、选择器解析、按链接去重、翻页 edge case（最后一页无 next）
const config = require('../config');
const logger = require('../utils/logger');
const { withRetry } = require('../runtime/retry');
const { clickAndWait } = require('../runtime/wait');
const { beforePagination } = require('../policies/behavior');

// 选择器集中定义：站点改版时只需改这里，不用翻抓取逻辑
const SELECTORS = {
  bookCard: 'article.product_pod',
  titleLink: 'h3 a',
  price: '.price_color',
  stock: '.availability',
  rating: 'p.star-rating',
  nextButton: 'li.next a',
};

/**
 * 解析评分：class 形如 "star-rating Three" -> "Three"
 * @param {string} className
 * @returns {string}
 */
function parseRating(className) {
  const match = /star-rating\s+(\w+)/.exec(className || '');
  return match ? match[1] : '';
}

/**
 * 抓取当前页的所有书籍卡片。
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<object>>}
 */
async function scrapeBooksPage(page) {
  const cards = page.locator(SELECTORS.bookCard);
  const count = await cards.count();
  const records = [];

  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    const href = await card.locator(SELECTORS.titleLink).getAttribute('href');
    const title =
      (await card.locator(SELECTORS.titleLink).getAttribute('title')) ||
      (await card.locator(SELECTORS.titleLink).innerText()).trim();
    const price = (await card.locator(SELECTORS.price).innerText()).trim();
    const stock = (await card.locator(SELECTORS.stock).innerText()).trim();
    const rating = parseRating(
      await card.locator(SELECTORS.rating).getAttribute('class')
    );
    records.push({ title, price, stock, rating, href });
  }

  return records;
}

/**
 * 从首页开始翻页抓取，最多 maxPages 页；按 href 去重。
 * @param {import('playwright').Page} page
 * @param {number} [maxPages]
 * @returns {Promise<{records: Array<object>, pages: number}>}
 */
async function scrapeBooks(page, maxPages = 5) {
  const all = [];
  const seen = new Set();
  let pageNumber = 0;

  while (pageNumber < maxPages) {
    pageNumber += 1;
    logger.info(`抓取书籍列表页 ${pageNumber}`);

    const records = await withRetry(() => scrapeBooksPage(page), {
      label: `books page ${pageNumber}`,
    });

    let added = 0;
    for (const record of records) {
      if (!seen.has(record.href)) {
        seen.add(record.href);
        all.push(record);
        added += 1;
      }
    }
    logger.info(`本页 ${records.length} 条，新增 ${added} 条，累计 ${all.length} 条`);

    // 最后一页没有 next 按钮，正常结束
    const nextButton = page.locator(SELECTORS.nextButton);
    if ((await nextButton.count()) === 0) {
      logger.info('没有下一页，抓取结束');
      break;
    }

    // 翻页行为：由 behavior 模式（none/polite/human）决定
    await beforePagination(page);

    // 等待导航完成再继续，避免对半加载的页面取数。
    // 实测 networkidle 会在 DOM 解析完成前提前满足（20 张卡片只解析出 12），
    // 因此改用 load 事件 + 显式等待关键元素出现。
    await clickAndWait(page, nextButton, { afterSelector: SELECTORS.bookCard });
  }

  return { records: all, pages: pageNumber };
}

module.exports = { scrapeBooks, scrapeBooksPage, SELECTORS };
