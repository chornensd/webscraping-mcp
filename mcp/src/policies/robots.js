// robots.txt 合规检查（v2 修正版）
// 自实现解析器：
//   - User-agent 分组（多个 group，显式 UA 优先于 *）
//   - Allow / Disallow
//   - * 与 $ 通配
//   - 按「原始 pattern 长度」选最长匹配（不再用 regex.source.length 推导）
//   - 同长度 Allow 优先于 Disallow
//   - 空 Disallow（无路径）视为放行该路径
const config = require('../config');
const logger = require('../utils/logger');

const WILDCARD_UA = '*';

/** 把 robots 通配模式（* 任意串，$ 结尾锚点）转成正则 */
function patternToRegex(pattern) {
  let source = '^';
  for (const ch of pattern) {
    if (ch === '*') source += '.*';
    else if (ch === '$') source += '$';
    else source += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(source);
}

/**
 * 解析 robots.txt 文本。
 * @param {string} text
 * @param {string} userAgent
 * @returns {Array<{ua: string, rules: Array<{allow: boolean, pattern: string, patternLength: number, regex: RegExp}>}>}
 */
function parseRobots(text, userAgent) {
  const groups = [];
  let currentGroup = null;
  const targetUA = String(userAgent || '').toLowerCase();

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      const ua = value.toLowerCase();
      // 只收集匹配目标 UA 的组（明确匹配或通配符兜底）
      if (ua === targetUA || ua === WILDCARD_UA) {
        currentGroup = { ua, rules: [] };
        groups.push(currentGroup);
      } else {
        currentGroup = null;
      }
    } else if ((field === 'allow' || field === 'disallow') && currentGroup) {
      const pattern = value;
      // 空 Disallow 表示"该路径允许"（规范：Disallow 无值 = 放行一切）
      if (field === 'disallow' && pattern === '') {
        currentGroup.rules.push({
          allow: true,
          pattern: '',
          patternLength: 0,
          regex: new RegExp('^'),
        });
        continue;
      }
      if (field === 'allow' && pattern === '') continue;
      currentGroup.rules.push({
        allow: field === 'allow',
        pattern,
        patternLength: pattern.length,
        regex: patternToRegex(pattern),
      });
    }
  }
  return groups;
}

/**
 * 判断路径是否允许抓取。
 * 优先级：显式 UA 组 > * 组；组内按原始 pattern 长度取最长匹配；
 * 长度相同 Allow 优先；无匹配默认允许。
 * @param {Array} groups parseRobots 的返回
 * @param {string} pathname 路径（含 query）
 * @returns {boolean}
 */
function isAllowed(groups, pathname) {
  const explicit = groups.filter((g) => g.ua !== WILDCARD_UA);
  const effective = explicit.length > 0 ? explicit : groups;
  const candidates = [];
  for (const group of effective) {
    for (const rule of group.rules) {
      if (rule.regex.test(pathname)) {
        candidates.push(rule);
      }
    }
  }
  if (candidates.length === 0) return true;
  candidates.sort((a, b) => {
    const lenDiff = b.patternLength - a.patternLength;
    if (lenDiff !== 0) return lenDiff;
    return a.allow ? -1 : 1;
  });
  return candidates[0].allow;
}

/**
 * 抓取目标站点的 robots.txt 并检查路径是否允许。
 * robots.txt 不存在、抓取失败或禁用检查时一律放行（并记日志）。
 * @param {import('playwright').Page} page
 * @param {string} url 完整目标 URL
 * @param {string} [userAgent] 用哪个 UA 匹配规则组（默认 config.robots.defaultUserAgent）
 * @returns {Promise<boolean>}
 */
async function checkRobots(page, url, userAgent) {
  if (!config.robots.enabled) return true;
  const target = new URL(url);
  const robotsUrl = `${target.origin}/robots.txt`;
  const ua = userAgent || config.robots.defaultUserAgent;

  try {
    const response = await page.goto(robotsUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    if (!response || !response.ok()) {
      logger.info(`robots.txt 不可访问（HTTP ${response ? response.status() : 'N/A'}），放行`, {
        url: robotsUrl,
      });
      return true;
    }
    const text = await response.text();
    const groups = parseRobots(text, ua);
    // 用 pathname + search 匹配（query 也参与匹配）
    const pathToCheck = `${target.pathname}${target.search}`;
    const allowed = isAllowed(groups, pathToCheck);
    logger.info(`robots.txt 检查：${allowed ? '允许' : '禁止'} ${url}`);
    return allowed;
  } catch (err) {
    logger.warn('robots.txt 检查失败，放行', { error: err.message });
    return true;
  }
}

module.exports = { checkRobots, parseRobots, isAllowed, patternToRegex };
