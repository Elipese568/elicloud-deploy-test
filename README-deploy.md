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
   分支保护规则。具体值见本文档「GitHub 配置清单（本仓库实际值）」。

4. **写实部署逻辑**：编辑仓库 `deploy/deploy.sh` 的「项目自定义部署逻辑」段，
   实现拉代码 / 装依赖 / 构建 / 重启服务。

5. **填充运行时环境变量**：在服务器上编辑 `/srv/elicloud-deploy-test/app.env`。

6. **首次发布**：GitHub → Actions → **Deploy to production** → *Run workflow*，
   `ref` 填 `prod`。人工审批通过后，Actions 会把 `deploy.sh` 上传到
   `/srv/elicloud-deploy-test/deploy.sh` 并执行。

## GitHub 配置清单（本仓库实际值）

### Secrets（Settings → Secrets and variables → Actions → Secrets）

| Secret | 值 |
|---|---|
| `SSH_HOST` | `146.56.237.33` |
| `SSH_USER` | `deploy` |
| `SSH_PORT` | `22` |
| `SSH_KEY` | 部署私钥全文（ed25519；公钥在服务器 `/home/deploy/.ssh/authorized_keys`） |
| `GHCR_TOKEN` | 不需要（同仓库推 `ghcr.io` 用内置 `GITHUB_TOKEN`） |

```bash
gh secret set SSH_HOST --body '146.56.237.33'
gh secret set SSH_USER --body 'deploy'
gh secret set SSH_PORT --body '22'
gh secret set SSH_KEY < ./deploy_key        # 部署私钥文件
```

### Variables（同页面 Variables 标签，**必须是仓库级**）

| Variable | 值 | 说明 |
|---|---|---|
| `DEPLOY_MODE` | `image` | `image` → 阶段一构建并推镜像；其它值/留空 → 阶段一跳过，只跑阶段二 |

```bash
gh variable set DEPLOY_MODE --body 'image'
```

> `image` job 没有 `environment:`，读不到 Environment 级变量，所以 `DEPLOY_MODE` 必须配成仓库级。

### Environment：`production`

- **Required reviewers**：仓库所有者（部署前必须人工 Approve）
- **Deployment branches**：仅 `prod`
- ⚠️ 因为限制了部署分支，用 `workflow_dispatch` 回滚时**必须在 UI 里把分支选成 `prod`**；
  用默认分支（main）会被策略直接拒绝，job 在 2 秒内失败且没有任何步骤日志。

### 分支保护

| 分支 | 规则 |
|---|---|
| `main` | 需要 PR；必过检查 `Test and build`（勾选 Require branches to be up to date）；禁 force push / 禁删除 |
| `prod` | 需要 PR；必过检查 `Test and build` + `Guard prod source`；禁 force push / 禁删除；只允许从 main 发 PR（由 `Guard prod source` 强制） |

> 两个坑（实测）：
> 1. **免费版账号的 private 仓库无法使用分支保护与 Required reviewers**（API 返回 403/422），
>    必须把仓库设为 public 或升级 GitHub Pro。本仓库为 public。
> 2. 单账号**无法给自己的 PR 审批**，所以 `required_approving_review_count` 目前设为 0
>    （仍是"必须走 PR"）。加了协作者之后建议调到 1（main）/ 2（prod）。

## 配置与密钥放置表

| 变量 / 配置 | 位置 | 用途 |
|---|---|---|
| `SSH_HOST` / `SSH_USER` / `SSH_PORT` | GitHub Secrets | Actions 连哪台机器、以谁登录 |
| `SSH_KEY` | GitHub Secrets | 部署私钥（Actions 侧唯一凭据） |
| 对应公钥 | 服务器 `/home/deploy/.ssh/authorized_keys`（600） | 校验上面的私钥 |
| `GITHUB_TOKEN` | Actions 内置，无需配置 | 同仓库推 `ghcr.io` 镜像（靠 `packages: write`） |
| `DEPLOY_MODE` | GitHub Variables（仓库级） | `image` → 阶段一构建推镜像 |
| `APP_VERSION` / `APP_REF` / `PORT` | 服务器 `/srv/elicloud-deploy-test/app.env`（600，deploy:deploy） | 应用运行时变量，由 `deploy.sh` 读出后用 `-e` 传给容器 |
| 数据库口令、第三方 API Key 等 | 服务器 `/srv/elicloud-deploy-test/app.env` | 不进仓库、不进 Actions |
| 部署 ref（`prod` / tag / commit SHA） | 由 Actions 作为参数传给 `deploy.sh` | 决定这次部署哪个版本 |
| 人工运维私钥 | 本机 `~/.ssh/`（如 `C:\Users\<you>\.ssh\...`） | 仅供人登录服务器，与 Actions 无关 |

规则：**部署环节的凭据只走 GitHub Secrets；应用运行时的变量只在服务器 `app.env`。**
两边都不要写进仓库，也不要在 workflow 里 `echo` 出来。

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
   - ⚠️ UI 里的**分支必须选 `prod`**：Environment 的 Deployment branches 只允许 `prod`，
     用默认分支 dispatch 会被策略直接拒绝（job 2 秒失败、无步骤日志）。
   - ⚠️ `DEPLOY_MODE=image` 时阶段一仍会按**触发分支**构建并把 `:prod` 重新指向它，
     只有 `deploy.sh` 收到旧 ref。详见 `VALIDATION.md` D4。

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
