# webscraping-mcp

面向 Agent 的通用 Playwright Web Scraping Runtime（MCP server + 自包含 skill）。

- **`scrape_page`**：任意公开 URL + 动态 extraction schema（CSS selector 字段提取、列表提取、分页、去重、JSON/CSV、显式等待策略），无需为新网站编写 scraper
- **结构化错误**：`error.type` + `diagnostics`（matchedSelectors/截图/HTML 快照）+ `suggestion`，Agent 可自动形成「失败 → 读诊断 → debug_page → 改选择器 → 重试」闭环
- **字体反爬解码**：`fontDecode: true` 用 canvas 渲染比对还原私有区字符（实测实习僧职位名/薪资全解）
- **动态列表兼容**：evaluate 批量读 DOM，虚拟滚动/无限列表（实测牛客 feed）不卡 locator
- **反爬分层**：完整 browser profile（UA/client hints/locale/timezone 内部一致）、stealth、behavior 模式（none/polite/human）、robots.txt 合规
- **安全**：SSRF 防护（内网/本机/重定向拦截）、凭据走环境变量（WEBSCRAPE_USERNAME / WEBSCRAPE_PASSWORD）
- **测试**：robots/retry/security/paginator 单测 + MCP 端到端 smoke（76 例，`npm test`）

完整文档见 [SKILL.md](SKILL.md)（含实测案例：BOSS 直聘 / 实习僧 / 牛客网）。

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
