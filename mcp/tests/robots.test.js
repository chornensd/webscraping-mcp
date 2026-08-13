// robots.txt parser 单元测试
// 覆盖：多 UA 组、显式 UA vs *、Allow/Disallow 优先级、同长度规则、
//       空 Disallow、* 与 $ 通配、最长匹配、URL 编码/query 处理
const assert = require('node:assert');
const { parseRobots, isAllowed } = require('../src/policies/robots');

function check(robotsText, userAgent, pathname, expected) {
  const groups = parseRobots(robotsText, userAgent);
  const actual = isAllowed(groups, pathname);
  assert.strictEqual(actual, expected, `isAllowed(${pathname}) 期望 ${expected}，实际 ${actual}`);
}

const tests = [];

tests.push(['多 UA 组：只匹配目标 UA 的组', () => {
  const text = [
    'User-agent: Googlebot',
    'Disallow: /private',
    '',
    'User-agent: *',
    'Disallow: /blocked',
  ].join('\n');
  check(text, 'webscraping-agent/2.0', '/private', true);
  check(text, 'webscraping-agent/2.0', '/blocked', false);
  check(text, 'Googlebot', '/private', false);
}]);

tests.push(['显式 UA 优先于 *', () => {
  const text = [
    'User-agent: my-bot',
    'Disallow: /secret',
    '',
    'User-agent: *',
    'Allow: /',
  ].join('\n');
  check(text, 'my-bot', '/secret', false);
  check(text, 'my-bot', '/public', true);
  check(text, 'other-bot', '/secret', true);
}]);

tests.push(['同长度规则：Allow 优先于 Disallow', () => {
  const text = [
    'User-agent: *',
    'Disallow: /foo',
    'Allow: /foo',
  ].join('\n');
  check(text, 'any-bot', '/foo', true);
}]);

tests.push(['不同长度：最长匹配优先', () => {
  const text = [
    'User-agent: *',
    'Disallow: /a',
    'Allow: /a/b',
  ].join('\n');
  check(text, 'any-bot', '/a/b', true); // /a/b（更长）允许
  check(text, 'any-bot', '/a/c', false); // 只匹配 /a，禁止
}]);

tests.push(['空 Disallow：视为允许', () => {
  const text = [
    'User-agent: *',
    'Disallow:',
    'Disallow: /only',
  ].join('\n');
  check(text, 'any-bot', '/anything', true); // Disallow: 空 = 放行一切
  check(text, 'any-bot', '/only', false);
}]);

tests.push(['* 通配：匹配任意子路径', () => {
  const text = [
    'User-agent: *',
    'Disallow: /cgi-bin/',
    'Allow: /cgi-bin/ok*',
  ].join('\n');
  check(text, 'any-bot', '/cgi-bin/test', false);
  check(text, 'any-bot', '/cgi-bin/ok-script', true);
}]);

tests.push(['$ 结尾锚点：只匹配精确结尾', () => {
  const text = [
    'User-agent: *',
    'Disallow: /archive/1995$',
  ].join('\n');
  check(text, 'any-bot', '/archive/1995', false);
  check(text, 'any-bot', '/archive/1995x', true);
  check(text, 'any-bot', '/archive/1995/', true);
}]);

tests.push(['规则长度用原始 pattern（而非 regex.source）', () => {
  // 若用 regex.source.length 推导，"/data/a$" 的源码是 "^/data/a$"（9 字符），
  // "/data/a" 是 "^/data/a"（8 字符），两者永远相差 1，会稳定选错规则。
  // 这里按原始 pattern 长度（8 vs 7）比较，最长匹配正确生效。
  const text = [
    'User-agent: *',
    'Allow: /data/a$',     // 长度 8
    'Disallow: /data/a',   // 长度 7
  ].join('\n');
  check(text, 'any-bot', '/data/a', true); // 两者都匹配，最长（Allow，8）生效
  check(text, 'any-bot', '/data/ab', false); // 只匹配 /data/a（Disallow）
}]);

tests.push(['query 参与匹配', () => {
  const text = [
    'User-agent: *',
    'Disallow: /search?q=blocked',
  ].join('\n');
  check(text, 'any-bot', '/search?q=blocked', false);
  check(text, 'any-bot', '/search?q=other', true);
}]);

tests.push(['无匹配规则：默认允许', () => {
  const text = [
    'User-agent: *',
    'Disallow: /blocked',
  ].join('\n');
  check(text, 'any-bot', '/totally/different', true);
}]);

tests.push(['大小写不敏感的 User-agent 匹配', () => {
  const text = [
    'User-agent: MyBot',
    'Disallow: /x',
  ].join('\n');
  check(text, 'mybot', '/x', false);
  check(text, 'MYBOT', '/x', false);
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

console.log(`\nrobots tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
