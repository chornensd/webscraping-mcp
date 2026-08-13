// 轻量结构化日志：统一时间戳与级别，错误走 stderr
// LOG_TO_STDERR=1 时全部走 stderr（MCP stdio 模式必须，stdout 只允许协议消息）
const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const FORCE_STDERR = process.env.LOG_TO_STDERR === '1';

function timestamp() {
  return new Date().toISOString();
}

function write(level, message, context) {
  const suffix = context === undefined ? '' : ` ${JSON.stringify(context)}`;
  const line = `[${timestamp()}] [${level}] ${message}${suffix}`;
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
