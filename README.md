# webscraping-mcp

面向 Agent 的通用 Playwright Web Scraping Runtime（MCP server + 自包含 skill）。

- **`scrape_page`**：任意公开 URL + 动态 extraction schema（CSS selector 字段提取、列表提取、分页、去重、JSON/CSV、显式等待策略），无需为新网站编写 scraper
- **结构化错误**：`error.type` + `diagnostics`（matchedSelectors/截图/HTML 快照）+ `suggestion`，Agent 可自动形成「失败 → 读诊断 → debug_page → 改选择器 → 重试」闭环
- **字体反爬解码**：`fontDecode: true` 用 canvas 渲染比对还原私有区字符（中文实习招聘平台实测：职位名/薪资全解）
- **选择器推荐**：`suggest_selectors` 工具统计候选选择器的匹配数与样本文本，把「猜选择器」变成「启发式推荐」
- **动态列表兼容**：evaluate 批量读 DOM，虚拟滚动/无限列表（中文求职社区 feed 实测）不卡 locator
- **反爬分层**：完整 browser profile（UA/client hints/locale/timezone 内部一致）、stealth、behavior 模式（none/polite/human）、robots.txt 合规
- **代理池**：`PROXY_LIST` 一键开启——轮询分配、失败剔除、冷却恢复、全挂降级直连（详见下文）
- **可观测性**：指标（请求数/成功率/重试/代理状态）+ `get_scrape_health` 工具
- **安全**：SSRF 防护（内网/本机/重定向拦截）、凭据走环境变量（WEBSCRAPE_USERNAME / WEBSCRAPE_PASSWORD）
- **测试**：robots/retry/security/paginator/proxy/metrics 单测 + MCP 端到端 smoke（`npm test`）

完整文档见 [SKILL.md](SKILL.md)。

```
mcp/
├── mcp_server.js          MCP 入口：scrape_page / debug_page / scrape_books / scrape_quotes /
│                          get_scrape_health / suggest_selectors
├── src/
│   ├── browser/           Browser singleton + 完整 profile 池 + 任务级 context + 代理接入
│   ├── runtime/           通用抓取引擎（scraper/extractor/paginator/wait/retry/diagnostics/font_decoder/suggest）
│   ├── policies/          robots / security(SSRF+黑白名单) / rate_limit / behavior / proxy（代理池）
│   ├── scrapers/          示例与回归抓取器（books/quotes）
│   └── utils/             logger / output / stealth / humanize / metrics（指标）/ metrics_http（Prometheus 端点）
└── tests/                 单元测试 + MCP smoke 测试
```

## Error codes

失败响应统一结构：`{ success:false, error: { code, type, message, docUrl, url?, status? }, diagnostics, suggestion, metrics }`

| code | type | 含义 | 建议动作 |
|------|------|------|---------|
| `NAV_0001` | navigation_error | 导航失败 | debug_page 检查 DOM 与网络错误 |
| `TIM_0001` | timeout | 页面就绪超时 | 检查 riskWall；调大 waitFor.timeoutMs |
| `SEL_0001` | selector_not_found | 选择器无匹配 | debug_page + suggest_selectors 推荐选择器 |
| `EMP_0001` | empty_result | 0 条数据 | 查 riskWall / 改选择器 / allowEmpty |
| `HTTP_403` | http_403 | 会话被拒 | behavior:"human" / 换 profile / 住宅代理 |
| `HTTP_404` | http_404 | URL 错误/迁移 | 浏览器验证 URL |
| `HTTP_429` | http_429 | 限流 | 降频（polite/human）/ 换代理 |
| `HTTP_5XX` | http_5xx | 服务端错误 | 稍后重试 / 检查 IP 是否被标记 |
| `ROB_0001` | robots_denied | robots.txt 禁止 | 换目标/路径 |
| `AUTH_0001` | authentication_failed | 需要凭据 | 设置 WEBSCRAPE_USERNAME/PASSWORD |
| `CHL_0001` | challenge_detected | 验证码 | 人工过验证 / 干净代理 |
| `EXT_0001` | extraction_error | 字段提取失败 | 核对选择器 / fontDecode |
| `SEC_0001` | security_denied | 安全策略拦截 | 检查 URL / allowedDomains / blockedDomains |
| `SCH_0001` | invalid_schema | schema 非法 | 检查 fields/itemSelector/pagination |
| `UNK_0001` | unknown | 未知 | debug_page + get_scrape_health |

