// 字段提取引擎：根据 extraction schema 从 DOM 提取记录
//
// schema 支持两种字段写法：
//   fields: { title: 'h3 a' }                                  -> text 类型
//   fields: { href: { selector: 'h3 a', type: 'attribute', attribute: 'href' } }
//
// 类型：
//   text        innerText（去空白）
//   attribute   读取指定 attribute（无 attribute 时报 schema 错误）
//   html        innerHTML（去空白）
//   url         attribute href 并解析为绝对 URL（基于传入 baseUrl）
//
// 可选：regex 对提取结果做捕获组/整体替换；regexReplace 指定替换串；
//       required 缺失即整条记录失败；fontDecode 过字体反爬解码。
//
// v2.2：提取改为 page.evaluate 批量读 DOM（无 locator auto-wait）。
// 原因：对无限滚动/虚拟列表/动态重渲染页面（如牛客 feed），locator 的
// auto-wait 会因元素持续抖动而永远等不到"稳定"，导致 innerText 超时。
// evaluate 直接读 DOM，一次 CDP 往返完成整卡提取，快且稳定。
const { ScrapeError } = require('./errors');
const logger = require('../utils/logger');
const { decodeText } = require('./font_decoder');

/** 规范化字段定义：字符串简写 -> 完整对象 */
function normalizeFieldSpec(name, spec) {
  if (typeof spec === 'string') return { selector: spec, type: 'text' };
  if (spec && typeof spec === 'object') {
    const type = spec.type || 'text';
    return { ...spec, selector: spec.selector, type };
  }
  throw new ScrapeError('invalid_schema', `字段 "${name}" 的 spec 必须是字符串或对象`);
}

/**
 * 页面内提取函数（会被 page.evaluate 序列化执行，无任何外部引用）。
 * @param {Element|null} root 根元素（item 卡片或 null=文档根）
 * @param {{ fieldList: Array, baseUrl: string }} args
 */
function extractInPage(root, args) {
  const out = {};
  for (const f of args.fieldList) {
    const el = f.selector ? root.querySelector(f.selector) : null;
    let v = null;
    if (el) {
      if (f.type === 'attribute' || f.type === 'url') v = el.getAttribute(f.attribute);
      else if (f.type === 'html') v = el.innerHTML;
      else v = el.innerText || '';
      if (f.type === 'url' && v) {
        try {
          v = new URL(v, args.baseUrl).href;
        } catch {
          v = null;
        }
      }
      if (f.regex && typeof v === 'string') {
        const re = new RegExp(f.regex);
        const match = re.exec(v);
        if (match) {
          v =
            f.regexReplace !== undefined
              ? v.replace(re, f.regexReplace)
              : match[1] !== undefined
                ? match[1]
                : match[0];
        } else {
          v = null;
        }
      }
      if (typeof v === 'string' && f.trim !== false) v = v.trim();
    }
    out[f.name] = v;
  }
  return out;
}

/**
 * 从页面提取一批记录。
 * @param {import('playwright').Page} page
 * @param {{
 *   fields: object, itemSelector?: string, baseUrl: string,
 * }} options
 * @returns {Promise<{ records: Array<object>, schema: object }>}
 */
async function extract(page, { fields, itemSelector, baseUrl }) {
  const fieldEntries = Object.entries(fields).map(([name, spec]) => [
    name,
    normalizeFieldSpec(name, spec),
  ]);

  // schema 推断：字段 -> 提取类型
  const schema = {};
  for (const [name, spec] of fieldEntries) schema[name] = spec.type;

  const fieldList = fieldEntries.map(([name, spec]) => ({
    name,
    selector: spec.selector,
    type: spec.type,
    attribute: spec.attribute,
    regex: spec.regex,
    regexReplace: spec.regexReplace,
    trim: spec.trim,
  }));
  const args = { fieldList, baseUrl };

  let rawRecords;
  if (itemSelector) {
    const items = page.locator(itemSelector);
    const count = await items.count();
    logger.info('提取列表元素', { itemSelector, count });
    rawRecords = [];
    for (let i = 0; i < count; i += 1) {
      rawRecords.push(await items.nth(i).evaluate(extractInPage, args));
    }
  } else {
    // 无 itemSelector：从页面根（html）提取单条记录
    // 注意：$eval 把匹配元素作为函数第一参数传入，extractInPage 签名正好匹配；
    // 不要用 page.evaluate 包一层 lambda（序列化后会丢失函数引用）
    rawRecords = [await page.$eval('html', extractInPage, args)];
  }

  // required 字段缺失 -> 整条记录失败
  for (const [i, record] of rawRecords.entries()) {
    for (const [name, spec] of fieldEntries) {
      if (spec.required && (record[name] === null || record[name] === undefined || record[name] === '')) {
        throw new ScrapeError(
          'extraction_error',
          `字段 "${name}"（${spec.selector}）提取失败（第 ${i + 1} 条记录）`
        );
      }
    }
  }

  // 字体反爬解码（canvas 渲染比对在 Node 侧执行）
  const fontFields = fieldEntries.filter(([, spec]) => spec.fontDecode);
  if (fontFields.length > 0) {
    for (const record of rawRecords) {
      for (const [name, spec] of fontFields) {
        if (typeof record[name] === 'string') {
          try {
            record[name] = await decodeText(
              page,
              record[name],
              typeof spec.fontDecode === 'string' ? spec.fontDecode : undefined
            );
          } catch (err) {
            logger.warn(`字段 "${name}" 字体解码失败，保留原文`, { error: err.message });
          }
        }
      }
    }
  }

  return { records: rawRecords, schema };
}

module.exports = { extract, extractInPage, normalizeFieldSpec };
