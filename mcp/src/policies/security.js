// URL 安全边界：防止 Agent 抓取本机/内网服务（SSRF 防护）
// 至少阻止：localhost / 127.0.0.1 / ::1 / 10.0.0.0/8 / 172.16.0.0/12 / 192.168.0.0/16 / file://
// 域名也会做 DNS 解析，解析到内网地址同样拦截（防 DNS 重绑定式的旁路）。
const dns = require('dns');
const { promisify } = require('util');
const config = require('../config');
const logger = require('../utils/logger');
const { ScrapeError } = require('../runtime/errors');

const dnsLookup = promisify(dns.lookup);

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
]);

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
  if (lower.startsWith('::ffff:')) return isPrivateIPv4(lower.slice('::ffff:'.length));
  if (lower.startsWith('0:0:0:0:0:ffff:')) return isPrivateIPv4(lower.slice('0:0:0:0:0:ffff:'.length));
  return false;
}

function isPrivateAddress(address) {
  const ip = address.includes(':') ? address : address;
  return ip.includes(':') ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

/** hostname 是否匹配允许域名列表（自身或子域名） */
function matchesAllowedDomains(hostname, allowedDomains) {
  if (!allowedDomains || allowedDomains.length === 0) return true;
  const host = hostname.toLowerCase();
  return allowedDomains.some((domain) => {
    const d = String(domain).toLowerCase();
    return host === d || host.endsWith(`.${d}`);
  });
}

/**
 * 校验目标 URL 是否可以访问。
 * 通过：http/https 协议、非内网地址、匹配 allowedDomains（如配置）。
 * @param {string} rawUrl
 * @param {{ allowPrivateNetworks?: boolean, allowedDomains?: string[] }} [options]
 * @returns {Promise<void>} 不通过时抛 ScrapeError('security_denied')
 */
async function validateUrl(rawUrl, options = {}) {  const allowPrivate = options.allowPrivateNetworks ?? config.security.allowPrivateNetworks;
  const allowedDomains = options.allowedDomains ?? config.security.allowedDomains;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ScrapeError('invalid_schema', `无法解析 URL: ${rawUrl}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ScrapeError(
      'security_denied',
      `仅允许 http/https 协议，收到 ${parsed.protocol}//（file:// 等协议被阻止）`,
      { url: rawUrl }
    );
  }

  const hostname = parsed.hostname.toLowerCase();

  if (!matchesAllowedDomains(hostname, allowedDomains)) {
    throw new ScrapeError(
      'security_denied',
      `域名 ${hostname} 不在 allowedDomains 白名单内`,
      { url: rawUrl }
    );
  }

  if (allowPrivate) return;

  // 字面 IP 直接检查（IPv6 的 hostname 带方括号，先剥掉）
  const rawHost = hostname.replace(/^\[|\]$/g, '');
  const isIPLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(rawHost) || rawHost.includes(':');
  if (isIPLiteral) {
    if (isPrivateAddress(rawHost)) {
      throw new ScrapeError(
        'security_denied',
        `目标地址是内网/本机地址: ${rawHost}（如需访问请设置 security.allowPrivateNetworks）`,
        { url: rawUrl }
      );
    }
    return;
  }

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new ScrapeError(
      'security_denied',
      `目标主机名被阻止: ${hostname}`,
      { url: rawUrl }
    );
  }

  // 域名解析到内网地址也拦截
  try {
    const addresses = await dnsLookup(hostname, { all: true });
    const privateOnes = addresses
      .map((a) => a.address)
      .filter((addr) => isPrivateAddress(addr));
    if (privateOnes.length > 0) {
      logger.warn('域名解析到内网地址，已拦截', { hostname, addresses: privateOnes });
      throw new ScrapeError(
        'security_denied',
        `域名 ${hostname} 解析到内网地址: ${privateOnes.join(', ')}`,
        { url: rawUrl }
      );
    }
  } catch (err) {
    if (err instanceof ScrapeError) throw err;
    // DNS 解析失败（如无网络）不拦截，让导航层报 navigation_error
    logger.warn('DNS 解析失败，放行（由导航层处理）', { hostname, error: err.message });
  }
}

/**
 * 请求级快速拦截判定（不解析 DNS，只做字符串级检查，供 route 层实时拦截用）。
 * 覆盖：非 http/https 协议、本机/内网 IP 字面量、被阻止主机名。
 * 域名解析到内网的场景由 validateUrl 在初始 URL 上做完整 DNS 检查兜底。
 * @param {string} rawUrl
 * @returns {boolean} true = 应拦截
 */
function isBlockedRequestUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return true;
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;
  const rawHost = hostname.replace(/^\[|\]$/g, '');
  const isIPLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(rawHost) || rawHost.includes(':');
  if (isIPLiteral && isPrivateAddress(rawHost)) return true;
  return false;
}

/**
 * 在 context 上安装请求级内网拦截（route 层）。
 * 关键作用：目标页 301/302 重定向到本机/内网、或页面子请求打内网时，
 * 即使 validateUrl 校验过的初始 URL 是公网，也能在中途拦截。
 * @param {import('playwright').BrowserContext} context
 * @param {{ allowPrivateNetworks?: boolean }} [options]
 * @returns {import('playwright').BrowserContext}
 */
function installPrivateNetworkGuard(context, options = {}) {
  const allowPrivate = options.allowPrivateNetworks ?? config.security.allowPrivateNetworks;
  if (allowPrivate) return context;
  context.route('**/*', (route) => {
    const url = route.request().url();
    if (isBlockedRequestUrl(url)) {
      logger.warn('已拦截内网/本机请求', { url });
      route.abort('blockedbyclient').catch(() => {});
    } else {
      route.continue().catch(() => {});
    }
  });
  logger.info('已安装请求级内网拦截（重定向/子请求防护）');
  return context;
}

module.exports = {
  validateUrl,
  isPrivateIPv4,
  isPrivateIPv6,
  isPrivateAddress,
  matchesAllowedDomains,
  isBlockedRequestUrl,
  installPrivateNetworkGuard,
};
