import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { APP_NAME, createApp } from "../src/server.js";

describe("elicloud-deploy-test HTTP 服务", () => {
  let server;
  let base;

  before(async () => {
    server = createApp();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("/healthz 返回 ok", async () => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.equal((await res.text()).trim(), "ok");
  });

  it("/ 返回应用元数据", async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.app, APP_NAME);
    assert.equal(body.app, "elicloud-deploy-test");
    assert.ok(typeof body.version === "string");
  });

  it("未知路径返回 404", async () => {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "not found");
  });
});
