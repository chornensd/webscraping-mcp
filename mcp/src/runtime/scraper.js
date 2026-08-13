// 通用页面抓取引擎（scrape_page 的核心实现）
//
// 面向 Agent：给定 URL + extraction schema，动态定义抓取目标，
// 不需要每增加一个网站就编写新的 scraper/*.js。
//
// 流程：
//   validate schema -> security(URL) -> behavior.beforeNavigation -> robots
//   -> navigate(withRetry + wait strategy) -> extract -> paginate(去重+熔断)
//   -> save output -> 结构化结果
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { ScrapeError, httpError } = require('./errors');
const { withRetry } = require('./retry');
const { validateUrl } = require('../policies/security');
const { checkRobots } = require('../policies/robots');
const { beforeNavigation } = require('../policies/behavior');
const { navigate } = require('./wait');
const { extract } = require('./extractor');
const { paginate, dedupe } = require('./paginator');
const { saveJSON, saveCSV } = require('../utils/output');

const CHALLENGE_PATTERNS = [/captcha/i, /challenge/i, /access denied/i, /attention required/i];

/** 校验并规范化 scrape_page 参数 */
function normalizeParams(params) {
  const { url, fields, itemSelector, pagination } = params;
  if (!url) throw new ScrapeError('invalid_schema', '缺少必填参数 url');
  if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
    throw new ScrapeError('invalid_schema', '缺少必填参数 fields（至少一个字段）');
  }
  if (pagination) {
    if (typeof pagination !== 'object') {
      throw new ScrapeError('invalid_schema', 'pagination 必须是对象');
    }
    const maxPages = pagination.maxPages == null ? 1 : Number(pagination.maxPages);
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
      throw new ScrapeError('invalid_schema', 'pagination.maxPages 必须是 1-100 的整数');
    }
  }
  if (params.format && !['json', 'csv'].includes(params.format)) {
    throw new ScrapeError('invalid_schema', `不支持的格式: ${params.format}（可选 json/csv）`);
  }
  return { ...params, dedupeKeys: params.dedupeKeys || [] };
}

/** 推断结果文件名：<host>_<timestamp>_<随机后缀>.<ext>（防同毫秒冲突） */
function outputPathFor(url, format) {
  let host = 'scrape';
  try {
    host = new URL(url).hostname.replace(/[^a-z0-9-]/gi, '_');
  } catch {}
  const suffix = Math.random().toString(36).slice(2, 6);
  return path.join(config.outputDir, `${host}_${Date.now()}_${suffix}.${format}`);
}

/** 轻量 challenge 检测（title 启发式） */
function detectChallenge(pageTitle, pageUrl) {
  const haystack = `${pageTitle || ''} ${pageUrl || ''}`;
  return CHALLENGE_PATTERNS.some((re) => re.test(haystack));
}

/**
 * 执行一次通用抓取。
 * @param {import('playwright').Page} page 已就绪的页面（调用方管理 context 生命周期）
 * @param {object} params
 *   url        必填。目标 URL
 *   fields     必填。{ 字段名: selector | {selector, type?, attribute?, regex?, required?} }
 *   itemSelector 可选。列表元素选择器；缺省为单条记录提取
 *   waitFor    可选。{ selector, state?, timeoutMs? } 数据就绪等待
 *   pagination 可选。{ nextSelector?, maxPages? } 分页
 *   format     可选。'json' | 'csv'（默认 json）
 *   dedupeKeys 可选。去重键字段列表（缺省整条记录）
 *   maxResults 可选。结果上限
 *   behavior   可选。'none' | 'polite' | 'human'
 *   allowEmpty 可选。true 时 0 条结果不算错误（默认 false，报 empty_result）
 * @returns {Promise<object>} 结构化结果（success/count/pages/durationMs/file/format/sample/stats/schema）
 */
async function scrapePage(page, params) {
  const p = normalizeParams(params);
  const startedAt = Date.now();

  await validateUrl(p.url);

  // robots 检查（内部会自己导航到 robots.txt，必须先于目标页 goto）
  await beforeNavigation(p.url, p.behavior);
  const allowed = await checkRobots(page, p.url);
  if (!allowed) {
    throw new ScrapeError('robots_denied', `robots.txt 禁止抓取 ${p.url}`, { url: p.url });
  }

  // 导航 + 等待策略：domcontentloaded + 显式 waitFor（不依赖 networkidle）。
  // 导航失败（timeout/网络错误）属 transient，由 withRetry 自动重试。
  await beforeNavigation(p.url, p.behavior);
  const response = await withRetry(() => navigate(page, p.url, { waitFor: p.waitFor }), {
    label: `navigate ${p.url}`,
  });
  if (response && !response.ok()) {
    throw httpError(response.status(), p.url);
  }
  const pageTitle = await page.title().catch(() => '');
  if (detectChallenge(pageTitle, page.url())) {
    throw new ScrapeError('challenge_detected', `检测到反爬挑战页面: ${pageTitle}`, {
      url: p.url,
    });
  }

  // 提取（含分页、去重、无进展熔断）
  const fields = p.fields;
  const itemSelector = p.itemSelector;
  const pagination = p.pagination || {};
  const waitAfterClickSelector =
    p.waitFor?.selector || itemSelector || pagination.nextSelector;

  const { records, pages, failedPages, duplicates } = await paginate(page, {
    extractPage: () =>
      extract(page, { fields, itemSelector, baseUrl: page.url() }).then((r) => r.records),
    nextSelector: pagination.nextSelector,
    maxPages: pagination.maxPages || 1,
    waitAfterClickSelector,
    behaviorMode: p.behavior,
    dedupeKeys: p.dedupeKeys,
  });

  if (records.length === 0 && !p.allowEmpty) {
    throw new ScrapeError('empty_result', '没有提取到任何数据', { url: p.url });
  }
  const finalRecords = p.maxResults ? records.slice(0, p.maxResults) : records;

  // 输出
  const format = p.format || 'json';
  const filePath = outputPathFor(p.url, format);
  if (format === 'csv') {
    saveCSV(finalRecords, Object.keys(p.fields), filePath);
  } else {
    saveJSON(finalRecords, filePath);
  }

  // schema 推断（与提取类型一致）
  const schema = {};
  for (const [name, spec] of Object.entries(fields)) {
    schema[name] = typeof spec === 'string' ? 'text' : spec.type || 'text';
  }

  logger.info('抓取完成', { count: finalRecords.length, pages, duplicates, file: filePath });
  return {
    success: true,
    count: finalRecords.length,
    pages,
    durationMs: Date.now() - startedAt,
    file: filePath,
    format,
    sample: finalRecords.slice(0, 3),
    stats: { duplicates, failedPages },
    schema,
  };
}

module.exports = { scrapePage, normalizeParams, dedupe };
