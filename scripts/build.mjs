// 构建步骤：把 src/ 原样拷到 dist/，并写入一份构建元数据。
// 目的是让 CI / Dockerfile 里的 `npm run build` 是一步真实、可验证的构建，
// 而不是空命令。
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(root, "src"), path.join(dist), { recursive: true });
await writeFile(
  path.join(dist, "build-info.json"),
  JSON.stringify(
    {
      app: pkg.name,
      version: process.env.APP_VERSION || pkg.version,
      ref: process.env.APP_REF || process.env.GITHUB_SHA || "local",
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);

console.log(`[build] dist/ ready (app=${pkg.name} version=${pkg.version})`);
