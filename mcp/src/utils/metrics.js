// 轻量指标计数器：请求数/成功率/重试/代理失效
// 每个任务结果附一个快照（mcp_server 的 buildResult + get_scrape_health），
// 用于排障与观测抓取健康度。
const logger = require('./logger');

function createMetrics() {
  const counters = {
    requests: 0,
    requestsFailed: 0,
    retries: 0,
    records: 0,
    proxyFailures: 0,
  };
  let startedAt = Date.now();

  function inc(name, by = 1) {
    if (name in counters) counters[name] += by;
  }

  /** 快照：取一份计数副本并清零（用于按任务统计） */
  function snapshot() {
    const successRate =
      counters.requests === 0
        ? null
        : Number((1 - counters.requestsFailed / counters.requests).toFixed(3));
    return {
      ...counters,
      startedAt,
      elapsedMs: Date.now() - startedAt,
      successRate,
    };
  }

  function reset() {
    for (const key of Object.keys(counters)) counters[key] = 0;
    startedAt = Date.now();
  }

  /** 打印任务摘要日志（结构化，带时间戳） */
  function logSummary(label) {
    const s = snapshot();
    logger.info(`${label} 指标汇总`, {
      requests: s.requests,
      failed: s.requestsFailed,
      successRate: s.successRate,
      retries: s.retries,
      records: s.records,
      proxyFailures: s.proxyFailures,
      elapsedMs: s.elapsedMs,
    });
  }

  return { inc, snapshot, reset, logSummary };
}

/** 全局单例：MCP 长驻进程跨请求累计 */
module.exports = createMetrics();
module.exports.createMetrics = createMetrics;
