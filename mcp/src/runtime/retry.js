// 指数退避重试 v2：只对 transient error 重试，带 jitter 打散重试节奏
// transient：timeout / 连接重置 / 临时网络错误 / 429 / 5xx / 导航被打断
// 不重试：selector_not_found / 401 / 403 / 404 / robots_denied / schema 错误 / 编程错误
const config = require('../config');
const logger = require('../utils/logger');
const { ScrapeError } = require('./errors');

const TRANSIENT_TYPES = new Set([
  'timeout',
  'navigation_error',
  'http_429',
  'http_5xx',
]);

// 底层 Playwright / Node 网络错误关键字
const TRANSIENT_PATTERNS = [
  /net::ERR_(CONNECTION|NAME_NOT_RESOLVED|TIMED_OUT|CONNECTION_RESET|INTERNET_DISCONNECTED)/i,
  /socket hang up/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /network.*(unreachable|down|reset)/i,
  /navigation.*(interrupted|failed)/i,
  /browser.*disconnected/i,
];

/** 判断错误是否值得重试 */
function isTransientError(error) {
  if (error instanceof ScrapeError) return TRANSIENT_TYPES.has(error.type);
  if (!error) return false;
  const message = String(error.message || '');
  return TRANSIENT_PATTERNS.some((re) => re.test(message));
}

/**
 * 包裹异步操作：仅当 shouldRetry 判定为 transient 时按指数退避重试。
 * 延迟 = min(maxDelayMs, baseDelayMs * 2^(attempt-1)) * (1 ± jitter)
 * @param {Function} fn 要执行的异步操作
 * @param {{
 *   retries?: number, baseDelayMs?: number, maxDelayMs?: number, jitter?: number,
 *   shouldRetry?: Function, label?: string,
 * }} [options]
 */
async function withRetry(
  fn,
  {
    retries = config.retry.maxRetries,
    baseDelayMs = config.retry.baseDelayMs,
    maxDelayMs = config.retry.maxDelayMs,
    jitter = config.retry.jitter,
    shouldRetry = isTransientError,
    label = 'operation',
  } = {}
) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries || !shouldRetry(err)) break;
      const base = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const spread = base * jitter;
      const delay = Math.max(0, Math.round(base - spread + Math.random() * 2 * spread));
      logger.warn(`${label} 失败（第 ${attempt}/${retries} 次），${delay}ms 后重试`, {
        error: err.message,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

module.exports = { withRetry, isTransientError };
