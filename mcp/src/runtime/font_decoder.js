// 字体反爬解码器（canvas 渲染匹配法）
//
// 原理：反爬站点把关键文字（职位名/薪资等）替换为私有区字符（U+E000-U+F8FF），
//       通过动态字体（@font-face）把私有区字符渲染成真实文字的轮廓。
//       字体文件本身不含映射（cmap 只有 PUA、无真实字符、无 uniXXXX 字形名），
//       但「字形轮廓就是真实字符」—— 用 canvas 分别渲染：
//         a) PUA 字符（反爬字体）  b) 参考字符（系统字体，来自页面明文 + 数字 + 字母）
//       逐像素比对，diff 最小且置信度达标的参考字符即为真实字符。
//
// 实测（实习僧 shixiseng.com）：全部解码成功，多数 diff=0（如 "python开发实习生"、"150/天"）。
//
// 用法（extraction schema）：
//   fields: {
//     title:  { selector: 'a.title', fontDecode: true },   // 自动检测反爬字体
//     salary: { selector: '.day',    fontDecode: 'myFont' }, // 显式指定字体名
//   }
const logger = require('../utils/logger');

// page -> { fontUrl, mappingPromise }（同一页面字体不变则复用映射）
const pageCache = new WeakMap();

// 参考字符兜底集：数字/字母/常用词（页面明文之外补充，保证薪资等可解）
const EXTRA_REFS = '0123456789千百万天周个月元日一二三四五六七八九十甲乙丙丁';
// 排除的图标/UI 字体（不是反爬字体）
const EXCLUDED_FONTS = /iconfont|element-icons|font-?awesome|glyphicons|material|bootstrap|\.ttf/i;

/**
 * 在页面上下文执行的解码核心（返回 PUA -> 真实字符 映射）。
 * @returns {Promise<{fontUrl: string, mapping: Array<{pua: string, real: string, diff: number}>}>}
 */
const DECODE_SCRIPT = async ({ extraRefs }) => {
  // 排除的图标/UI 字体（不是反爬字体）—— 必须定义在脚本内部（evaluate 序列化后无闭包）
  const EXCLUDED = /iconfont|element-icons|font-?awesome|glyphicons|material|bootstrap|\.ttf/i;

  // 1. 自动检测反爬字体：第一个非图标/UI 的自定义字体
  let fontUrl = '';
  let family = '';
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.constructor.name !== 'CSSFontFaceRule') continue;
        const f = rule.style.fontFamily.replace(/['"]/g, '');
        if (EXCLUDED.test(f) || !f) continue;
        family = f;
        const m = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.src);
        if (m) fontUrl = m[1].startsWith('http') ? m[1] : location.origin + m[1];
        break;
      }
    } catch {}
  }
  if (!family) return { fontUrl: '', mapping: [], family: '' };

  // 2. 参考字符集：页面明文（非 PUA）+ 兜底集
  const plainText = document.body.innerText || '';
  const refChars = new Set();
  for (const ch of plainText) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xe000 && cp <= 0xf8ff) continue;
    if (cp > 0x20 && cp !== 0x7f) refChars.add(ch);
  }
  for (const ch of extraRefs) refChars.add(ch);
  const refList = [...refChars];

  // 3. 渲染位图
  const SIZE = 48;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  function renderGlyph(ch, fontFamily) {
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.font = `32px ${fontFamily}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
    ctx.fillText(ch, 2, 34);
    const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
    const bits = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i += 1) bits[i] = data[i * 4 + 3] > 32 ? 1 : 0;
    return bits;
  }
  function diffBits(a, b) {
    let c = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) c += 1;
    return c / a.length;
  }

  // 4. 参考位图缓存（等字体加载完再渲染）
  try {
    await document.fonts.ready;
    await document.fonts.load(`32px ${family}`);
  } catch {}
  const refCache = new Map();
  for (const ch of refList) {
    try { refCache.set(ch, renderGlyph(ch, '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif')); } catch {}
  }

  // 5. PUA 字符映射
  const puaSet = new Set();
  for (const ch of plainText) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xe000 && cp <= 0xf8ff) puaSet.add(ch);
  }
  const mapping = [];
  for (const pua of puaSet) {
    let puaBits;
    try { puaBits = renderGlyph(pua, `${family}, "Microsoft YaHei", sans-serif`); } catch { continue; }
    let best = null;
    let second = 1;
    for (const [refCh, refBits] of refCache) {
      const d = diffBits(puaBits, refBits);
      if (!best || d < best.d) { second = best ? best.d : 1; best = { ch: refCh, d }; }
      else if (d < second) second = d;
    }
    // 置信度：
    //   best.d < 0.05  -> 极接近匹配，直接接受（数百候选中错配概率极低）
    //   0.05-0.15      -> 需与次优匹配拉开 margin（防相似字形误配，如 p/y/b/d/q、1/7）
    const margin = second - best.d;
    if (best.d < 0.05 || (best.d < 0.15 && margin > 0.05)) {
      mapping.push({ pua, real: best.ch, diff: Number(best.d.toFixed(3)) });
    }
  }
  return { fontUrl, family, mapping };
};

/**
 * 获取当前页面的 PUA -> 真实字符映射（按字体 URL 缓存，字体变了自动重建）。
 * @param {import('playwright').Page} page
 * @param {string} [fontFamily] 显式指定字体名（跳过自动检测）
 * @returns {Promise<Map<string, string>>}
 */
async function getFontMapping(page, fontFamily) {
  const cached = pageCache.get(page);
  if (cached && cached.family === fontFamily) return cached.mapping;

  // 注意：page.evaluate 会把函数序列化后在浏览器执行，所以必须传函数本体
  //（DECODE_SCRIPT 源码自包含：EXCLUDED 定义在内部，只依赖参数）
  const result = await page.evaluate(DECODE_SCRIPT, {
    extraRefs: EXTRA_REFS,
    family: fontFamily,
  });
  const mapping = new Map((result.mapping || []).map((m) => [m.pua, m.real]));
  pageCache.set(page, { family: result.family || fontFamily, fontUrl: result.fontUrl, mapping });
  logger.info('字体反爬映射已构建', {
    family: result.family,
    fontUrl: result.fontUrl,
    chars: mapping.size,
  });
  return mapping;
}

/**
 * 解码文本：把私有区字符替换为真实字符。
 * 无映射/无法解码时原样返回。
 * @param {import('playwright').Page} page
 * @param {string} text
 * @param {string} [fontFamily]
 * @returns {Promise<string>}
 */
async function decodeText(page, text, fontFamily) {
  if (!text) return text;
  const hasPua = [...text].some((ch) => {
    const cp = ch.codePointAt(0);
    return cp >= 0xe000 && cp <= 0xf8ff;
  });
  if (!hasPua) return text;

  const mapping = await getFontMapping(page, fontFamily);
  if (mapping.size === 0) return text;
  return [...text].map((ch) => mapping.get(ch) || ch).join('');
}

/** 清除页面缓存（翻页后字体可能变化，但 getFontMapping 会自动按 URL 重建） */
function clearCache(page) {
  pageCache.delete(page);
}

module.exports = { decodeText, getFontMapping, clearCache };
