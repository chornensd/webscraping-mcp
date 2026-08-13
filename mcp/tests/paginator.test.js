// paginator 去重逻辑单元测试（分页/熔断依赖浏览器，由 mcp_smoke 覆盖）
const assert = require('node:assert');
const { dedupe, recordKey } = require('../src/runtime/paginator');

const tests = [];

tests.push(['整条记录去重（缺省）', () => {
  const records = [
    { title: 'a', price: '1' },
    { title: 'b', price: '2' },
    { title: 'a', price: '1' },
  ];
  const { unique, duplicates } = dedupe(records);
  assert.strictEqual(duplicates, 1);
  assert.strictEqual(unique.length, 2);
  assert.strictEqual(unique[0].title, 'a');
  assert.strictEqual(unique[1].title, 'b');
}]);

tests.push(['按指定键去重', () => {
  const records = [
    { title: 'a', price: '1' },
    { title: 'a', price: '999' },
    { title: 'b', price: '2' },
  ];
  const { unique, duplicates } = dedupe(records, ['title']);
  assert.strictEqual(duplicates, 1);
  assert.strictEqual(unique.length, 2);
  assert.strictEqual(unique[0].price, '1'); // 保留首次出现
}]);

tests.push(['空数组', () => {
  const { unique, duplicates } = dedupe([]);
  assert.strictEqual(unique.length, 0);
  assert.strictEqual(duplicates, 0);
}]);

tests.push(['多键去重', () => {
  const records = [
    { title: 'a', price: '1', href: '/a' },
    { title: 'a', price: '1', href: '/b' },
    { title: 'a', price: '2', href: '/a' },
  ];
  const { unique, duplicates } = dedupe(records, ['title', 'price']);
  assert.strictEqual(duplicates, 1); // 第二条与第一条同 title+price
  assert.strictEqual(unique.length, 2);
}]);

tests.push(['recordKey 处理 undefined 字段', () => {
  const a = recordKey({ title: 'x', price: undefined }, ['title', 'price']);
  const b = recordKey({ title: 'x', price: null }, ['title', 'price']);
  assert.strictEqual(a, b); // undefined 与 null 序列化一致，视为相同
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

console.log(`\npaginator tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
