// logger.js 测试：级别分发、错误走 stderr、JSON 格式模式
const assert = require('node:assert');
const path = require('path');

function freshLogger(env) {
  // logger 在 require 时读取环境变量，用子进程确保干净
  const { spawnSync } = require('child_process');
  const script = `
    const logger = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'utils', 'logger.js'))});
    logger.info('info msg');
    logger.warn('warn msg', { k: 1 });
    logger.error('error msg');
  `;
  const res = spawnSync(process.execPath, ['-e', script], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status };
}

const tests = [];

tests.push(['INFO/WARN 走 stdout，ERROR 走 stderr', () => {
  const { stdout, stderr } = freshLogger({});
  assert.match(stdout, /\[INFO\] info msg/);
  assert.match(stdout, /\[WARN\] warn msg.*"k":1/);
  assert.doesNotMatch(stdout, /\[ERROR\]/);
  assert.match(stderr, /\[ERROR\] error msg/);
}]);

tests.push(['LOG_TO_STDERR=1 时全部走 stderr（MCP 协议要求 stdout 纯净）', () => {
  const { stdout, stderr } = freshLogger({ LOG_TO_STDERR: '1' });
  assert.strictEqual(stdout, '', 'stdout 必须保持纯净');
  assert.match(stderr, /\[INFO\] info msg/);
  assert.match(stderr, /\[ERROR\] error msg/);
}]);

tests.push(['LOG_FORMAT=json 输出纯 JSON 行（可被日志系统解析）', () => {
  const { stdout, stderr } = freshLogger({ LOG_FORMAT: 'json' });
  for (const line of stdout.trim().split('\n')) {
    const obj = JSON.parse(line);
    assert.ok(obj.ts && obj.level && obj.msg, 'JSON 行必须含 ts/level/msg');
  }
  const first = JSON.parse(stdout.trim().split('\n')[0]);
  assert.strictEqual(first.level, 'INFO');
  const errLine = JSON.parse(stderr.trim().split('\n')[0]);
  assert.strictEqual(errLine.level, 'ERROR');
}]);

let passed = 0;
let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}: ${err.message}`);
  }
}

console.log(`\nlogger tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
