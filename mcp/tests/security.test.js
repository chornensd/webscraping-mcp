// security / SSRF 防护单元测试
// 覆盖：localhost、127.x、10.x、172.16-31.x、192.168.x、::1、file://、
//       协议白名单、allowedDomains、allowPrivateNetworks 放行
const assert = require('node:assert');
const {
  validateUrl,
  isPrivateIPv4,
  isPrivateIPv6,
  isBlockedRequestUrl,
} = require('../src/policies/security');

const tests = [];

tests.push(['私有 IPv4 判定', () => {
  assert.ok(isPrivateIPv4('127.0.0.1'));
  assert.ok(isPrivateIPv4('10.0.0.1'));
  assert.ok(isPrivateIPv4('172.16.0.1'));
  assert.ok(isPrivateIPv4('172.31.255.255'));
  assert.ok(isPrivateIPv4('192.168.1.1'));
  assert.ok(isPrivateIPv4('169.254.10.10'));
  assert.ok(!isPrivateIPv4('8.8.8.8'));
  assert.ok(!isPrivateIPv4('172.32.0.1'));
  assert.ok(!isPrivateIPv4('192.169.0.1'));
}]);

tests.push(['私有 IPv6 判定', () => {
  assert.ok(isPrivateIPv6('::1'));
  assert.ok(isPrivateIPv6('fe80::1'));
  assert.ok(isPrivateIPv6('fc00::1'));
  assert.ok(isPrivateIPv6('fd12:3456::1'));
  assert.ok(isPrivateIPv6('::ffff:127.0.0.1'));
  assert.ok(isPrivateIPv6('::ffff:192.168.1.1'));
  assert.ok(!isPrivateIPv6('2606:4700::1111'));
}]);

tests.push(['localhost 主机名被阻止', async () => {
  await assert.rejects(validateUrl('http://localhost:8080/admin'), /安全|security_denied|被阻止/i);
  await assert.rejects(validateUrl('http://LOCALHOST/'), /被阻止/);
}]);

tests.push(['IPv4 字面量内网被阻止', async () => {
  await assert.rejects(validateUrl('http://127.0.0.1/'));
  await assert.rejects(validateUrl('http://10.0.0.5/'));
  await assert.rejects(validateUrl('http://192.168.1.100/'));
  await assert.rejects(validateUrl('http://172.16.0.1/'));
}]);

tests.push(['::1 被阻止', async () => {
  await assert.rejects(validateUrl('http://[::1]:3000/'));
}]);

tests.push(['file:// 协议被阻止', async () => {
  await assert.rejects(validateUrl('file:///etc/passwd'));
  await assert.rejects(validateUrl('javascript:alert(1)'));
  await assert.rejects(validateUrl('ftp://example.com/x'));
}]);

tests.push(['公网地址放行', async () => {
  await validateUrl('https://books.toscrape.com/');
  await validateUrl('https://quotes.toscrape.com/');
}]);

tests.push(['allowPrivateNetworks 显式放行内网', async () => {
  await validateUrl('http://127.0.0.1:8080/', { allowPrivateNetworks: true });
  await validateUrl('http://192.168.1.10/', { allowPrivateNetworks: true });
}]);

tests.push(['allowedDomains 白名单', async () => {
  const opts = { allowedDomains: ['example.com'] };
  await validateUrl('https://example.com/a', opts);
  await validateUrl('https://sub.example.com/a', opts);
  await assert.rejects(validateUrl('https://other.org/a', opts));
  await assert.rejects(validateUrl('https://example.org/a', opts));
}]);

tests.push(['请求级拦截：重定向/子请求打内网也能拦', () => {
  // 公网页重定向到内网（SSRF 主路径）—— validateUrl 拦不到，route 层必须拦
  assert.ok(isBlockedRequestUrl('http://127.0.0.1:8080/'));
  assert.ok(isBlockedRequestUrl('http://localhost/admin'));
  assert.ok(isBlockedRequestUrl('http://10.0.0.1/'));
  assert.ok(isBlockedRequestUrl('http://192.168.1.1/'));
  assert.ok(isBlockedRequestUrl('http://[::1]:3000/'));
  assert.ok(isBlockedRequestUrl('http://169.254.169.254/latest/meta-data/'));
  assert.ok(isBlockedRequestUrl('file:///etc/passwd'));
  // 公网子请求放行
  assert.ok(!isBlockedRequestUrl('https://cdn.example.com/app.js'));
  assert.ok(!isBlockedRequestUrl('https://books.toscrape.com/img/book.png'));
  assert.ok(!isBlockedRequestUrl('https://8.8.8.8/dns'));
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
  console.log(`\nsecurity tests: ${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
