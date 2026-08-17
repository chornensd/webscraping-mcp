// metrics 计数器测试：累加、快照、成功率计算、reset
const assert = require('node:assert');
const { createMetrics } = require('../src/utils/metrics');

const tests = [];

tests.push(['计数累加与成功率', () => {
  const m = createMetrics();
  m.inc('requests', 4);
  m.inc('requestsFailed');
  const snap = m.snapshot();
  assert.strictEqual(snap.requests, 4);
  assert.strictEqual(snap.requestsFailed, 1);
  assert.strictEqual(snap.successRate, 0.75);
}]);

tests.push(['未知指标名忽略', () => {
  const m = createMetrics();
  m.inc('notARealMetric', 10);
  assert.strictEqual(m.snapshot().notARealMetric, undefined);
}]);

tests.push(['无请求时成功率返回 null', () => {
  const m = createMetrics();
  assert.strictEqual(m.snapshot().successRate, null);
}]);

tests.push(['reset 清零计数', () => {
  const m = createMetrics();
  m.inc('requests', 5);
  m.reset();
  const snap = m.snapshot();
  assert.strictEqual(snap.requests, 0);
  assert.strictEqual(snap.successRate, null);
}]);

tests.push(['快照含耗时基准', () => {
  const m = createMetrics();
  const snap = m.snapshot();
  assert.ok(typeof snap.elapsedMs === 'number');
  assert.ok(typeof snap.startedAt === 'number');
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

console.log(`\nmetrics tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
