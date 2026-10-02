# elicloud-deploy-test 部署说明

本仓库使用「GitHub Actions 触发 + 服务器自管」的自托管部署框架。

框架只负责**触发和调用**，不关心项目怎么构建、怎么运行；一切具体部署逻辑都在服务器的
`/srv/elicloud-deploy-test/deploy.sh` 里。

## 本项目实际信息

| 项 | 值 |
|---|---|
| 技术栈 | Node.js 22（`node:http`，零运行时依赖，无第三方包） |
| 应用名 `<app>` | `elicloud-deploy-test` → 远程目录 `/srv/elicloud-deploy-test` |
| 部署目标 | `146.56.237.33`（Ubuntu，Docker 29.8），SSH 用户 `deploy`，端口 `22` |
| CI 命令 | `npm ci` → `npm run lint` → `npm test` → `npm run build`（产物 `dist/`） |
| 镜像 | `ghcr.io/elipese568/elicloud-deploy-test:prod` 与 `:sha-<short>`（`DEPLOY_MODE=image`） |
| 部署入口 | `/srv/elicloud-deploy-test/deploy.sh`（`deploy:deploy` 0750，每次由 Actions 上传覆盖） |
| 运行时变量 | `/srv/elicloud-deploy-test/app.env`（`APP_VERSION` / `APP_REF` / `PORT`，0600 deploy:deploy） |
| 密钥 | 仓库 Actions Secret `SSH_KEY`（部署私钥）；公钥在 `/home/deploy/.ssh/authorized_keys` |

> `deploy/deploy.sh` 按框架约定只保留骨架；真实部署逻辑（拉镜像、切容器、滚动重启）由本项目
> 写进该文件的「项目自定义部署逻辑」段，示例见 `VALIDATION.md`。

## 部署架构

```
      feature/* ──PR──▶ main ──PR──▶ prod
                         │            │
                    push │            │ push / workflow_dispatch(ref)
                         ▼            ▼
              ┌──────────────────┐  ┌───────────────────────────────────────┐
              │ CI  ci.yml       │  │ Deploy  deploy-prod.yml               │
              │  检出            │  │  ① (可选) 构建镜像 → ghcr.io          │
              │  安装依赖        │  │     仅当 vars.DEPLOY_MODE == image    │
              │  测试            │  │  ② scp deploy/deploy.sh → /srv/elicloud-deploy-test│
              │  构建            │  │  ③ ssh 执行 /srv/elicloud-deploy-test/deploy.sh REF│
              └──────────────────┘  │  environment: production（人工审批）  │
                                    └──────────────────┬────────────────────┘
                                                       │ SSH（deploy 用户 + 私钥）
                                                       ▼
                                    ┌───────────────────────────────────────┐
                                    │ 服务器  /srv/elicloud-deploy-test/                 │
                                    │   deploy.sh   ← 随仓库版本管理         │
                                    │   app.env     ← 运行时环境变量（600）  │
                                    │   项目自己的构建产物 / 容器 / 进程     │
                                    └───────────────────────────────────────┘
```

## 分支模型

| 分支 | 用途 | 合并规则 |
|---|---|---|
| `main` | 集成分支，日常 PR 合入，跑 CI | 需要 PR + CI 通过 |
| `prod` | 发布分支，受保护 | 只允许从 `main` 发 PR 合并；合并即触发部署 |
| `feature/*` | 功能分支 | 从 `main` 拉出，PR 回 `main` |

## 首次部署

1. **服务器初始化**（root）
   ```bash
   scp scripts/bootstrap-server.sh <user>@<host>:/tmp/
   ssh <user>@<host> 'sudo bash /tmp/bootstrap-server.sh elicloud-deploy-test'
   ```
   脚本会创建 `deploy` 用户、`/srv/elicloud-deploy-test`（deploy:deploy 750）、空的
   `/srv/elicloud-deploy-test/app.env`，并把 deploy 加入 docker 组（若装了 Docker）。

2. **配置 SSH 免密**（按脚本最后打印的步骤）：生成部署专用密钥对，公钥写入
   `/home/deploy/.ssh/authorized_keys`，私钥内容写入 GitHub Secrets `SSH_KEY`。

3. **填写 GitHub 配置**：Secrets（`SSH_HOST`/`SSH_USER`/`SSH_KEY`/`SSH_PORT`）、
   Variables（`DEPLOY_MODE`）、Environment `production`（带 Required reviewers）、
   分支保护规则。详见仓库根的部署清单 / `references/github-setup.md`。

