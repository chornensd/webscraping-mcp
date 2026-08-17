// 轻量结构化日志：统一时间戳与级别，错误走 stderr
// LOG_TO_STDERR=1 时全部走 stderr（MCP stdio 模式必须，stdout 只允许协议消息）
// LOG_FORMAT=json 时输出纯 JSON 行（{ts, level, msg, ...context}），便于接入日志系统
const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const FORCE_STDERR = process.env.LOG_TO_STDERR === '1';
const JSON_FORMAT = process.env.LOG_FORMAT === 'json';

function timestamp() {
  return new Date().toISOString();
}

function write(level, message, context) {
  const line = JSON_FORMAT
    ? JSON.stringify({ ts: timestamp(), level, msg: message, ...context })
    : `[${timestamp()}] [${level}] ${message}${
        context === undefined ? '' : ` ${JSON.stringify(context)}`
      }`;
  if (LEVELS[level] >= LEVELS.ERROR || FORCE_STDERR) {
    console.error(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  debug: (message, context) => write('DEBUG', message, context),
  info: (message, context) => write('INFO', message, context),
  warn: (message, context) => write('WARN', message, context),
  error: (message, context) => write('ERROR', message, context),
};