## Environment variables

| 变量 | 默认 | 作用 |
|------|------|------|
| `PROXY_LIST` | 空（直连） | 代理池，逗号分隔 `scheme://user:pass@host:port` |
| `SCRAPING_PROXY_MAX_FAILURES` | 3 | 代理连续失败剔除阈值 |
| `SCRAPING_PROXY_COOLDOWN_MS` | 60000 | 代理剔除冷却时长 |
| `SCRAPING_CHANNEL` | chrome | 浏览器渠道（容器内用 chromium） |
| `SCRAPING_BLOCKED_DOMAINS` | 空 | 域名黑名单，逗号分隔（命中即拦，子域通配） |
| `SCRAPING_DISABLE_TOOLS` | 空 | 禁用的 MCP 工具名，逗号分隔（最小权限） |
| `SCRAPING_METRICS_PORT` | 0（关闭） | Prometheus 指标端点端口（仅绑定 127.0.0.1） |
| `SCRAPING_RATE_LIMIT` | 1 | 置 0 关闭限速 |
| `SCRAPING_RATE` / `SCRAPING_BURST` | 1 / 5 | 限速参数（policies/rate_limit.js） |
| `SCRAPING_MAX_RETRIES` | 3 | 重试次数 |
| `SCRAPING_RETRY_BASE_MS` | 1000 | 退避基数 |
| `WEBSCRAPE_USERNAME` / `WEBSCRAPE_PASSWORD` | 演示凭据 | 登录凭据 |
| `LOG_TO_STDERR` | 1（MCP 模式） | 日志强制走 stderr（stdout 只允许协议） |
| `LOG_FORMAT` | 文本 | `json` = 纯 JSON 日志行（可接入日志系统） |

## 真实网站测试声明

本项目在**多个真实生产网站**（国际 + 国内，覆盖不同反爬强度）上验证过，而不只是沙盒目标。
具体目标站名按约定不在此写明。验证结论：

- 中等反爬站点：stealth 指纹检查全部通过（无验证墙触发），限流不拖累单次任务，
  JS 密集型 SPA（异步渲染、滚动触发加载）结构化抓取全链路可用
- 部分站点有 IP/会话层风控（验证墙或静默空响应）——与 stealth 无关，由
  `debug_page` 的 `riskWall` / `emptyResponse` 字段自动识别，配合 `PROXY_LIST`
  代理池或人工验证解决
- 少量站点使用会话签名 API / 动态字体混淆，记录为已知限制而非绕过
- 所有测试均为低频、公开页面访问：无验证码破解、无签名破解、无个人信息采集

## 快速开始

```powershell
cd mcp
npm install          # playwright + MCP SDK（复用系统 Chrome，无需下载 Chromium）
npm test             # 单测 + smoke 测试
node test_mcp.js scrape_page '{"url":"https://books.toscrape.com/","itemSelector":"article.product_pod","fields":{"title":"h3 a","price":".price_color"}}'
```

---

# webscraping-mcp (English)

A generic, agent-oriented **Playwright Web Scraping Runtime** — MCP server + self-contained skill. Point it at any public URL with a dynamic extraction schema; no per-site scraper code required.

## Highlights

