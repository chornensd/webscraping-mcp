---
name: webscraping
version: 2.2.1
description: "Playwright 网页抓取与浏览器自动化：知识包 + MCP server（本 skill 自带 mcp/ 实现）。面向 Agent 的通用抓取 runtime — 任意公开 URL 动态定义 extraction schema 即可抓取（scrape_page），无需为新网站编写 scraper。Use when scraping any website, debugging selectors or login flows, dealing with anti-bot detection, or running the scrape/debug CLI and MCP tools."
metadata:
  starchild:
    emoji: "🕷️"
    skillKey: webscraping
    requires:
      bins: [node]

user-invocable: true
disable-model-invocation: false
---

# Web Scraping v2 — 通用 Playwright Web Scraping Runtime（自包含 skill + MCP）

本 skill 是完整自包含单元（JavaScript + Playwright 1.62，复用系统 Chrome，无需下载 Chromium）：
- **MCP server**：`mcp/` 目录，4 个工具，stdio 传输，注册到 opencode
- **验证客户端**：`mcp/test_mcp.js`（单工具调用）、`mcp/tests/`（完整测试套件）
- 无外部项目依赖，本 skill 即唯一实现

## v2 核心变化（相对 v1）

| 能力 | v1 | v2 |
|------|----|----|
| 新网站接入 | 人工写 scraper/*.js + 改 mcp_server + 重部署 | `scrape_page` 动态 schema，无需写代码 |
| 失败反馈 | 纯文本 `抓取失败：xxx` | 结构化错误（error.type + diagnostics + suggestion） |
| 页面就绪 | 默认 `networkidle` | 默认 `domcontentloaded` + 显式 waitFor 策略 |
| 重试 | 所有异常统一 1s/2s/4s | 只重试 transient error（timeout/429/5xx/断连），带 jitter |
| 伪装 | 随机 UA（Chrome/Edge/Firefox/Win/macOS 混用） | 完整 browser profile（UA/locale/timezone/languages/viewport/platform 内部一致） |
| 行为模拟 | 默认全开（mouse/scroll/delay） | `behavior.mode = none/polite/human`，默认 none |
| 浏览器生命周期 | 每次调用 launch/close | Browser singleton + 任务级 context（会话隔离） |
| 安全 | 任意 URL | SSRF 防护：阻止 localhost/内网/file://，可配 allowedDomains |
| 凭据 | config.js 硬编码 | 环境变量 WEBSCRAPE_USERNAME / WEBSCRAPE_PASSWORD |

## 快速命令

MCP（在 `mcp/` 目录执行）：

```powershell
npm install                 # 首次安装依赖（playwright + MCP SDK）
node test_mcp.js <tool> '<argsJson>'   # 端到端验证工具调用
node tests/run_all.js       # 完整测试：单元（robots/retry/security）+ MCP smoke
```

示例：

```powershell
node test_mcp.js scrape_page '{"url":"https://books.toscrape.com/","itemSelector":"article.product_pod","fields":{"title":"h3 a","price":".price_color"},"pagination":{"nextSelector":"li.next a","maxPages":2}}'
node test_mcp.js scrape_page '{"url":"https://news.ycombinator.com/","itemSelector":"tr.athing","fields":{"title":"span.titleline a","href":{"selector":"span.titleline a","type":"url","attribute":"href"}},"maxResults":10}'
node test_mcp.js scrape_books '{"maxPages":3,"format":"csv"}'
node test_mcp.js debug_page '{"url":"https://books.toscrape.com/","waitMs":3000}'
```

## Agent 工作流（新网站接入）

```
Agent 要抓某个新网站
   ↓
debug_page            # 打开页面，看 title/指纹/错误/截图
   ↓
分析 DOM              # 从 textPath/截图确定选择器
   ↓
scrape_page           # 提交 schema（url + fields + itemSelector + waitFor + pagination）
   ↓
成功 → 输出 JSON/CSV 文件 + 数据契约
   ↓ 失败
读取结构化错误：error.type + diagnostics（matchedSelectors/截图/HTML 快照）
   ↓
调整 selector / waitFor / behavior 后再次 scrape_page
```

## 架构地图

```
mcp/
├── mcp_server.js          MCP 入口：4 个工具，统一数据契约与结构化错误
├── src/
│   ├── config.js          所有可调参数收口（导航/重试/行为/安全/凭据）
│   ├── debug.js           调试工具（截图 + 错误收集 + 指纹检测）
│   ├── browser/           浏览器生命周期
│   │   ├── browser_manager.js   Browser singleton（常驻，进程退出统一关闭）
│   │   ├── profiles.js          完整 browser profile 池
│   │   └── context.js           任务级 context（会话隔离，任务结束清理）
│   ├── runtime/           通用抓取引擎
│   │   ├── scraper.js     scrape_page 核心编排（schema → robots → 导航 → 提取 → 输出）
│   │   ├── extractor.js   CSS selector 字段提取（text/attribute/html/url + regex）
│   │   ├── paginator.js   分页遍历（去重、failedPages 统计）
│   │   ├── wait.js        统一等待策略（domcontentloaded + 显式 waitFor）
│   │   ├── retry.js       只重试 transient error，带 jitter
│   │   ├── diagnostics.js 失败现场收集（截图/HTML 快照/选择器匹配数）
│   │   └── errors.js      结构化错误类型 + 修复建议
│   ├── policies/          策略层
│   │   ├── robots.js      robots.txt 解析（多 UA 组/最长匹配/Allow 优先）
│   │   ├── security.js    URL/SSRF 防护（内网/本机/协议白名单）
│   │   ├── rate_limit.js  polite 模式限速
│   │   └── behavior.js    none/polite/human 行为模式
│   ├── scrapers/          示例/回归抓取器（不是核心能力，请用 scrape_page）
│   │   ├── books.js       books.toscrape.com
│   │   └── quotes.js      quotes.toscrape.com（含登录降级演示）
│   └── utils/             logger / output / stealth / humanize
└── tests/                 robots/retry/security 单元测试 + mcp_smoke.js + run_all.js
```

## MCP 工具与统一数据契约

所有工具返回统一契约：

```json
// 成功
{
  "success": true, "count": 40, "pages": 2, "durationMs": 8412,
  "file": "C:\\...\\books_toscrape_com_1786.json", "format": "json",
  "sample": [{...}],
  "stats": { "duplicates": 0, "failedPages": 0 },
  "schema": { "title": "text", "price": "text", "href": "url" }
}

// 失败
{
  "success": false,
  "error": { "type": "selector_not_found", "message": "...", "url": "...", "status": 200 },
  "diagnostics": {
    "pageTitle": "...", "finalUrl": "...", "screenshot": "...", "htmlSnapshot": "...",
    "textSample": "...", "matchedSelectors": { "h3 a": 20, ".price_color": 0 }
  },
  "suggestion": "Run debug_page to inspect the current DOM, then fix the selector."
}
```

错误类型：`navigation_error` / `timeout` / `selector_not_found` / `empty_result` / `http_403` / `http_404` / `http_429` / `http_5xx` / `robots_denied` / `authentication_failed` / `challenge_detected` / `extraction_error` / `security_denied` / `invalid_schema` / `unknown`

工具：
- `scrape_page(url, fields, itemSelector?, waitFor?, pagination?, format?, dedupeKeys?, maxResults?, behavior?, allowEmpty?)`：通用抓取
  - `fields`：`{ 字段名: "selector" | { selector, type: "text"|"attribute"|"html"|"url", attribute?, regex?, regexReplace?, required?, fontDecode? } }`
  - `fontDecode: true`（或字体名）：**字体反爬解码** — 站点把关键文字（职位名/薪资）渲染成私有区字符 + 动态字体混淆（某中文实习招聘平台实测），解码器用 canvas 渲染比对还原真实文本
  - `waitFor`：`{ selector, state?: "visible"|"attached"|"hidden"|"detached", timeoutMs? }` — 数据就绪判据
  - `pagination`：`{ nextSelector?, maxPages? }`（内置按 dedupeKeys 去重 + 连续 2 页 0 新增自动终止，防动态站重复抓）
  - `behavior`：`"none" | "polite" | "human"`
  - `allowEmpty`：`true` 时 0 条结果算成功（默认报 empty_result）
  - `profile`：浏览器身份，如 `"chrome-win-zh"`（中文站点推荐）；默认随机
- `debug_page(url, waitMs?)`：分析 DOM 的必经步骤（受 security 策略保护）；返回含 `riskWall` / `emptyResponse` 风控检测字段
- `get_scrape_health()`：抓取健康快照（指标：请求数/成功率/重试/代理失效 + 代理池状态）
- `suggest_selectors(url, candidates?, waitForSelector?)`：选择器推荐——统计候选选择器匹配数与样本文本（按匹配数降序），生成/修正 itemSelector 前先探测 DOM
- `scrape_books(maxPages?, format?)`：示例/回归
- `scrape_quotes(maxPages?)`：示例/回归（含登录降级）

验证：`opencode mcp list` 应显示 `webscraping connected`；或 `mcp/` 目录下 `node test_mcp.js scrape_page '{"url":"https://books.toscrape.com/","fields":{"title":"h1"}}'`。

## 关键决策与 gotchas（实测经验，非理论）

### 1. 页面就绪判定：不要用 networkidle
实测 `networkidle` 会在 DOM 解析完成前提前满足（HTML 分块传输，块间间隙被判为空闲），翻页后只抓到部分数据（20 张卡片只解析出 12）。v2 默认导航用 `domcontentloaded`，数据就绪由显式 `waitFor.selector` / `locator.waitFor()` 决定；翻页统一 `load` 事件 + 关键元素等待。

### 2. retry 只对 transient error 生效
`withRetry` 默认 `shouldRetry = isTransientError`（timeout/429/5xx/连接重置/导航中断）。`selector_not_found`、401/403/404、robots_denied、schema 错误一律不重试。延迟带 ±jitter（默认 0.3）打散重试节奏。

### 3. scrape_page 失败先读 diagnostics 再猜
失败返回 `matchedSelectors`（每个选择器匹配几个元素）—— 一眼看出是 itemSelector 没匹配（0）还是字段选择器错（部分 0）。配合 `debug_page` 的截图与文本快照修正选择器。

### 4. robots 检查的调用时机
`checkRobots` 内部会自己 `goto` robots.txt，必须在 `goto` 目标页**之前**调用；调用后必须重新导航回目标页（scrape_page 内部已处理）。404 或抓取失败一律放行并记日志。

### 5. 浏览器常驻，会话隔离
Browser singleton 常驻（首次调用启动，server 退出时统一关闭）。每个任务创建独立 BrowserContext —— cookies/session 默认隔离，任务结束清理，不跨任务共享。

### 6. 内网/本机 URL 被阻止（SSRF 防护，含重定向）
`security.allowPrivateNetworks=false`（默认）时，localhost、127.x、10.x、172.16-31.x、192.168.x、::1、file:// 全部拒绝，域名解析到内网地址同样拦截。**双保险**：初始 URL 由 `validateUrl` 做完整 DNS 检查；context 上另装 route 层拦截，页面 301/302 重定向到内网或子请求打内网（如云 metadata `169.254.169.254`）会实时 abort。如需调试本机服务，临时设置 `allowPrivateNetworks: true`。

### 7. MCP stdio 协议要求 stdout 纯净
MCP 模式下日志必须走 stderr，否则污染 JSON-RPC 协议。`logger.js` 支持 `LOG_TO_STDERR=1` 强制；`mcp_server.js` 在 require 任何模块前设置该变量。

### 8. 凭据从环境变量读取
`WEBSCRAPE_USERNAME` / `WEBSCRAPE_PASSWORD` 覆盖 quotes 登录凭据；真实环境不要在 config.js 写密码（练习站演示凭据仅作兜底）。

### 9. 浏览器崩溃自动恢复
Browser singleton 监听 `disconnected` 事件，Chrome 被杀/更新后自动重置，下一次调用重新启动。任务 context 创建失败也返回结构化错误（不会让 Agent 收到裸 JSON-RPC error）。

### 10. 覆盖 UA 必须同步补 client hints（实测某国内招聘平台）
CDP 覆盖 `userAgent` 后，Chrome 不再自动发送 `sec-ch-ua*` client hints。若请求头里 UA 是 Chrome 150 但没有配套的 `sec-ch-ua`，WAF 会认为指纹自相矛盾，直接返回 39 字节空壳 `<html><head></head><body></body></html>`。profile 的 `secChUa` 字段会自动补上匹配的头；**不要**手工往 `config.stealth.extraHeaders` 写这些。

### 11. 不要手工设置 Accept / Connection 头（实测同平台）
真实 Chrome 走 HTTP/2，从不发送 `Connection: keep-alive`（这是 curl/HTTP/1.1 的痕迹）。手工补 `Accept` / `Accept-Language` / `Connection` 会让 WAF 判定为机器人并弹验证码。v2.1 起 `config.stealth.extraHeaders` 默认 `{}`——让浏览器自己发真实头，只在极特殊场景（如需要特定头）才配置。

### 12. 中文站点的身份选择
面向中文站点（如国内招聘平台）建议在 `scrape_page` 里传 `profile: "chrome-win-zh"`（locale zh-CN + 时区 Asia/Shanghai + 中文语言）。默认 profile 是 en-US，中文 WAF 对英文身份更敏感。若站点要求登录或有验证码（极验 Geetest 等），属于 skill 设计边界（无验证码求解能力）。

### 13. 字体反爬解码（实测某中文实习招聘平台）
部分中文站点把职位名/薪资替换为私有区字符（U+E000-U+F8FF）+ 每次会话动态生成 @font-face 混淆字体。字体文件本身不含映射（cmap 只有 PUA、无 uniXXXX 字形名、码位随机），但**字形轮廓就是真实字符**——`fontDecode: true` 用 canvas 分别渲染 PUA 字符（混淆字体）与参考字符（页面明文 + 数字 + 字母，系统字体），逐像素比对还原。实测全部解码成功（"python开发实习生"、"150/天"）。映射按字体 URL 缓存，翻页字体变化自动重建。

### 14. 提取用 evaluate 批量读 DOM，不要用 locator 逐字段取（实测某中文求职社区）
对无限滚动/虚拟列表/动态重渲染页面（Vue 虚拟滚动 + 重渲染），locator 的 auto-wait 会因元素持续抖动永远等不到"稳定"，`innerText`/`getAttribute` 逐个 8s 超时，18 张卡片能卡 2 分钟+。v2.2 起 extractor 改为 `locator.evaluate` 批量读 DOM（一次 CDP 往返取完整卡片，无 auto-wait），动态页面 2 秒提取 18 卡。注意：传给 `page.evaluate` 的函数必须自包含（闭包引用会在序列化后丢失，报 `xxx is not defined`）；元素注入用 `$eval`/`locator.evaluate`（元素自动作为第一参数）。

## 反爬分层（按需组合，不是全上）

| 层 | 模块 | 内容 | 适用场景 |
|----|------|------|---------|
| 请求层 | browser/profiles.js | 完整 browser profile（UA/locale/timezone/languages/viewport/platform + sec-ch-ua client hints 内部一致） | 基础伪装（client hints 不一致会被 WAF 拒） |
| 特征层 | utils/stealth.js | webdriver/chrome/plugins/languages/permissions/platform 注入 | 被特征检测时 |
| 行为层 | policies/behavior.js | `mode: none/polite/human`（mouse/scroll/delay 只在 human 开） | 被行为分析时 |
| 频率层 | policies/rate_limit.js | polite/human 模式按域名最小请求间隔 | 高频抓取时 |
| 网络层 | policies/proxy.js | 代理池：轮询分配、失败剔除（重启单例换代理）、冷却恢复、全挂降级直连；`PROXY_LIST` 开启 | IP 被封/风控时 |
| 内容层 | runtime/font_decoder.js | 字体反爬解码（canvas 渲染比对还原私有区字符） | 职位名/薪资被动态字体混淆时 |
| 合规层 | policies/robots.js | robots.txt 检查（多 UA 组/最长匹配/Allow 优先） | 始终开启 |
| 安全层 | policies/security.js | SSRF 防护（内网/本机/协议白名单，含重定向拦截） | 始终开启 |
| 可观测 | utils/metrics.js | 指标（请求数/成功率/重试/代理失效）+ `get_scrape_health` 工具 | 排障/监控 |
| 未实现 | — | 验证码（极验 Geetest 等）、WebGL/canvas 深度指纹 | 需要外部资源，按设计排除 |

验证反爬是否生效：`node test_mcp.js debug_page '{"url":"<target>","waitMs":3000}'`，看指纹检测输出（`webdriver` 应为 `undefined`）。

## 环境变量速查

| 变量 | 作用 |
|------|------|
| `PROXY_LIST` | 代理池（逗号分隔 `scheme://user:pass@host:port`），空=直连 |
| `SCRAPING_BLOCKED_DOMAINS` | 域名黑名单（逗号分隔，命中即拦，子域通配） |
| `SCRAPING_DISABLE_TOOLS` | 禁用的 MCP 工具（逗号分隔，最小权限） |
| `SCRAPING_METRICS_PORT` | Prometheus 指标端点端口（0=关闭，仅 127.0.0.1） |
| `SCRAPING_CHANNEL` | 浏览器渠道（容器内 chromium） |
| `SCRAPING_PROXY_MAX_FAILURES` / `SCRAPING_PROXY_COOLDOWN_MS` | 代理剔除阈值 / 冷却时长 |
| `WEBSCRAPE_USERNAME` / `WEBSCRAPE_PASSWORD` | 登录凭据 |
| `LOG_TO_STDERR=1` | MCP 模式必须（stdout 纯净） |
| `LOG_FORMAT=json` | JSON 日志行（可接入日志系统） |

完整错误码表见 README.md#error-codes（失败响应含 `code`/`type`/`docUrl`/`suggestion`，Agent 按 code 程序化处理）。

## 测试

```powershell
node tests/run_all.js
# check_requires.js：静态校验 src 下所有相对 require 都能解析
# robots.test.js（11 例）：多 UA 组/显式 UA vs */Allow 优先/最长匹配/空 Disallow/* 与 $/query
# retry.test.js（6 例）：transient 识别/重试到成功/不重试确定错误/耗尽抛错/jitter 范围
# security.test.js（10 例）：私有 IP 判定/localhost/内网/IPv6/file:///白名单/请求级拦截
# paginator.test.js（5 例）：整条去重/按键去重/多键去重/undefined 键
# proxy.test.js（9 例）：轮询分配/失败剔除/冷却恢复/全挂降级/URL 解析（含认证）
# metrics.test.js（5 例）：累加/成功率/未知键忽略/reset/耗时基准
# mcp_smoke.js（48 例）：tools/list/scrape_books/scrape_quotes/debug_page/
#   get_scrape_health/scrape_page 成功（分页+去重+url 解析+单条记录）/
#   失败（结构化错误+diagnostics）/CSV/dedupeKeys/behavior=polite/allowEmpty/安全拦截
```

## 已知限制

- 目标为公开练习站，登录用演示凭据（可用环境变量覆盖）；真实站点需配置自己的凭据
- 代理池需自备代理（env `PROXY_LIST`）；无验证码求解能力，仅覆盖常规反爬强度
- 不绕过 robots.txt；403/429/验证码类站点需要真人操作或外部资源
- 实测案例（国内招聘平台）：修复 UA 与 client hints 不一致 + 移除手工
  Accept/Connection 头后请求可通过 WAF；但同 IP 高频访问会被标记风险并强制极验
  Geetest 点击验证（`geetest_radar_btn`），属于验证码边界，需人工/外部验证服务
- 实测案例（中文实习招聘平台）：无需 WAF 对抗即可访问，职位名/薪资用字体
  反爬混淆，`fontDecode: true` 可完整还原；翻页选择器随站点改版可能变化
- 实测案例（中文求职社区）：无 WAF，无语义类名，
  卡片根需按实际 DOM 结构选；feed 为虚拟列表（locator 提取会超时，
  已通过 evaluate 批量提取解决）；列表混有广告卡（字段为 null 属正常）

## 真实网站测试（2026-08 追加）

本项目的 stealth / 代理池 / 限流 / 风控检测在多个**真实生产网站**（国际 + 国内，覆盖不同反爬强度）上验证过，
目标站名按约定不在文档中写明。验证结论：

- 中等反爬站点（代码托管平台、视频平台、求职社区）：stealth 全部通过，无验证墙，
  结构化抓取全链路正常（SPA 异步渲染、滚动触发加载均可用）
- 国内影评平台：IP 级封禁（无 cookie 会话返回 403 / 「访问异常」验证页），与 stealth 无关
- 国内招聘平台：无 cookie 会话返回空文档（39 字节）或验证墙（iframe 渲染），需代理或人工验证
- 国内实习招聘平台：服务端对无痕会话不下发列表数据（API 带动态签名前缀），另有字体反爬
- `debug_page` 的 `riskWall` / `emptyResponse` 字段即为此设计：先判 IP/会话层风控，再查选择器
