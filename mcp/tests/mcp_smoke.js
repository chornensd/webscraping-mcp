// MCP 端到端 smoke 测试：启动真实 mcp_server，依次调用所有工具
// 覆盖：
//   tools/list（4 个工具）
//   scrape_books / scrape_quotes（回归：原功能不坏 + 统一契约）
//   debug_page
//   scrape_page 成功（列表 + 分页 + 去重）
//   scrape_page 失败（selector_not_found -> 结构化错误 + diagnostics + suggestion）
//   scrape_page 安全（内网 URL -> security_denied）
const { spawn } = require('child_process');
const readline = require('readline');

const SERVER = 'src/mcp_server.js';
const TOOL_TIMEOUT = 120_000;

class McpClient {
  constructor() {
    this.child = spawn('node', [SERVER], {
      cwd: __dirname + '/..',
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.rl = readline.createInterface({ input: this.child.stdout });
    this.pending = new Map();
    this.nextId = 1;
    this.ready = new Promise((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
    });
    this.rl.on('line', (line) => {
      const msg = JSON.parse(line);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }

  send(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, TOOL_TIMEOUT);
    });
  }

  async init() {
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke-test', version: '1.0' },
    });
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
    );
  }

  async listTools() {
    const result = await this.send('tools/list', {});
    return result.tools.map((t) => t.name);
  }

  async callTool(name, args) {
    const result = await this.send('tools/call', { name, arguments: args });
    const text = result.content[0].text;
    return JSON.parse(text);
  }

  close() {
    this.child.kill();
  }
}

let passed = 0;
let failed = 0;

