// elicloud-deploy-test 的最小 HTTP 服务。
// 运行时配置全部来自环境变量（服务器上的 /srv/elicloud-deploy-test/app.env），
// 不写死在代码里，用来验证「配置与密钥分离」这条约束。
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

export const APP_NAME = "elicloud-deploy-test";
export const APP_VERSION = process.env.APP_VERSION || "dev";
export const APP_REF = process.env.APP_REF || "local";

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function createApp() {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("ok\n");
      return;
    }

    if (url.pathname === "/") {
      sendJson(res, 200, {
        app: APP_NAME,
        version: APP_VERSION,
        ref: APP_REF,
        node: process.version,
        pid: process.pid,
        time: new Date().toISOString(),
      });
      return;
    }

    sendJson(res, 404, { error: "not found", path: url.pathname });
  });
}

export function start(port = Number(process.env.PORT || 8080), host = "0.0.0.0") {
  const server = createApp();
  server.listen(port, host, () => {
    console.log(`[app] ${APP_NAME} ${APP_VERSION} (ref=${APP_REF}) listening on http://${host}:${port}`);
  });
  return server;
}

// 只有当本文件被直接执行（node src/server.js）时才启动监听；
// 被测试 import 时不启动，便于在随机端口上跑断言。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = start();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      console.log(`[app] received ${signal}, shutting down`);
      server.close(() => process.exit(0));
    });
  }
}
