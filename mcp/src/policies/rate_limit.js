// 请求限速：polite/human 模式下按域名保证最小请求间隔，避免打爆目标站点
const config = require('../config');

// domain -> 上次请求完成时间戳
const lastRequestAt = new Map();

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '_unknown';
  }
}

/**
 * 按域名限速：距上次请求不足间隔时等待补齐（等待结束后才记录时间戳）。
 * @param {string} urlOrDomain 目标 URL 或域名
 */
async function rateLimitFor(urlOrDomain) {
  const mode = config.behavior.mode;
  if (mode === 'none') return;
  const domain = getDomain(urlOrDomain);
  const [min, max] =
    mode === 'human'
      ? [config.behavior.humanMinDelayMs, config.behavior.humanMaxDelayMs]
      : [config.behavior.politeMinDelayMs, config.behavior.politeMaxDelayMs];

  const now = Date.now();
  const last = lastRequestAt.get(domain) || 0;
  const gap = now - last;
  const minGap = min + Math.random() * (max - min);
  if (gap < minGap) {
    const wait = Math.round(minGap - gap);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestAt.set(domain, Date.now());
}

module.exports = { rateLimitFor, getDomain };
