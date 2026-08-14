# webscraping-mcp

面向 Agent 的通用 Playwright Web Scraping Runtime（MCP server + 自包含 skill）。

- **`scrape_page`**：任意公开 URL + 动态 extraction schema（CSS selector 字段提取、列表提取、分页、去重、JSON/CSV、显式等待策略），无需为新网站编写 scraper
- **结构化错误**：`error.type` + `diagnostics`（matchedSelectors/截图/HTML 快照）+ `suggestion`，Agent 可自动形成「失败 → 读诊断 → debug_page → 改选择器 → 重试」闭环
- **字体反爬解码**：`fontDecode: true` 用 canvas 渲染比对还原私有区字符（实测实习僧职位名/薪资全解）
- **动态列表兼容**：evaluate 批量读 DOM，虚拟滚动/无限列表（实测牛客 feed）不卡 locator
- **反爬分层**：完整 browser profile（UA/client hints/locale/timezone 内部一致）、stealth、behavior 模式（none/polite/human）、robots.txt 合规
- **安全**：SSRF 防护（内网/本机/重定向拦截）、凭据走环境变量（WEBSCRAPE_USERNAME / WEBSCRAPE_PASSWORD）
- **测试**：robots/retry/security/paginator 单测 + MCP 端到端 smoke（76 例，`npm test`）

完整文档见 [SKILL.md](SKILL.md)。

```
mcp/
├── mcp_server.js          MCP 入口：scrape_page / debug_page / scrape_books / scrape_quotes
├── src/
│   ├── browser/           Browser singleton + 完整 profile 池 + 任务级 context
│   ├── runtime/           通用抓取引擎（scraper/extractor/paginator/wait/retry/diagnostics/font_decoder）
│   ├── policies/          robots / security(SSRF) / rate_limit / behavior
│   ├── scrapers/          示例与回归抓取器（books/quotes）
│   └── utils/             logger / output / stealth / humanize
└── tests/                 单元测试 + MCP smoke 测试
```

## 快速开始

```powershell
cd mcp
npm install          # playwright + MCP SDK（复用系统 Chrome，无需下载 Chromium）
npm test             # 76 例测试
node test_mcp.js scrape_page '{"url":"https://books.toscrape.com/","itemSelector":"article.product_pod","fields":{"title":"h3 a","price":".price_color"}}'
```

---

# webscraping-mcp (English)

A generic, agent-oriented **Playwright Web Scraping Runtime** — MCP server + self-contained skill. Point it at any public URL with a dynamic extraction schema; no per-site scraper code required.

## Highlights

- **`scrape_page`**: any public URL + dynamic extraction schema — CSS-selector field extraction, list extraction, pagination, deduplication, JSON/CSV output, explicit wait strategy (`waitFor`), behavior modes, profile selection
- **Structured errors**: `error.type` (15 typed errors) + `diagnostics` (matchedSelectors / screenshot / HTML snapshot / text sample) + `suggestion`, enabling the agent loop: *scrape → failure → read diagnostics → debug_page → fix selector → retry*
- **Font-obfuscation decoding**: `fontDecode: true` recovers private-use-area characters via canvas render matching (field-tested on Shixiseng: job titles & salaries fully decoded)
- **Dynamic-list friendly**: extraction reads the DOM via batched `evaluate` calls — no locator auto-wait, so virtual-scrolled / infinite feeds (field-tested on Nowcoder) don't hang
- **Layered anti-detection**: complete browser profiles (UA + Client Hints + locale + timezone + viewport + platform internally consistent), stealth injection, behavior modes (`none` / `polite` / `human`), robots.txt compliance
- **Security**: SSRF protection (private networks / localhost / redirect interception), credentials via environment variables (`WEBSCRAPE_USERNAME` / `WEBSCRAPE_PASSWORD`)
- **Testing**: unit tests (robots / retry / security / paginator) + MCP end-to-end smoke tests — 76 cases, `npm test`

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
npm test             # 76 test cases
node test_mcp.js scrape_page '{"url":"https://books.toscrape.com/","itemSelector":"article.product_pod","fields":{"title":"h3 a","price":".price_color"}}'
```

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

