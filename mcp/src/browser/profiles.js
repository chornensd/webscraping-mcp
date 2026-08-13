// 完整浏览器 profile：UA / locale / timezone / languages / viewport / platform 内部一致
// 每次 context 从 profile 池选一个完整身份，而不是只随机 UA（避免 UA 与系统特征不匹配）
//
// 字段说明：
//   name           profile 标识
//   browserFamily  浏览器家族（决定 language 头、UA 结构等）
//   userAgent      与 platform/locale 匹配的 UA 字符串
//   locale         Accept-Language 与 navigator.language
//   timezone       IANA 时区
//   languages      navigator.languages
//   viewport       窗口尺寸（与 platform 常见分辨率匹配）
//   platform       navigator.platform
//   secChUa        Client Hints 头（重要！）：CDP 覆盖 UA 后 Chrome 不再自动发
//                  sec-ch-ua* 头，UA 与 client hints 不一致会被 WAF（如 BOSS 直聘）
//                  直接拒绝。必须手工补上与 UA 匹配的 client hints。
//                  Firefox 不发 client hints，所以 firefox profile 不需要此字段。

const PROFILES = [
  {
    name: 'chrome-win',
    browserFamily: 'chrome',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezone: 'America/New_York',
    languages: ['en-US', 'en'],
    viewport: { width: 1280, height: 800 },
    platform: 'Win32',
    secChUa: {
      'sec-ch-ua': '"Not.A/Brand";v="99", "Chromium";v="150", "Google Chrome";v="150"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua-full-version-list':
        '"Not.A/Brand";v="99.0.0.0", "Chromium";v="150.0.0.0", "Google Chrome";v="150.0.0.0"',
    },
  },
  {
    name: 'chrome-mac',
    browserFamily: 'chrome',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezone: 'America/Los_Angeles',
    languages: ['en-US', 'en'],
    viewport: { width: 1440, height: 900 },
    platform: 'MacIntel',
    secChUa: {
      'sec-ch-ua': '"Not.A/Brand";v="99", "Chromium";v="150", "Google Chrome";v="150"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-ch-ua-full-version-list':
        '"Not.A/Brand";v="99.0.0.0", "Chromium";v="150.0.0.0", "Google Chrome";v="150.0.0.0"',
    },
  },
  {
    name: 'edge-win',
    browserFamily: 'edge',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0',
    locale: 'en-US',
    timezone: 'Europe/Berlin',
    languages: ['en-US', 'en'],
    viewport: { width: 1280, height: 800 },
    platform: 'Win32',
    secChUa: {
      'sec-ch-ua': '"Not.A/Brand";v="99", "Chromium";v="148", "Microsoft Edge";v="148"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua-full-version-list':
        '"Not.A/Brand";v="99.0.0.0", "Chromium";v="148.0.0.0", "Microsoft Edge";v="148.0.0.0"',
    },
  },
  {
    name: 'firefox-win',
    browserFamily: 'firefox',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
    locale: 'en-US',
    timezone: 'Asia/Tokyo',
    languages: ['en-US', 'en'],
    viewport: { width: 1366, height: 768 },
    platform: 'Win32',
  },
  {
    name: 'chrome-win-zh',
    browserFamily: 'chrome',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    locale: 'zh-CN',
    timezone: 'Asia/Shanghai',
    languages: ['zh-CN', 'zh'],
    viewport: { width: 1280, height: 800 },
    platform: 'Win32',
    secChUa: {
      'sec-ch-ua': '"Not.A/Brand";v="99", "Chromium";v="150", "Google Chrome";v="150"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua-full-version-list':
        '"Not.A/Brand";v="99.0.0.0", "Chromium";v="150.0.0.0", "Google Chrome";v="150.0.0.0"',
    },
  },
];

/** 按名称取 profile，不存在则抛错 */
function getProfile(name) {
  const profile = PROFILES.find((p) => p.name === name);
  if (!profile) {
    throw new Error(`未知 browser profile: ${name}（可选：${PROFILES.map((p) => p.name).join(', ')}）`);
  }
  return profile;
}

/** 随机取一个完整 profile */
function randomProfile() {
  return PROFILES[Math.floor(Math.random() * PROFILES.length)];
}

/** 解析 config.stealth.profile：'random' 或具体 profile 名称 */
function resolveProfile(name) {
  if (!name || name === 'random') return randomProfile();
  return getProfile(name);
}

module.exports = { PROFILES, getProfile, randomProfile, resolveProfile };
