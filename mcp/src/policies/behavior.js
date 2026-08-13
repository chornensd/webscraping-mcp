// 行为策略：none / polite / human 三档，把 humanize 能力按档位暴露给抓取流程
//
//   none   -> 不做任何模拟，吞吐优先（默认）
//   polite -> 限速 + 随机抖动
//   human  -> 鼠标轨迹 / 分段滚动 / 随机延时
const config = require('../config');
const { randomBetween, randomDelay, humanMouseMove, humanScroll } = require('../utils/humanize');
const { rateLimitFor } = require('./rate_limit');

const MODES = ['none', 'polite', 'human'];

/** 解析行为模式（参数 > 配置），非法值回退 'none' */
function resolveMode(mode) {
  if (mode && MODES.includes(mode)) return mode;
  return config.behavior.mode && MODES.includes(config.behavior.mode) ? config.behavior.mode : 'none';
}

/**
 * 导航前调用：按模式限速（polite/human 都限速）。
 * @param {string} url 目标 URL（用于按域名限速）
 * @param {string} [mode]
 */
async function beforeNavigation(url, mode) {
  if (resolveMode(mode) === 'none') return;
  await rateLimitFor(url);
}

/**
 * 翻页/提交前调用：按模式决定是否模拟人类行为。
 * @param {import('playwright').Page} page
 * @param {string} [mode]
 */
async function beforePagination(page, mode) {
  const effective = resolveMode(mode);
  if (effective === 'none') return;
  await rateLimitFor(page.url());
  if (effective === 'polite') return;
  // human：鼠标轨迹 + 分段滚动 + 随机停顿
  await humanMouseMove(page);
  await humanScroll(page);
  await randomDelay();
}

module.exports = { MODES, resolveMode, beforePagination, beforeNavigation };
