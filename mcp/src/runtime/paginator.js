// 分页遍历：翻页直到没有下一页或达到 maxPages
// 等待策略统一走 runtime/wait.js（load 事件 + 关键元素等待，不依赖 networkidle）
// v2.1：内置去重（按 dedupeKeys，缺省整条记录）+ 无进展熔断
//       （连续 stallPages 页 0 新增记录 -> 提前终止，防动态站重复抓同一页）
const logger = require('../utils/logger');
const { clickAndWait } = require('./wait');
const { withRetry } = require('./retry');
const { beforePagination } = require('../policies/behavior');

/** 计算记录的去重键（undefined/null 统一为 null，保证缺失字段可比较） */
function recordKey(record, dedupeKeys) {
  if (dedupeKeys.length === 0) return JSON.stringify(record);
  return dedupeKeys.map((k) => JSON.stringify(record[k] ?? null)).join('|');
}

/**
 * 去重：返回唯一记录与重复数（保持首次出现顺序）。
 * @param {Array<object>} records
 * @param {string[]} [dedupeKeys]
 * @returns {{ unique: Array<object>, duplicates: number }}
 */
function dedupe(records, dedupeKeys = []) {
  const seen = new Set();
  const unique = [];
  let duplicates = 0;
  for (const record of records) {
    const key = recordKey(record, dedupeKeys);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    unique.push(record);
  }
  return { unique, duplicates };
}

/**
 * 遍历分页并提取每页记录（含去重与无进展熔断）。
 * @param {import('playwright').Page} page
 * @param {{
 *   extractPage: Function,      // (page) => Promise<Array<object>>
 *   nextSelector?: string,      // 没有则只抓一页
 *   maxPages?: number,
 *   waitAfterClickSelector?: string, // 翻页后等待的关键元素
 *   behaviorMode?: string,
 *   dedupeKeys?: string[],      // 去重键（缺省整条记录）
 *   stallPages?: number,        // 连续 N 页 0 新增则提前终止（默认 2）
 * }} options
 * @returns {Promise<{ records: Array<object>, pages: number, failedPages: number, duplicates: number }>}
 */
async function paginate(
  page,
  {
    extractPage,
    nextSelector,
    maxPages = 1,
    waitAfterClickSelector,
    behaviorMode,
    dedupeKeys = [],
    stallPages = 2,
  }
) {
  const all = [];
  const seen = new Set();
  let pages = 0;
  let failedPages = 0;
  let duplicates = 0;
  let consecutiveStall = 0;

  while (pages < maxPages) {
    pages += 1;
    logger.info(`抓取分页 ${pages}/${maxPages}`);
    try {
      const records = await withRetry(() => extractPage(page), {
        label: `page ${pages}`,
      });
      let added = 0;
      for (const record of records) {
        const key = recordKey(record, dedupeKeys);
        if (seen.has(key)) {
          duplicates += 1;
          continue;
        }
        seen.add(key);
        all.push(record);
        added += 1;
      }
      consecutiveStall = added === 0 ? consecutiveStall + 1 : 0;
      logger.info(`本页 ${records.length} 条，新增 ${added} 条，累计 ${all.length} 条`);
      if (consecutiveStall >= stallPages) {
        logger.info(`连续 ${stallPages} 页无新增数据，提前终止（防重复抓取）`);
        break;
      }
    } catch (err) {
      failedPages += 1;
      logger.warn(`第 ${pages} 页提取失败，跳过`, { error: err.message });
      if (nextSelector && failedPages <= 1) {
        // 第一页就失败说明选择器可能错了，直接抛出让上层做 diagnostics
        throw err;
      }
      break;
    }

    if (!nextSelector) break;

    const nextButton = page.locator(nextSelector);
    if ((await nextButton.count()) === 0) {
      logger.info('没有下一页，抓取结束');
      break;
    }

    await beforePagination(page, behaviorMode);
    await clickAndWait(page, nextButton, {
      afterSelector: waitAfterClickSelector,
    });
  }

  return { records: all, pages, failedPages, duplicates };
}

module.exports = { paginate, dedupe, recordKey };
