// 可选 Prometheus 指标端点（零依赖，Node 内置 http）：
//   GET /metrics  Prometheus 文本格式指标
//   GET /healthz  健康检查（返回 200 ok）
// 配置：SCRAPING_METRICS_PORT=9100（未设置则不启动）
// 注意：仅绑定 127.0.0.1，不对外暴露。
const http = require('http');
const config = require('../config');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const { prometheusText } = require('../utils/metrics');

let server = null;

/** 启动指标 HTTP 端点（幂等，端口为 0 时不启动） */
function startMetricsServer() {
  const port = config.metrics.port;
  if (!port || server) return;
  server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok\n');
      return;
    }
    if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
      res.end(prometheusText(metrics.snapshot()));
      return;
    }
    res.writeHead(404);
    res.end('not found\n');
  });
  server.listen(port, '127.0.0.1', () => {
    logger.info(`指标端点已启动：http://127.0.0.1:${port}/metrics`);
  });
  server.on('error', (err) => {
    logger.warn('指标端点启动失败', { error: err.message });
    server = null;
  });
}

/** 关闭指标端点（进程退出时调用） */
function stopMetricsServer() {
  if (server) {
    server.close();
    server = null;
  }
}

module.exports = { startMetricsServer, stopMetricsServer };
