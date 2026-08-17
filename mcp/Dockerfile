# webscraping-mcp — MCP server 容器镜像
# 基于 Playwright 官方镜像（自带 chromium），无需下载浏览器
# 构建:  docker build -t webscraping-mcp .
# 运行:  docker run --rm -i webscraping-mcp
#        （MCP 客户端以 stdio 方式连接：command 换成
#         docker run --rm -i webscraping-mcp）
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

# 只装运行时依赖（跳过 devDependencies）
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# 容器内用镜像自带的 chromium，而非系统 Chrome
ENV SCRAPING_CHANNEL=chromium
ENV LOG_TO_STDERR=1
# 代理配置示例（可选，逗号分隔）：
# ENV PROXY_LIST=http://user:pass@proxy.example.com:8080

COPY src ./src

# stdio 传输：保持 stdin/stdout 可管道
CMD ["node", "src/mcp_server.js"]
