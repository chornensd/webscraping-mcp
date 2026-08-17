// 集中配置：所有可调参数收口在这里，改行为不用翻代码
// v2：凭据从环境变量读取，不再硬编码进源码
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
  rootDir: ROOT,
  outputDir: path.join(ROOT, 'output'),
  debugDir: path.join(ROOT, 'debug'),

  browser: {
    headless: true,
    // 复用系统已安装的浏览器，无需下载 Playwright Chromium
    // 可选值：'chromium'（需 npx playwright install）| 'chrome' | 'msedge'
    // 容器内（Docker 镜像自带 chromium）用环境变量 SCRAPING_CHANNEL=chromium 覆盖
    channel: process.env.SCRAPING_CHANNEL || 'chrome',
    // 浏览器常驻（browser singleton）：首次调用启动，server 退出时统一关闭
    singleton: true,
    // 去掉自动化标志，配合 stealth 隐藏 webdriver 特征
    launchArgs: ['--disable-blink-features=AutomationControlled'],
  },

  proxy: {
    // 代理池。可用环境变量 PROXY_LIST 覆盖（逗号分隔，scheme://user:pass@host:port），
    // 也可直接在这里写数组。未配置时全部直连，行为与无代理版本一致。
    // 详见 policies/proxy.js
    list: [],
    // 连续失败多少次后剔除该代理进入冷却期
    maxFailures: Number(process.env.SCRAPING_PROXY_MAX_FAILURES) || 3,
    // 冷却时长（毫秒），到期自动恢复
    coolDownMs: Number(process.env.SCRAPING_PROXY_COOLDOWN_MS) || 60_000,
  },

  navigation: {
    // 页面加载与元素等待的超时（毫秒）
    timeoutMs: 30_000,
    // 默认导航等待策略：不要用 networkidle（可能在 DOM 完整解析前提前满足）。
    // 数据真正就绪由 waitForSelector / waitForFunction / locator.waitFor() 决定。
    waitUntil: 'domcontentloaded',
    // debug_page 等待完整加载（需要渲染出更多资源）
    debugWaitUntil: 'load',
  },

  retry: {
    // 只对 transient error（超时/断连/429/5xx 等）重试，见 runtime/retry.js
    maxRetries: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 8_000,
    jitter: 0.3,
  },

  behavior: {
    // 行为模式：
    //   none   -> 不模拟真人，最快（默认）
    //   polite -> 限速 + 随机抖动（请求间隔），适合常规站点
    //   human  -> 鼠标轨迹 / 分段滚动 / 随机延时，仅目标站点有行为分析时启用
    mode: 'none',
    // polite 模式下的请求间隔范围（毫秒）
    politeMinDelayMs: 300,
    politeMaxDelayMs: 900,
    // human 模式下的操作间隔范围（毫秒）
    humanMinDelayMs: 600,
    humanMaxDelayMs: 1_800,
  },

  stealth: {
    enabled: true,
    // 完整浏览器 profile（UA/locale/timezone/languages/viewport/platform 内部一致），
    // 见 browser/profiles.js。每次 context 取一个完整 profile，不再只随机 UA。
    profile: 'random',
    // 额外请求头：默认留空，让浏览器自己发真实头。
    // 实测（国内招聘平台 WAF）：手工加 Connection: keep-alive 或自定义 Accept 会触发
    // 验证码/空壳响应 —— 真实 Chrome 走 HTTP/2 从不发 Connection 头。
    // 与 UA 配套的 client hints（sec-ch-ua*）由 profile.secChUa 自动补全，不要写在这里。
    extraHeaders: {},
  },

  robots: {
    // 抓取前检查目标站点 robots.txt，禁止则拒绝抓取
    enabled: true,
    defaultUserAgent: 'webscraping-agent/2.0 (+education demo)',
  },

  security: {
    // URL/SSRF 防护：默认阻止本机与内网地址，除非显式开启
    // 至少阻止：localhost / 127.x / ::1 / 10.0.0.0/8 / 172.16.0.0/12 / 192.168.0.0/16 /
    //   169.254.0.0/16（含云元数据端点 169.254.169.254）/ file://
    allowPrivateNetworks: false,
    // 非空时只允许这些域名（及子域名）被访问（白名单）
    allowedDomains: [],
    // 黑名单：命中即拦截（自身或子域名），优先级高于白名单。
    // 常用场景：屏蔽内部服务域名、云元数据主机名。可用环境变量
    // SCRAPING_BLOCKED_DOMAINS 覆盖（逗号分隔）。
    blockedDomains: (process.env.SCRAPING_BLOCKED_DOMAINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  tools: {
    // 工具权限开关：禁用的工具不注册到 MCP（最小权限原则）。
    // 环境变量 SCRAPING_DISABLE_TOOLS=debug_page,suggest_selectors 覆盖。
    disabled: (process.env.SCRAPING_DISABLE_TOOLS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  metrics: {
    // 可选 Prometheus 指标端点：设置 SCRAPING_METRICS_PORT 后启动内置 HTTP server，
    // 输出 Prometheus 文本格式（GET /metrics）+ 健康检查（GET /healthz），零依赖。
    port: Number(process.env.SCRAPING_METRICS_PORT) || 0,
  },

  targets: {
    books: 'https://books.toscrape.com/',
    quotes: 'https://quotes.toscrape.com/',
    quotesLogin: 'https://quotes.toscrape.com/login',
  },

  // 凭据从环境变量读取（真实环境不要在源码里写密码）。
  // 练习站的公开演示凭据作为兜底，不影响安全。
  quotesCredentials: {
    username: process.env.WEBSCRAPE_USERNAME || 'user',
    password: process.env.WEBSCRAPE_PASSWORD || 'password',
  },
};
