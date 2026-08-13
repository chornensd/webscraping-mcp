// MCP server v2：通用 Playwright Web Scraping Runtime
// 把抓取能力暴露为工具，供 AI agent 直接调用
//
// 工具：
//   scrape_page  通用抓取：任意 URL + 动态 extraction schema（核心能力）
//   debug_page   调试任意 URL（DOM 分析 -> 生成 schema 的必经步骤）
//   scrape_books / scrape_quotes  示例/回归抓取器（兼容保留）
//
// 统一数据契约：
//   成功：{ success, count, pages, durationMs, file, format, sample, stats, schema }
//   失败：{ success:false, error:{type,message,url,status}, diagnostics, suggestion }
//
// 注册方式（opencode.json）：
//   "webscraping": {
//     "type": "local",
//     "command": ["node", "C:\\Users\\吴俊涛\\.agents\\skills\\webscraping\\mcp\\src\\mcp_server.js"],
//     "enabled": true,
//     "timeout": 120000
//   }
// 注意：必须先于任何 require 设置，保证日志全部走 stderr（stdio 协议要求 stdout 纯净）
process.env.LOG_TO_STDERR = '1';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const config = require('./config');
const logger = require('./utils/logger');
const { getBrowser } = require('./browser/browser_manager');
const { createTaskContext, closeTaskContext } = require('./browser/context');
const { resolveProfile } = require('./browser/profiles');
const { scrapeBooks } = require('./scrapers/books');
const { scrapeQuotes } = require('./scrapers/quotes');
const { scrapePage } = require('./runtime/scraper');
const { ScrapeError, suggestionFor } = require('./runtime/errors');
const { collectDiagnostics } = require('./runtime/diagnostics');
const { checkRobots } = require('./policies/robots');
const { navigate } = require('./runtime/wait');
const { saveJSON, saveCSV } = require('./utils/output');
const path = require('path');

const server = new McpServer({
  name: 'webscraping',
  version: '2.0.0',
});

/**
 * 统一执行入口：任务级 context + 结构化结果/错误。
 * 失败时自动收集 diagnostics（标题/URL/截图/HTML 快照/文本样本/选择器匹配数）
 * 并附带 suggestion，让 Agent 能形成
 *   scrape -> failure -> 读 diagnostics -> debug_page -> 改 selector -> retry
 * 闭环。
 * @param {Array<string>} selectors 用于 diagnostics 的匹配数统计
 * @param {Function} fn (page) => Promise<result>
 * @param {{ profile?: string }} [options] profile 为 profiles.js 中的名称（如 'chrome-win-zh'）
 */
async function runTask(selectors, fn, options = {}) {
  let context = null;
  let page = null;
  try {
    const browser = await getBrowser();
    const profile = options.profile ? resolveProfile(options.profile) : undefined;
    ({ context, page } = await createTaskContext(browser, { profile }));
  } catch (err) {
    // context 创建失败（如浏览器崩溃后无法重启）也返回结构化错误
    return {
      success: false,
      error: {
        type: 'unknown',
        message: `无法启动浏览器/任务 context: ${err.message}`,
      },
      diagnostics: {},
      suggestion:
        'Check that Chrome is installed and the configured channel is available, then retry.',
    };
  }
  try {
    return await fn(page);
  } catch (err) {
    const error =
      err instanceof ScrapeError
        ? err
        : new ScrapeError('unknown', err.message, { cause: err });
    const diagnostics = await collectDiagnostics(page, {
      selectors,
      label: error.type,
    });
    return {
      success: false,
      error: error.toJSON(),
      diagnostics,
      suggestion: suggestionFor(error.type),
    };
  } finally {
    await closeTaskContext({ context });
  }
}

/** 从 scrape_page 参数中收集所有选择器（供 diagnostics 统计匹配数） */
function selectorsFromParams(p) {
  const selectors = [];
  for (const spec of Object.values(p.fields || {})) {
    if (typeof spec === 'string') selectors.push(spec);
    else if (spec && typeof spec === 'object' && spec.selector) selectors.push(spec.selector);
  }
  if (p.itemSelector) selectors.push(p.itemSelector);
  if (p.pagination?.nextSelector) selectors.push(p.pagination.nextSelector);
  return selectors;
}

