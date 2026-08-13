// 统一页面等待策略：
//   1. 导航用 domcontentloaded（不再默认 networkidle —— 它可能在 DOM 解析完成前提前满足）
//   2. 数据真正就绪由显式 waitFor（selector / state / timeoutMs）决定
const config = require('../config');
const logger = require('../utils/logger');
const { ScrapeError } = require('./errors');

/**
 * 导航到 URL 并应用 wait 策略。
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {{ waitUntil?: string, timeoutMs?: number, waitFor?: object }} [options]
 *   waitFor: { selector, state?: 'visible'|'attached'|'hidden'|'detached', timeoutMs? }
 * @returns {Promise<import('playwright').Response|null>} 主响应（可能为 null）
 */
async function navigate(page, url, options = {}) {
  const waitUntil = options.waitUntil || config.navigation.waitUntil;
  const timeoutMs = options.timeoutMs || config.navigation.timeoutMs;

  let response;
  try {
    response = await page.goto(url, { waitUntil, timeout: timeoutMs });
  } catch (err) {
    // 区分超时与其他导航错误
    const timedOut = /Timeout/i.test(String(err.message || ''));
    throw new ScrapeError(timedOut ? 'timeout' : 'navigation_error', err.message, {
      url,
      cause: err,
      retryable: true,
    });
  }

  if (options.waitFor?.selector) {
    await waitForSelector(page, options.waitFor.selector, {
      state: options.waitFor.state,
      timeoutMs: options.waitFor.timeoutMs || timeoutMs,
      url,
    });
  }

  return response;
}

/**
 * 显式等待元素出现（数据就绪判据）。
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {{ state?: string, timeoutMs?: number, url?: string }} [options]
 */
async function waitForSelector(page, selector, { state = 'visible', timeoutMs, url } = {}) {
  try {
    await page.locator(selector).first().waitFor({
      state,
      timeout: timeoutMs || config.navigation.timeoutMs,
    });
  } catch (err) {
    if (/Timeout/i.test(String(err.message || ''))) {
      throw new ScrapeError('timeout', `等待选择器超时: ${selector}`, {
        url,
        cause: err,
        retryable: true,
      });
    }
    throw err;
  }
}

/**
 * 点击翻页后等待：load 事件 + 关键元素显式等待。
 * 实测 networkidle 会在 DOM 解析完成前提前满足（分块传输时块间间隙被判为空闲），
 * 因此统一走「load + 元素等待」，见 config.navigation.waitUntil。
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} clickTarget 要点击的「下一页」元素
 * @param {{ afterSelector?: string, waitUntil?: string }} [options]
 */
async function clickAndWait(page, clickTarget, { afterSelector, waitUntil = 'load' } = {}) {
  await Promise.all([page.waitForLoadState(waitUntil), clickTarget.click()]);
  if (afterSelector) {
    await waitForSelector(page, afterSelector);
  }
}

module.exports = { navigate, waitForSelector, clickAndWait };