- **`scrape_page`**: any public URL + dynamic extraction schema — CSS-selector field extraction, list extraction, pagination, deduplication, JSON/CSV output, explicit wait strategy (`waitFor`), behavior modes, profile selection
- **Structured errors**: `error.type` (15 typed errors) + `diagnostics` (matchedSelectors / screenshot / HTML snapshot / text sample) + `suggestion`, enabling the agent loop: *scrape → failure → read diagnostics → debug_page → fix selector → retry*
- **Font-obfuscation decoding**: `fontDecode: true` recovers private-use-area characters via canvas render matching (field-tested on a Chinese internship platform: job titles & salaries fully decoded)
- **Selector suggestion**: `suggest_selectors` counts candidate-selector matches with sample text — replaces guess-and-check schema building with heuristic recommendation
- **Dynamic-list friendly**: extraction reads the DOM via batched `evaluate` calls — no locator auto-wait, so virtual-scrolled / infinite feeds (field-tested on a Chinese Q&A community) don't hang
- **Layered anti-detection**: complete browser profiles (UA + Client Hints + locale + timezone + viewport + platform internally consistent), stealth injection, behavior modes (`none` / `polite` / `human`), robots.txt compliance
- **Proxy pool**: enable with `PROXY_LIST` — round-robin rotation, failure ejection, cooldown recovery, fallback to direct connection
- **Observability**: metrics (requests / success rate / retries / proxy state) + `get_scrape_health` tool
- **Security**: SSRF protection (private networks / localhost / redirect interception), credentials via environment variables (`WEBSCRAPE_USERNAME` / `WEBSCRAPE_PASSWORD`)
- **Testing**: unit tests (robots / retry / security / paginator / proxy / metrics) + MCP end-to-end smoke tests — `npm test`

Full documentation (Chinese, incl.

```
mcp/
├── mcp_server.js          MCP entry: scrape_page / debug_page / scrape_books / scrape_quotes
├── src/
│   ├── browser/           Browser singleton + profile pool + per-task context
│   ├── runtime/           Scraping engine (scraper/extractor/paginator/wait/retry/diagnostics/font_decoder)
│   ├── policies/          robots / security (SSRF) / rate_limit / behavior
│   ├── scrapers/          Example & regression scrapers (books/quotes)
│   └── utils/             logger / output / stealth / humanize
└── tests/                 Unit tests + MCP smoke tests
```

## Quick start

```powershell
cd mcp
npm install          # playwright + MCP SDK (reuses system Chrome, no Chromium download)
npm test             # unit + smoke tests
node test_mcp.js scrape_page '{"url":"https://books.toscrape.com/","itemSelector":"article.product_pod","fields":{"title":"h3 a","price":".price_color"}}'
```

## Real-world testing

This project is validated against **real production websites** (international + China-based,
covering multiple anti-bot tiers), not just sandbox targets. Specific target names are
intentionally omitted. What that proved:

- Stealth passes fingerprint checks on sites with medium-to-strong bot detection
  (no CAPTCHA walls triggered)
- Rate limiting keeps single tasks fast while bounding request frequency
- Structured scraping works end-to-end on JS-heavy SPAs (async rendering, scroll-triggered loading)
- Some platforms defend with IP/session-level controls (validation walls or silently empty
  responses) — unrelated to stealth; `debug_page` surfaces these via `riskWall` / `emptyResponse`,
  resolvable with the `PROXY_LIST` proxy pool or manual validation
- Session-signed APIs and font-based obfuscation on a few platforms are documented as known
  limitations rather than bypassed
- All testing was low-volume, public-page access only — no CAPTCHA solving, no signature
  cracking, no personal data collection

## scrape_page example

```json
{
  "url": "https://books.toscrape.com/",
  "itemSelector": "article.product_pod",
  "fields": {
    "title": "h3 a",
    "price": ".price_color",
    "href": { "selector": "h3 a", "type": "url", "attribute": "href" },
    "salary": { "selector": ".day", "fontDecode": true }
  },
  "waitFor": { "selector": "article.product_pod", "timeoutMs": 10000 },
  "pagination": { "nextSelector": "li.next a", "maxPages": 5 },
  "format": "json"
}
```

Result contract (success): `{ success, count, pages, durationMs, file, format, sample, stats: {duplicates, failedPages}, schema }`
Result contract (failure): `{ success: false, error: {type, message, url, status}, diagnostics, suggestion }`