function ok(cond, name, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}: ${detail || '条件不成立'}`);
  }
}

async function main() {
  const client = new McpClient();
  try {
    await client.init();

    // ---- tools/list ----
    const tools = await client.listTools();
    ok(tools.includes('scrape_page'), 'tools/list 包含 scrape_page', tools.join(','));
    ok(tools.includes('debug_page'), 'tools/list 包含 debug_page', tools.join(','));
    ok(tools.includes('scrape_books'), 'tools/list 包含 scrape_books', tools.join(','));
    ok(tools.includes('scrape_quotes'), 'tools/list 包含 scrape_quotes', tools.join(','));
    ok(tools.includes('get_scrape_health'), 'tools/list 包含 get_scrape_health', tools.join(','));
    ok(tools.length === 5, '工具数量为 5', tools.join(','));

    // ---- get_scrape_health（指标 + 代理池快照）----
    const health = await client.callTool('get_scrape_health', {});
    ok(health.success === true, 'get_scrape_health success');
    ok(typeof health.metrics === 'object' && 'successRate' in health.metrics, 'health.metrics 存在');
    ok(Array.isArray(health.proxies), 'health.proxies 存在');

    // ---- scrape_books（回归）----
    const books = await client.callTool('scrape_books', { maxPages: 1 });
    ok(books.success === true, 'scrape_books success');
    ok(books.count > 0, 'scrape_books count > 0', String(books.count));
    ok(typeof books.pages === 'number', 'scrape_books pages 存在');
    ok(typeof books.durationMs === 'number', 'scrape_books durationMs 存在');
    ok(books.stats && typeof books.stats.duplicates === 'number', 'scrape_books stats.duplicates 存在');
    ok(books.schema && books.schema.title === 'text', 'scrape_books schema 存在', JSON.stringify(books.schema));

    // ---- scrape_quotes（回归）----
    const quotes = await client.callTool('scrape_quotes', { maxPages: 1 });
    ok(quotes.success === true, 'scrape_quotes success');
    ok(quotes.count > 0, 'scrape_quotes count > 0', String(quotes.count));

    // ---- debug_page ----
    const debug = await client.callTool('debug_page', {
      url: 'https://books.toscrape.com/',
      waitMs: 1000,
    });
    ok(debug.success === true, 'debug_page success');
    ok(debug.screenshotPath && debug.screenshotPath.endsWith('.png'), 'debug_page 截图存在', debug.screenshotPath);
    ok(typeof debug.fingerprint?.webdriver !== 'boolean' || debug.fingerprint.webdriver === undefined, 'debug_page 指纹：webdriver 未暴露', JSON.stringify(debug.fingerprint));

    // ---- scrape_page 成功（列表 + 分页 + 去重 + waitFor）----
    const generic = await client.callTool('scrape_page', {
      url: 'https://books.toscrape.com/',
      itemSelector: 'article.product_pod',
      fields: {
        title: 'h3 a',
        price: '.price_color',
        stock: '.availability',
        href: { selector: 'h3 a', type: 'url', attribute: 'href' },
      },
      waitFor: { selector: 'article.product_pod', timeoutMs: 10000 },
      pagination: { nextSelector: 'li.next a', maxPages: 2 },
      format: 'json',
    });
    ok(generic.success === true, 'scrape_page 成功');
    ok(generic.count > 20, 'scrape_page 分页后 count > 20（每页 20 本）', String(generic.count));
    ok(generic.pages === 2, 'scrape_page pages = 2', String(generic.pages));
    ok(generic.sample[0]?.title, 'scrape_page 样本含 title', JSON.stringify(generic.sample[0]));
    ok(generic.sample[0]?.href.startsWith('https://'), 'scrape_page url 类型解析为绝对 URL', generic.sample[0]?.href);
    ok(generic.stats.duplicates === 0, 'scrape_page 两页无重复', String(generic.stats.duplicates));
    ok(generic.file.endsWith('.json'), 'scrape_page 输出 json 文件', generic.file);

    // ---- scrape_page 单条记录（无 itemSelector）----
    const single = await client.callTool('scrape_page', {
      url: 'https://books.toscrape.com/',
      fields: { title: 'h1', pageTitle: 'title' },
    });
    ok(single.success === true, 'scrape_page 单条记录成功');
    ok(single.count === 1, 'scrape_page 单条记录 count = 1', String(single.count));
    ok(single.sample[0]?.title.includes('All products'), 'scrape_page 单条记录内容正确', JSON.stringify(single.sample[0]));

    // ---- scrape_page 失败：错误选择器 -> 结构化错误 ----
    const bad = await client.callTool('scrape_page', {
      url: 'https://books.toscrape.com/',
      itemSelector: 'article.nonexistent-card',
      fields: { title: 'h3 a' },
    });
    ok(bad.success === false, 'scrape_page 失败时 success=false');
    ok(bad.error && typeof bad.error.type === 'string', 'scrape_page 失败含 error.type', JSON.stringify(bad.error));
    ok(['empty_result', 'selector_not_found'].includes(bad.error.type), 'error.type 为 empty_result 或 selector_not_found', bad.error?.type);
    ok(bad.error.url === 'https://books.toscrape.com/', 'error.url 正确', bad.error?.url);
    ok(bad.diagnostics && typeof bad.diagnostics.matchedSelectors === 'object', 'diagnostics 含 matchedSelectors');
    ok(typeof bad.diagnostics.pageTitle === 'string', 'diagnostics 含 pageTitle', bad.diagnostics?.pageTitle);
    ok(typeof bad.suggestion === 'string' && bad.suggestion.length > 0, 'suggestion 存在', bad.suggestion);

    // ---- scrape_page 安全：内网 URL ----
    const blocked = await client.callTool('scrape_page', {
      url: 'http://127.0.0.1:8080/',
      fields: { title: 'title' },
    });
    ok(blocked.success === false, '内网 URL 被拒');
    ok(blocked.error?.type === 'security_denied', 'error.type = security_denied', blocked.error?.type);

    // ---- scrape_page CSV 输出 ----
    const csv = await client.callTool('scrape_page', {
      url: 'https://books.toscrape.com/',
      itemSelector: 'article.product_pod',
      fields: { title: 'h3 a', price: '.price_color' },
      format: 'csv',
    });
    ok(csv.success === true, 'scrape_page CSV 成功');
    ok(csv.format === 'csv' && csv.file.endsWith('.csv'), 'scrape_page CSV 文件', csv.file);
    ok(csv.count > 0, 'scrape_page CSV count > 0', String(csv.count));

    // ---- scrape_page 自定义 dedupeKeys：错误键产生重复 ----
    const dup = await client.callTool('scrape_page', {
      url: 'https://books.toscrape.com/',
      itemSelector: 'article.product_pod',
      fields: { title: 'h3 a', price: '.price_color', stock: '.availability' },
      pagination: { nextSelector: 'li.next a', maxPages: 2 },
      dedupeKeys: ['stock'], // 几乎全部 "In stock" -> 大量重复
    });
    ok(dup.success === true, 'scrape_page dedupeKeys 成功');
    ok(dup.stats.duplicates > 0, 'scrape_page 按 stock 去重产生重复', String(dup.stats.duplicates));

    // ---- scrape_page behavior: polite ----
    const polite = await client.callTool('scrape_page', {
      url: 'https://books.toscrape.com/',
      itemSelector: 'article.product_pod',
      fields: { title: 'h3 a' },
      maxResults: 5,
      behavior: 'polite',
    });
    ok(polite.success === true, 'scrape_page behavior=polite 成功');
    ok(polite.count === 5, 'scrape_page maxResults=5', String(polite.count));

    // ---- scrape_page allowEmpty：合法空结果 ----
    const empty = await client.callTool('scrape_page', {
      url: 'https://books.toscrape.com/',
      itemSelector: 'article.no-such-card',
      fields: { title: 'h3 a' },
      allowEmpty: true,
    });
    ok(empty.success === true, 'scrape_page allowEmpty 返回成功');
    ok(empty.count === 0, 'scrape_page allowEmpty count = 0', String(empty.count));

    console.log(`\nMCP smoke tests: ${passed} passed, ${failed} failed`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  smoke 流程异常: ${err.message}`);
    console.log(`\nMCP smoke tests: ${passed} passed, ${failed} failed`);
  } finally {
    client.close();
  }
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
