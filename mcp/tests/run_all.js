// 测试总入口：node tests/run_all.js
// 依次运行：单元测试（robots / retry / security）-> MCP smoke 测试
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const unitTests = [
  'check_requires.js',
  'robots.test.js',
  'retry.test.js',
  'security.test.js',
  'paginator.test.js',
  'proxy.test.js',
  'metrics.test.js',
];

let allPassed = true;

for (const file of unitTests) {
  console.log(`\n=== ${file} ===`);
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) allPassed = false;
}

console.log('\n=== mcp_smoke.js（需要网络 + 系统 Chrome，可能较慢）===');
const smoke = spawnSync(process.execPath, [path.join(__dirname, 'mcp_smoke.js')], {
  cwd: ROOT,
  stdio: 'inherit',
  timeout: 600_000,
});
if (smoke.status !== 0) allPassed = false;

console.log(`\n${allPassed ? '全部测试通过' : '存在失败测试'}`);
process.exitCode = allPassed ? 0 : 1;