/**
 * 统一成功契约：{ success, count, pages, durationMs, file, format, sample, stats, schema }
 * @param {Array<object>} records
 * @param {string} filePath
 * @param {{ pages?: number, duplicates?: number, failedPages?: number, schema?: object, startMs: number }} [extra]
 */
function buildResult(records, filePath, extra = {}) {
  const format = filePath.endsWith('.csv') ? 'csv' : 'json';
  return {
    success: true,
    count: records.length,
    pages: extra.pages ?? 1,
    durationMs: Date.now() - (extra.startMs || Date.now()),
    file: filePath,
    format,
    sample: records.slice(0, 3),
    stats: { duplicates: extra.duplicates ?? 0, failedPages: extra.failedPages ?? 0 },
    schema: extra.schema || {},
  };
}

server.tool(
  'scrape_page',
  '通用网页抓取：对任意公开 URL 动态定义 extraction schema（CSS selector），支持字段提取、列表提取、分页、去重、JSON/CSV 输出与显式等待策略。返回结构化结果或结构化错误（error.type + diagnostics + suggestion）。',
  {
    url: z.string().url().describe('目标 URL（http/https）'),
    fields: z
      .record(
        z.string(),
        z.union([
          z.string().describe('CSS selector，提取文本'),
          z
            .object({
              selector: z.string().describe('CSS selector'),
              type: z
                .enum(['text', 'attribute', 'html', 'url'])
                .optional()
                .describe('text=innerText（默认）；attribute=读取 attribute 属性；html=innerHTML；url=解析为绝对 URL'),
              attribute: z.string().optional().describe('type=attribute|url 时读取的属性名'),
              regex: z.string().optional().describe('对提取结果应用正则（捕获组取第 1 组）'),
              regexReplace: z.string().optional().describe('regex 的替换串（存在时优先于捕获组）'),
              required: z.boolean().optional().describe('提取失败是否让整条记录失败'),
              trim: z.boolean().optional().describe('是否去空白（默认 true）'),
              fontDecode: z
                .union([z.boolean(), z.string()])
                .optional()
                .describe('字体反爬解码：true=自动检测反爬字体，字符串=指定字体名（如实习僧职位名/薪资）'),
            })
            .describe('字段详情对象'),
        ])
      )
      .refine((f) => Object.keys(f).length > 0, 'fields 至少需要一个字段')
      .describe('提取字段：{ 字段名: selector 或字段对象 }'),
    itemSelector: z.string().optional().describe('列表元素选择器；缺省按单条记录提取'),
    waitFor: z
      .object({
        selector: z.string().describe('数据就绪判据元素'),
        state: z.enum(['visible', 'attached', 'hidden', 'detached']).optional().describe('等待状态（默认 visible）'),
        timeoutMs: z.number().int().min(100).max(120000).optional().describe('等待超时（毫秒）'),
      })
      .optional()
      .describe('显式等待策略：导航后等待该选择器出现（数据就绪，不依赖 networkidle）'),
    pagination: z
      .object({
        nextSelector: z.string().optional().describe('「下一页」链接选择器'),
        maxPages: z.number().int().min(1).max(100).optional().describe('最大翻页数（默认 1）'),
      })
      .optional()
      .describe('分页配置'),
    format: z.enum(['json', 'csv']).optional().describe('输出格式（默认 json）'),
    dedupeKeys: z.array(z.string()).optional().describe('按这些字段去重；缺省按整条记录去重'),
    maxResults: z.number().int().min(1).max(100000).optional().describe('结果数量上限'),
    behavior: z.enum(['none', 'polite', 'human']).optional().describe('行为模式：none=最快（默认）、polite=限速、human=模拟真人'),
    allowEmpty: z.boolean().optional().describe('true 时 0 条结果不算错误（默认 false，报 empty_result）'),
    profile: z
      .enum(['chrome-win', 'chrome-mac', 'edge-win', 'firefox-win', 'chrome-win-zh'])
      .optional()
      .describe('浏览器身份 profile（locale/timezone/languages/UA 内部一致）；中文站点可用 chrome-win-zh'),
  },
  async (params) => {
    const result = await runTask(
      selectorsFromParams(params),
      (page) => scrapePage(page, params),
      { profile: params.profile }
    );
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'scrape_books',
  '抓取 books.toscrape.com 的书籍列表（分页、去重），支持 CSV/JSON 输出。返回统一数据契约。',
  {
    maxPages: z.number().int().min(1).max(50).default(3).describe('最大抓取页数'),
    format: z.enum(['json', 'csv']).default('json').describe('输出格式'),
  },
  async ({ maxPages, format }) => {
    const result = await runTask([], async (page) => {
      const startMs = Date.now();
      const allowed = await checkRobots(page, config.targets.books);
      if (!allowed) {
        throw new ScrapeError('robots_denied', `robots.txt 禁止抓取 ${config.targets.books}`, {
          url: config.targets.books,
        });
      }
      // checkRobots 会把页面导航到 robots.txt，必须回到目标页再抓
      await navigate(page, config.targets.books);
      const { records, pages } = await scrapeBooks(page, maxPages);
      const filePath = path.join(config.outputDir, `books_${Date.now()}.${format}`);
      if (format === 'csv') {
        saveCSV(records, ['title', 'price', 'stock', 'rating', 'href'], filePath);
      } else {
        saveJSON(records, filePath);
      }
      return buildResult(records, filePath, {
        pages,
        schema: { title: 'text', price: 'text', stock: 'text', rating: 'text', href: 'attribute' },
        startMs,
      });
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'scrape_quotes',
  '抓取 quotes.toscrape.com 的引文（含登录流程，失败自动降级匿名）。返回统一数据契约。',
  {
    maxPages: z.number().int().min(1).max(50).default(3).describe('最大抓取页数'),
  },
  async ({ maxPages }) => {
    const result = await runTask([], async (page) => {
      const startMs = Date.now();
      const allowed = await checkRobots(page, config.targets.quotes);
      if (!allowed) {
        throw new ScrapeError('robots_denied', `robots.txt 禁止抓取 ${config.targets.quotes}`, {
          url: config.targets.quotes,
        });
      }
      const { records, pages } = await scrapeQuotes(page, maxPages);      const filePath = path.join(config.outputDir, `quotes_${Date.now()}.json`);
      saveJSON(records, filePath);
      return buildResult(records, filePath, {
        pages,
        schema: { text: 'text', author: 'text', tags: 'text' },
        startMs,
      });
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'debug_page',
  '调试任意 URL：打开页面、收集 JS/网络错误、检测指纹（验证 stealth）、保存截图与文本快照。返回指纹与错误清单。抓取失败后用它分析 DOM 以调整选择器。',
  {
    url: z.string().url().describe('目标 URL（受 security 策略保护：阻止内网/本机）'),
    waitMs: z.number().int().min(0).max(30000).default(3000).describe('等待动态内容渲染的毫秒数'),
    profile: z
      .enum(['chrome-win', 'chrome-mac', 'edge-win', 'firefox-win', 'chrome-win-zh'])
      .optional()
      .describe('浏览器身份 profile；中文站点推荐 chrome-win-zh'),
  },
  async ({ url, waitMs, profile }) => {
    const { debugPageInPage } = require('./debug');
    const result = await runTask(
      [],
      (page) => debugPageInPage(page, url, waitMs).then((debug) => ({ success: true, ...debug })),
      { profile }
    );
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// 启动 stdio 传输
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('webscraping MCP server v2 已启动（stdio）');
}

main().catch((err) => {
  logger.error('MCP server 启动失败', { error: err.message });
  process.exit(1);
});
