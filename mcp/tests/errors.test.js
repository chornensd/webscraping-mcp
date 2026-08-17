// errors.js 单元测试：稳定错误码、docUrl、可执行建议、HTTP 映射
const assert = require('node:assert');
const {
  ScrapeError,
  ERROR_TYPES,
  httpError,
  suggestionFor,
} = require('../src/runtime/errors');

const tests = [];

tests.push(['每个错误类型都有稳定 code 和 docUrl', () => {
  for (const type of ERROR_TYPES) {
    const err = new ScrapeError(type, `msg for ${type}`);
    assert.ok(/^[A-Z]{3,6}_[A-Z0-9]{3,6}$/.test(err.code), `${type} 的 code 格式: ${err.code}`);
    assert.ok(err.docUrl.startsWith('https://'), `${type} 的 docUrl: ${err.docUrl}`);
    assert.ok(err.code !== 'UNK_0001' || type === 'unknown', '只有 unknown 用 UNK_0001');
  }
}]);

tests.push(['toJSON 包含 code/type/docUrl', () => {
  const err = new ScrapeError('http_403', 'blocked', { url: 'https://x.com/', status: 403 });
  const json = err.toJSON();
  assert.strictEqual(json.code, 'HTTP_403');
  assert.strictEqual(json.type, 'http_403');
  assert.strictEqual(json.status, 403);
  assert.ok(json.docUrl.includes('#error-codes'));
}]);

tests.push(['未知类型归一为 unknown', () => {
  const err = new ScrapeError('not_a_real_type', 'x');
  assert.strictEqual(err.type, 'unknown');
  assert.strictEqual(err.code, 'UNK_0001');
}]);

tests.push(['httpError 映射 + retryable 标记', () => {
  assert.strictEqual(httpError(403, 'u').type, 'http_403');
  assert.strictEqual(httpError(404, 'u').type, 'http_404');
  assert.strictEqual(httpError(429, 'u').retryable, true);
  assert.strictEqual(httpError(503, 'u').retryable, true);
  assert.strictEqual(httpError(200, 'u').type, 'unknown');
}]);

tests.push(['suggestion 是可执行的行动指引（含动词与具体工具名）', () => {
  const s = suggestionFor('selector_not_found');
  assert.ok(s.includes('debug_page') || s.includes('suggest_selectors'), '应指向具体工具');
  const t = suggestionFor('http_429');
  assert.ok(t.toLowerCase().includes('proxy') || t.includes('behavior'), '限流建议应含降频/代理');
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

console.log(`\nerrors tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
