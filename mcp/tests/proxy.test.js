// 代理池单元测试：轮询、失败剔除、冷却恢复、全失效降级、URL 解析
const assert = require('node:assert');
const { createPool, loadProxies, parseProxyUrl } = require('../src/policies/proxy');

const tests = [];

tests.push(['未配置代理：getProxy 返回 null（直连）', () => {
  const pool = createPool([]);
  assert.strictEqual(pool.getProxy(), null);
}]);

tests.push(['轮询分配：一轮内不重复，下一轮回到起点', () => {
  const pool = createPool(['a', 'b', 'c']);
  const first = pool.getProxy();
  const rest = [pool.getProxy(), pool.getProxy()];
  assert.strictEqual(new Set([first, ...rest]).size, 3, '一轮内应遍历全部代理且不重复');
  assert.strictEqual(pool.getProxy(), first, '下一轮回到起点');
}]);

tests.push(['失败剔除：连续失败达阈值后不再分配，且 markFailure 返回 true', () => {
  const pool = createPool(['a'], { maxFailures: 2, coolDownMs: 60_000 });
  assert.strictEqual(pool.markFailure('a'), false, '未达阈值不剔除');
  assert.strictEqual(pool.getProxy(), 'a', '未达阈值仍可用');
  assert.strictEqual(pool.markFailure('a'), true, '达阈值返回剔除信号');
  assert.strictEqual(pool.getProxy(), null, '达阈值后被剔除');
}]);

tests.push(['冷却到期自动恢复', async () => {
  const pool = createPool(['a'], { maxFailures: 1, coolDownMs: 20 });
  pool.markFailure('a');
  assert.strictEqual(pool.getProxy(), null);
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(pool.getProxy(), 'a', '冷却结束后恢复可用');
}]);

tests.push(['成功清零失败计数', () => {
  const pool = createPool(['a'], { maxFailures: 2, coolDownMs: 60_000 });
  pool.markFailure('a');
  pool.markSuccess('a');
  assert.strictEqual(pool.getProxy(), 'a', '成功后不剔除');
}]);

tests.push(['快照反映剔除状态', () => {
  const pool = createPool(['a', 'b'], { maxFailures: 1, coolDownMs: 60_000 });
  pool.markFailure('b');
  const snap = pool.snapshot();
  const b = snap.find((e) => e.url === 'b');
  assert.strictEqual(b.down, true);
  assert.strictEqual(b.failCount, 1);
}]);

tests.push(['parseProxyUrl：带认证的代理 URL', () => {
  const parsed = parseProxyUrl('http://user:pass@proxy.example.com:8080');
  assert.deepStrictEqual(parsed, {
    server: 'proxy.example.com:8080',
    username: 'user',
    password: 'pass',
  });
}]);

tests.push(['parseProxyUrl：无认证', () => {
  assert.deepStrictEqual(parseProxyUrl('socks5://proxy.example.com:1080'), {
    server: 'socks5://proxy.example.com:1080',
    username: undefined,
    password: undefined,
  });
}]);

tests.push(['loadProxies：环境变量优先于 config', () => {
  const prev = process.env.PROXY_LIST;
  process.env.PROXY_LIST = 'http://a:1, http://b:2';
  try {
    assert.deepStrictEqual(loadProxies(), ['http://a:1', 'http://b:2']);
  } finally {
    if (prev === undefined) delete process.env.PROXY_LIST;
    else process.env.PROXY_LIST = prev;
  }
}]);

(async () => {
  let passed = 0;
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`  ok  ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL  ${name}: ${err.message}`);
    }
  }

  console.log(`\nproxy tests: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
