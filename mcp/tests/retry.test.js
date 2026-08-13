// retry 策略单元测试
// 覆盖：只重试 transient error、不重试确定错误、jitter 范围、重试次数耗尽后抛错
const assert = require('node:assert');
const { withRetry, isTransientError } = require('../src/runtime/retry');
const { ScrapeError } = require('../src/runtime/errors');

const tests = [];

tests.push(['transient 识别：timeout/429/5xx 重试，selector 等不重试', () => {
  assert.ok(isTransientError(new ScrapeError('timeout', 't')));
  assert.ok(isTransientError(new ScrapeError('http_429', 't')));
  assert.ok(isTransientError(new ScrapeError('http_5xx', 't')));
  assert.ok(isTransientError(new Error('net::ERR_CONNECTION_RESET')));
  assert.ok(isTransientError(new Error('socket hang up')));
  assert.ok(!isTransientError(new ScrapeError('selector_not_found', 't')));
  assert.ok(!isTransientError(new ScrapeError('http_403', 't')));
  assert.ok(!isTransientError(new ScrapeError('http_404', 't')));
  assert.ok(!isTransientError(new ScrapeError('robots_denied', 't')));
  assert.ok(!isTransientError(new ScrapeError('invalid_schema', 't')));
  assert.ok(!isTransientError(new TypeError('x is not a function')));
}]);

tests.push(['transient error 重试到成功', async () => {
  let calls = 0;
  const value = await withRetry(
    () => {
      calls += 1;
      if (calls < 3) throw new ScrapeError('timeout', 'boom', { retryable: true });
      return 'ok';
    },
    { retries: 4, baseDelayMs: 1, maxDelayMs: 2, jitter: 0 }
  );
  assert.strictEqual(value, 'ok');
  assert.strictEqual(calls, 3);
}]);

tests.push(['非 transient error 不重试，立即抛出', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      () => {
        calls += 1;
        throw new ScrapeError('selector_not_found', 'missing');
      },
      { retries: 5, baseDelayMs: 1, jitter: 0 }
    ),
    /missing/
  );
  assert.strictEqual(calls, 1);
}]);

tests.push(['重试次数耗尽后抛出最后一次错误', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      () => {
        calls += 1;
        throw new ScrapeError('http_429', 'slow down');
      },
      { retries: 3, baseDelayMs: 1, maxDelayMs: 2, jitter: 0 }
    ),
    /slow down/
  );
  assert.strictEqual(calls, 3);
}]);

tests.push(['jitter：延迟不超过 [base*(1-j), base*(1+j)] 范围', async () => {
  const seenDelays = [];
  const t0 = Date.now();
  await assert.rejects(
    withRetry(
      () => {
        seenDelays.push(Date.now() - t0);
        throw new ScrapeError('timeout', 't');
      },
      { retries: 4, baseDelayMs: 100, maxDelayMs: 800, jitter: 0.3 }
    )
  );
  for (let i = 1; i < seenDelays.length; i += 1) {
    const gap = seenDelays[i] - seenDelays[i - 1];
    const base = Math.min(800, 100 * 2 ** (i - 1));
    assert.ok(gap >= base * 0.7 - 2 && gap <= base * 1.3 + 2, `第 ${i} 次重试延迟 ${gap}ms 超出 jitter 范围`);
  }
}]);

tests.push(['自定义 shouldRetry 覆盖默认判定', async () => {
  let calls = 0;
  const value = await withRetry(
    () => {
      calls += 1;
      if (calls < 2) throw new ScrapeError('selector_not_found', 'retry anyway');
      return 'ok';
    },
    { retries: 3, baseDelayMs: 1, jitter: 0, shouldRetry: () => true }
  );
  assert.strictEqual(value, 'ok');
  assert.strictEqual(calls, 2);
}]);

let passed = 0;
let failed = 0;
(async () => {
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
  console.log(`\nretry tests: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
