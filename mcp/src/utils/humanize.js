// 人类行为模拟：随机延时、鼠标轨迹、分段滚动
// v2：是否启用由 policies/behavior.js 的模式（none/polite/human）决定，
// 而不是全局开关。humanize 本身只提供原语，不做策略判断。
// 注意：这里只读 config，不依赖 behavior.js（避免循环依赖）。
const config = require('../config');

/** 取 [min, max] 闭区间随机整数 */
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 当前是否为 human 模式 */
function isHumanMode() {
  return config.behavior.mode === 'human';
}

/** 随机等待一段时间，模仿真人操作间隔；human 模式才生效 */
async function randomDelay() {
  if (!isHumanMode()) return;
  const min = config.behavior.humanMinDelayMs;
  const max = config.behavior.humanMaxDelayMs;
  const delay = randomBetween(min, max);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * 模拟鼠标移动：从随机起点分多段移动，每段带随机偏移与停顿。
 * 避免坐标瞬移（真人鼠标有轨迹，bot 没有）。human 模式才生效。
 * @param {import('playwright').Page} page
 */
async function humanMouseMove(page) {
  if (!isHumanMode()) return;
  const viewport = page.viewportSize();
  let x = randomBetween(0, viewport.width);
  let y = randomBetween(0, viewport.height);
  await page.mouse.move(x, y);
  const steps = randomBetween(3, 6);
  for (let i = 0; i < steps; i += 1) {
    x = Math.max(0, Math.min(viewport.width, x + randomBetween(-120, 120)));
    y = Math.max(0, Math.min(viewport.height, y + randomBetween(-80, 80)));
    await page.mouse.move(x, y);
    await new Promise((resolve) => setTimeout(resolve, randomBetween(50, 150)));
  }
}

/**
 * 模拟滚动：分段滚动到页面不同深度，每段随机停顿。
 * 一次性滚到底或匀速滚动都是 bot 特征。human 模式才生效。
 * @param {import('playwright').Page} page
 */
async function humanScroll(page) {
  if (!isHumanMode()) return;
  await page.evaluate(async () => {
    // 注意：这里运行在浏览器环境，Node 侧函数不可用，随机数需内联实现
    const randomBetween = (min, max) =>
      Math.floor(Math.random() * (max - min + 1)) + min;
    const height = document.body.scrollHeight;
    const steps = randomBetween(3, 6);
    for (let i = 1; i <= steps; i += 1) {
      window.scrollTo(0, (height / steps) * i + (Math.random() - 0.5) * 80);
      await new Promise((resolve) => setTimeout(resolve, randomBetween(100, 300)));
    }
  });
}

module.exports = { randomBetween, randomDelay, humanMouseMove, humanScroll, isHumanMode };
