// 临时测试客户端：验证 webscraping MCP server 的 stdio 协议
// 用法：node test_mcp.js [toolName] [jsonArgs]
const { spawn } = require('child_process');
const readline = require('readline');

const toolName = process.argv[2] || 'scrape_books';
const toolArgs = process.argv[3] ? JSON.parse(process.argv[3]) : { maxPages: 1 };

const child = spawn('node', ['src/mcp_server.js'], {
  cwd: __dirname,
  stdio: ['pipe', 'pipe', 'inherit'],
});

const rl = readline.createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;

function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 120000);
  });
}

rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});

(async () => {
  await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0' },
  });
  child.stdin.write(
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
  );

  const list = await send('tools/list', {});
  console.log('TOOLS:', list.tools.map((t) => t.name).join(', '));

  const result = await send('tools/call', {
    name: toolName,
    arguments: toolArgs,
  });
  console.log('RESULT:', result.content[0].text.slice(0, 1500));

  child.kill();
  process.exit(0);
})().catch((err) => {
  console.error('FAIL:', err.message);
  child.kill();
  process.exit(1);
});
