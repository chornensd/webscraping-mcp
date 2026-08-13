// 结构化抓取错误：类型化错误 + 每个类型的修复建议（给 Agent 看的下一步操作）
const ERROR_TYPES = [
  'navigation_error',
  'timeout',
  'selector_not_found',
  'empty_result',
  'http_403',
  'http_404',
  'http_429',
  'http_5xx',
  'robots_denied',
  'authentication_failed',
  'challenge_detected',
  'extraction_error',
  'security_denied',
  'invalid_schema',
  'unknown',
];

const SUGGESTIONS = {
  navigation_error: 'Run debug_page to inspect the current DOM and network errors.',
  timeout:
    'The page did not become ready within the timeout. Run debug_page to check if the page loads at all, then increase waitFor.timeoutMs.',
  selector_not_found:
    'Run debug_page to inspect the current DOM, then fix the selector (field or itemSelector).',
  empty_result:
    'No data matched the extraction schema. Run debug_page and verify selectors and waitFor conditions.',
  http_403:
    'The site blocks automated access. Try behavior:"human", check robots.txt, or the site may require a real browser session.',
  http_404: 'The URL may be wrong or moved. Verify the URL, then retry.',
  http_429:
    'Rate limited by the site. Retry later or use behavior:"polite" to add delays between requests.',
  http_5xx: 'Server-side error. Retry later; the site may be temporarily down.',
  robots_denied: 'The site robots.txt forbids this path. Choose a different target.',
  authentication_failed:
    'The page requires credentials. Set WEBSCRAPE_USERNAME / WEBSCRAPE_PASSWORD environment variables.',
  challenge_detected:
    'A bot challenge was detected. Retry may help; otherwise the site requires manual interaction.',
  extraction_error:
    'Field extraction failed. Check the field selectors, then run debug_page to compare with the live DOM.',
  security_denied:
    'The URL is blocked by the security policy (private network / disallowed domain). Use a public URL.',
  invalid_schema: 'The extraction schema is invalid. Check fields / itemSelector / pagination shape.',
  unknown: 'Run debug_page to inspect the page, then retry with adjusted selectors.',
};

/**
 * 类型化抓取错误。
 * 属性：
 *   type          ERROR_TYPES 之一
 *   message       人类可读信息
 *   url           目标 URL
 *   status        HTTP 状态码（如已知）
 *   cause         原始错误
 *   retryable     是否值得用 withRetry 重试（transient only）
 */
class ScrapeError extends Error {
  constructor(type, message, opts = {}) {
    super(message);
    this.name = 'ScrapeError';
    this.type = ERROR_TYPES.includes(type) ? type : 'unknown';
    this.url = opts.url;
    this.status = opts.status;
    this.cause = opts.cause;
    this.retryable = Boolean(opts.retryable);
  }

  toJSON() {
    return {
      type: this.type,
      message: this.message,
      ...(this.url ? { url: this.url } : {}),
      ...(this.status ? { status: this.status } : {}),
    };
  }
}

/** 根据 HTTP 状态码生成对应错误 */
function httpError(status, url) {
  let type = 'unknown';
  if (status === 401) type = 'authentication_failed';
  else if (status === 403) type = 'http_403';
  else if (status === 404) type = 'http_404';
  else if (status === 429) type = 'http_429';
  else if (status >= 500) type = 'http_5xx';
  return new ScrapeError(type, `HTTP ${status}`, {
    url,
    status,
    retryable: type === 'http_429' || type === 'http_5xx',
  });
}

function suggestionFor(type) {
  return SUGGESTIONS[type] || SUGGESTIONS.unknown;
}

module.exports = { ScrapeError, ERROR_TYPES, SUGGESTIONS, httpError, suggestionFor };
