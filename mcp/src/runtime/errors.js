// 结构化抓取错误：类型化错误 + 稳定错误码 + 文档链接 + 可执行建议
// 每个错误类型带：
//   code     稳定机器码（SEC_0001 风格，供调用方程序化处理，不受文案变动影响）
//   docUrl   指向 README 错误码表的锚点（SKILL.md 中错误码说明）
//   suggestion 给 Agent 的具体下一步行动（可执行，不是套话）
const DOC_BASE = 'https://github.com/chornensd/webscraping-mcp/blob/main/README.md';

// type -> { code, docUrl, suggestion }
const ERROR_META = {
  navigation_error: {
    code: 'NAV_0001',
    suggestion:
      'Run debug_page on the same URL to inspect the current DOM and network errors, then retry with adjusted waitFor/selectors.',
  },
  timeout: {
    code: 'TIM_0001',
    suggestion:
      'The page did not become ready within the timeout. First check with debug_page whether the page loads at all (riskWall/emptyResponse fields will tell you if it is a bot wall, not a rendering issue). If it loads, increase waitFor.timeoutMs or wait for a later-rendered element.',
  },
  selector_not_found: {
    code: 'SEL_0001',
    suggestion:
      'Run debug_page on the same URL, then use the suggest_selectors tool to get candidate selectors matched against the live DOM before retrying.',
  },
  empty_result: {
    code: 'EMP_0001',
    suggestion:
      'No data matched the extraction schema. Run debug_page to check for a risk wall (riskWall field), then verify selectors with suggest_selectors. If the list renders on scroll, add behavior:"human" or a waitFor condition.',
  },
  http_403: {
    code: 'HTTP_403',
    suggestion:
      'The site blocks this session. Try: (1) behavior:"human" to slow down, (2) a different profile (chrome-win-zh for Chinese sites), (3) a residential proxy via PROXY_LIST if your IP is flagged.',
  },
  http_404: {
    code: 'HTTP_404',
    suggestion:
      'The URL may be wrong or moved. Verify the URL in a browser, then retry with the corrected URL.',
  },
  http_429: {
    code: 'HTTP_429',
    suggestion:
      'Rate limited. Retry later, or reduce request frequency: use behavior:"polite"/"human" (per-domain minimum interval) and consider rotating proxies via PROXY_LIST.',
  },
  http_5xx: {
    code: 'HTTP_5XX',
    suggestion:
      'Server-side error. Retry later; the site may be temporarily down. If persistent across retries, the target may be blocking your IP — check proxy options.',
  },
  robots_denied: {
    code: 'ROB_0001',
    suggestion:
      'The site robots.txt forbids this path. Choose a different target or a different path on the same domain.',
  },
  authentication_failed: {
    code: 'AUTH_0001',
    suggestion:
      'The page requires credentials. Set WEBSCRAPE_USERNAME / WEBSCRAPE_PASSWORD environment variables, or handle the login flow outside scrape_page.',
  },
  challenge_detected: {
    code: 'CHL_0001',
    suggestion:
      'A bot challenge (CAPTCHA) was detected. This is outside the tool boundary: solve it manually in a browser, reuse the session cookies, or use a residential proxy with a clean IP.',
  },
  extraction_error: {
    code: 'EXT_0001',
    suggestion:
      'Field extraction failed. Check the field selectors against the live DOM (debug_page), verify required:false on optional fields, and consider fontDecode if text looks like private-use characters.',
  },
  security_denied: {
    code: 'SEC_0001',
    suggestion:
      'URL blocked by security policy (private network / blocked domain / disallowed by whitelist). Use a public URL, or adjust security.allowedDomains / security.blockedDomains in config.',
  },
  invalid_schema: {
    code: 'SCH_0001',
    suggestion:
      'The extraction schema is invalid. Check fields / itemSelector / pagination shape against the tool schema definition.',
  },
  unknown: {
    code: 'UNK_0001',
    suggestion:
      'Run debug_page to inspect the page, then retry with adjusted selectors. If it persists, check the proxy pool state via get_scrape_health.',
  },
};

const ERROR_TYPES = Object.keys(ERROR_META);

function docUrlFor(type) {
  return `${DOC_BASE}#error-codes`;
}

/**
 * 类型化抓取错误。
 * 属性：
 *   type          ERROR_TYPES 之一（稳定标识）
 *   code          稳定机器码（SEC_0001 风格）
 *   docUrl        README 错误码文档锚点
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
    const meta = ERROR_META[this.type] || ERROR_META.unknown;
    this.code = opts.code || meta.code;
    this.docUrl = docUrlFor(this.type);
    this.url = opts.url;
    this.status = opts.status;
    this.cause = opts.cause;
    this.retryable = Boolean(opts.retryable);
  }

  toJSON() {
    return {
      code: this.code,
      type: this.type,
      message: this.message,
      docUrl: this.docUrl,
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
  const meta = ERROR_META[type] || ERROR_META.unknown;
  return meta.suggestion;
}

module.exports = { ScrapeError, ERROR_TYPES, ERROR_META, httpError, suggestionFor, docUrlFor };
