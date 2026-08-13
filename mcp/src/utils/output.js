// 数据导出：JSON 与 CSV，自动建目录，统一入口方便扩展
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function escapeCsv(value) {
  const s = String(value === null || value === undefined ? '' : value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 导出为 JSON 文件。
 * @param {Array<object>} records
 * @param {string} filePath
 */
function saveJSON(records, filePath) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf8');
  logger.info(`已写入 JSON：${filePath}（${records.length} 条）`);
}

/**
 * 导出为 CSV 文件。列顺序由 columns 决定，只导出存在的字段。
 * @param {Array<object>} records
 * @param {string[]} columns
 * @param {string} filePath
 */
function saveCSV(records, columns, filePath) {
  ensureDir(path.dirname(filePath));
  const header = columns.join(',');
  const rows = records.map((record) =>
    columns.map((col) => escapeCsv(record[col])).join(',')
  );
  fs.writeFileSync(filePath, [header, ...rows].join('\n'), 'utf8');
  logger.info(`已写入 CSV：${filePath}（${records.length} 条）`);
}

module.exports = { saveJSON, saveCSV };