4. **写实部署逻辑**：编辑仓库 `deploy/deploy.sh` 的「项目自定义部署逻辑」段，
   实现拉代码 / 装依赖 / 构建 / 重启服务。

5. **填充运行时环境变量**：在服务器上编辑 `/srv/elicloud-deploy-test/app.env`。

6. **首次发布**：GitHub → Actions → **Deploy to production** → *Run workflow*，
   `ref` 填 `prod`。人工审批通过后，Actions 会把 `deploy.sh` 上传到
   `/srv/elicloud-deploy-test/deploy.sh` 并执行。

## 日常发布流程

```bash
git switch main && git pull
git switch -c feature/xxx
# ... 开发 ...
git push -u origin feature/xxx        # 开 PR → main，等 CI 通过并合并
```
然后发 PR：`main` → `prod`。合并到 `prod` 即自动走 `deploy-prod.yml`：
先（可选）推镜像，再上传并执行 `/srv/elicloud-deploy-test/deploy.sh prod`。

## 回滚流程

两种方式，都只是把同一个 `deploy.sh` 用另一个 ref 再跑一次：

1. **GitHub Actions 回滚（推荐）**
   Actions → *Deploy to production* → *Run workflow* →
   `ref` 填上一个可用版本：`prod` 之前的 tag（如 `v1.3.0`）、commit SHA，或分支名。

2. **服务器上手工回滚**
   ```bash
   sudo -u deploy /srv/elicloud-deploy-test/deploy.sh <ref>
   ```

镜像 tag 保留策略（`DEPLOY_MODE=image` 时）：每次部署推两个 tag —— `prod`（移动）
与 `sha-<short>`（不可变）。`sha-<short>` 是回滚锚点，请保留最近 N 个（建议 ≥10），
在镜像仓库里配置保留规则或定期清理；`prod` 永远指向当前线上版本。

## 常见问题排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| Actions 里 scp 一步失败 | `SSH_HOST`/`SSH_USER`/`SSH_PORT` 写错；私钥与服务器公钥不匹配；`/srv/elicloud-deploy-test` 不存在或不可写 | 用 `ssh -i deploy_key deploy@host` 复现；确认目录 `deploy:deploy 750` |
| `deploy.sh: Permission denied` | 服务器上文件没有可执行位 | workflow 已 `chmod +x`；手工上传时记得 `chmod +x` |
| `deploy.sh` 报 `bad interpreter: ...^M` | 上传/提交时带了 CRLF 换行 | `.gitattributes` 里加 `*.sh text eol=lf`，重新提交 |
| ssh-action 提示超时 | 构建时间长于 `command_timeout` | 调大 `command_timeout`，或把耗时构建放到阶段一 |
| 阶段一失败后阶段二没跑 | 这是设计行为：阶段一失败则部署中止 | 修好构建再重跑 |
| 阶段二显示 skipped | `DEPLOY_MODE` 既不是 `image`，但同时阶段一被跳过时不应 skip | 检查 `deploy` job 的 `if` 条件是否被改动 |
| 部署成功但应用没更新 | `deploy.sh` 里没有真正的重启/切换逻辑（骨架默认什么都不做） | 补齐 `deploy.sh` 的项目部署逻辑 |
| Actions 拿不到运行时变量 | 运行时变量属于服务器 `app.env`，不在 Actions 里 | 在服务器上编辑 `/srv/elicloud-deploy-test/app.env` |

## 相关文件与配置位置

| 文件 / 配置 | 位置 | 说明 |
|---|---|---|
| CI 工作流 | `.github/workflows/ci.yml` | PR 到 main/prod、push 到 main |
| 部署工作流 | `.github/workflows/deploy-prod.yml` | push 到 prod、workflow_dispatch |
| 部署脚本（版本管理） | `deploy/deploy.sh` | 上传到 `/srv/elicloud-deploy-test/deploy.sh` 执行 |
| 服务器初始化脚本 | `scripts/bootstrap-server.sh` | 在服务器上以 root 跑一次 |
| 部署密钥与服务器信息 | GitHub Secrets | `SSH_HOST`/`SSH_USER`/`SSH_KEY`/`SSH_PORT` |
| 部署模式开关 | GitHub Variables | `DEPLOY_MODE=image` 才构建推镜像 |
| 运行时环境变量 | 服务器 `/srv/elicloud-deploy-test/app.env` | 600，`deploy:deploy`，不进仓库 |
