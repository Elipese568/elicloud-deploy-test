# 部署框架验证报告（elicloud-deploy-test）

本文件记录对本仓库使用的「自托管部署框架」（skill `init-deploy-framework`）所做的端到端验证。

**结论：框架真实可用。** 生成物与 skill 模板逐字节一致；链路
`push → PR → prod → GitHub Actions（人工审批）→ SSH scp+ssh → /srv/<app>/deploy.sh → Docker 容器`
已完整跑通（含幂等、失败传播、负向 guard 测试、真实应用健康检查）。
同时发现 4 处 skill 模板缺陷与 3 处部署环境约束，见第 4、5 节。

验证时间：2026-10-02（Asia/Shanghai）。

## 1. 验证环境

| 项 | 值 |
|---|---|
| 仓库 | `Elipese568/elicloud-deploy-test`（public，GitHub 免费版账号） |
| CI/CD | GitHub Actions（`ci.yml` / `deploy-prod.yml`） |
| 部署目标 | `146.56.237.33`（Ubuntu 24.04 / kernel 6.8），SSH 用户 `deploy`，端口 22 |
| Docker | 29.8.0，**snap 包安装**（`/snap/bin/docker`） |
| 本地环境 | Windows + git 2.47 + node 25 + Python 3.13 + gh CLI |

## 2. 端到端验证矩阵

| # | 验证项 | 结果 | 证据 |
|---|---|---|---|
| 1 | YAML 可解析 | ✅ | `yaml.safe_load` 解析 `ci.yml`、`deploy-prod.yml` 均通过 |
| 2 | shell 语法 | ✅ | 服务器 `bash -n deploy.sh bootstrap-server.sh`（bash 5.2.21）通过 |
| 3 | actionlint | ✅（修复后） | 初次 `ci.yml` 报 1 处 expression 错误 → 见 D1；修复后两个 workflow 全部 0 报错 |
| 4 | 无残留占位符 | ⚠️ | 4 处 `<app>` 仅存在于 `bootstrap-server.sh` 注释（来自 skill 模板本身），无 `TODO`、无 `__APP__` |
| 5 | `.sh` 为 LF | ✅ | `git ls-files --eol` → `i/lf w/lf attr/text eol=lf` |
| 6 | 生成物与模板一致 | ✅ | 5 个模板文件在 `__APP__` → `elicloud-deploy-test` 后逐字节相同 |
| 7 | CI：push 到 main | ✅ | run `37009258795` success（首次 `37009131222` 因测试命令写错而失败，见 D2 同源问题） |
| 8 | 负向：feature → prod 被拦 | ✅ | PR #1：`Guard prod source` **fail**、`Test and build` pass（run `37010741006`），未合并 |
| 9 | PR：feature → main | ✅ | PR #2 检查通过后 squash 合并（run `37010822581`） |
| 10 | PR：main → prod | ✅ | PR #3 两项检查全绿后合并（run `37010934340`），合并即触发部署 |
| 11 | 阶段一：构建并推镜像 | ✅ | run `37011027793` → `Build and push image` success（首次 `37010458839` 失败，见 D2） |
| 12 | 阶段一失败时阶段二不跑 | ✅ | run `37010458839`：image=failure → deploy=**skipped** |
| 13 | 人工审批闸口 | ✅ | deploy job 进入 `waiting`（environment `production`），审批后才执行 |
| 14 | 阶段二：scp 落点正确 | ✅ | `/srv/elicloud-deploy-test/deploy.sh` 941B、`755 deploy:deploy`、md5 `4beeaa22…` 与仓库 `deploy/deploy.sh` **一致**（无 `strip_components` 嵌套） |
| 15 | 阶段二：远程执行 | ✅ | job step `Run /srv/elicloud-***-test/***.sh` success，日志 `[deploy] ref=prod dir=/srv/elicloud-deploy-test` |
| 16 | deploy.sh 幂等 | ✅ | 服务器上连跑 3 次（`prod` / 无参数默认 / 显式 ref）全部 exit 0、输出一致 |
| 17 | 阶段一被跳过时阶段二仍执行 | ✅ | run `37011952039`（`DEPLOY_MODE=none`）：image=skipped → deploy job 正常执行 |
| 18 | 失败传播 | ✅ | 同一 run：`deploy.sh` 故意 `exit 3` → step **failure**、job failure；日志含 `##[error]Process completed with exit code 1` |
| 19 | 部署 ref 参数传递 | ✅ | 同上 run 日志 `[***] ref=v0.0.1-rollback dir=…`（回滚用的 ref 参数确实送达服务器） |
| 20 | Environment 部署分支策略生效 | ✅ | run `37011672695` 从 `test/failing-deploy` dispatch → job **2 秒失败、0 个步骤**（策略只允许 `prod`） |
| 21 | 真实部署：镜像 → 容器 → HTTP | ✅ | 镜像 digest `sha256:fdf169079…`；`/healthz` → `ok`；`/` → `{"app":"elicloud-deploy-test","version":"0.1.0","ref":"prod","node":"v22.23.3"}` |
| 22 | 配置与密钥分离 | ✅ | 上一步的 `version`/`ref` 正是服务器 `/srv/elicloud-deploy-test/app.env`（0600 deploy:deploy）里的值，不是仓库里的 |
| 23 | 容器幂等重建 | ✅ | `docker rm -f` + 重新 `docker run` 后健康检查结果一致 |

## 3. skill 生成物保真度

`deploy-prod.yml`、`deploy.sh`、`bootstrap-server.sh`、`README-deploy.md`、`.dockerignore`
五个文件与 `references/templates/` 对应模板做「`__APP__` → `elicloud-deploy-test` + LF 归一」后
**逐字节一致**，说明 `scripts/scaffold.ps1` 行为与模板完全对齐（含 LF 换行、不覆盖已有文件）。

`ci.yml` 按 `references/ci-recipes.md` 的 Node/npm 骨架编写，命令全部为本仓库真实存在的
`npm ci` / `npm run lint` / `npm test` / `npm run build`。

## 4. skill 模板缺陷（4 项，均已在本仓库修正或给出修法）

### D1（安全）`ci.yml` 的 `guard-prod-source` 存在脚本注入

模板把 `github.head_ref` 直接插进 shell：

```yaml
run: |
  if [ "${{ github.head_ref }}" != "main" ]; then ...
```

分支名可以包含 `"` `$` `;` 等字符，属于 GitHub 官方点名的脚本注入模式；
skill 自己要求跑的 `actionlint` 会对它报错（`expression` 规则）：

```
ci.yml:51:75: "github.head_ref" is potentially untrusted. avoid using it directly in inline scripts.
```

**修法**（本仓库已采用）：经 `env` 传入，shell 里只用变量。

```yaml
        env:
          BASE_REF: ${{ github.base_ref }}
          HEAD_REF: ${{ github.head_ref }}
        run: |
          set -euo pipefail
          if [ "${HEAD_REF}" != "main" ]; then exit 1; fi
```

实测（把该 run 体抽出来在服务器上跑三种输入）：`main` → exit 0；`feature/x` → exit 1；
恶意分支名 `evil"; echo INJECTION_SUCCEEDED; echo "` → **未执行注入**，仅作为字符串打印。

### D2 Node Dockerfile 配方假定项目有依赖

`references/dockerfile-recipes.md` 的 Node 多阶段模板含
`COPY --from=deps /app/node_modules ./node_modules`。当项目**零运行时依赖**时
`npm ci` 不创建 `node_modules`，构建直接失败：

```
ERROR: failed to compute cache key: "/app/node_modules": not found   （run 37010458839）
```

**修法**：零依赖项目去掉 `deps` 阶段（本仓库已改，并在 Dockerfile 注释里写明加依赖后如何补回）。
建议 skill 在配方里加一句提示，或改成 `RUN npm ci && mkdir -p node_modules`。

### D3 `README-deploy.md` 模板存在悬空引用

模板「首次部署」第 3 步写「详见仓库根的**部署清单** / `references/github-setup.md`」，
但 skill 的产出清单里**没有**「仓库根的部署清单」这个文件（清单按设计只出现在对话汇报中），
仓库里因此留下指向不存在文件的引用；而规范要求 Secrets/Variables/Environment/分支保护清单
（第 7 项）与配置密钥放置表（第 8 项）落到 README 或汇报。

**修法**（本仓库已做）：把《GitHub 配置清单（本仓库实际值）》《配置与密钥放置表》直接写进
`README-deploy.md`，并改掉那句悬空引用。

### D4 `deploy-prod.yml` 在 `workflow_dispatch` 回滚时破坏镜像语义

阶段一始终 checkout **触发分支**并按 `${GITHUB_SHA::7}` 打 tag，完全不引用 `inputs.ref`：

```yaml
      - name: Checkout
        uses: actions/checkout@v4          # 没有 ref: ${{ github.event.inputs.ref }}
      ...
          tags: |
            …:prod
            …:sha-${{ steps.meta.outputs.short_sha }}
```

于是「用 `workflow_dispatch` 传旧 ref 回滚」时，`:prod` 会被重新指向**当前分支的构建**，
而只有 `deploy.sh` 收到了旧 ref。若 `deploy.sh` 拉 `:prod`，回滚会实际部署成最新代码——
与 README/`references/github-setup.md` 描述的回滚流程矛盾（`DEPLOY_MODE=image` 时尤其危险）。

**建议修法**（模板层面）：

```yaml
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.inputs.ref || github.ref }}
```

并让 `short_sha` 取自该 ref 的 commit，或干脆让 `deploy.sh` 只按 `sha-<short>` 拉取。

## 5. 部署环境约束（写给 `deploy.sh` 的作者）

### E1 snap 版 Docker 看不到 `/srv`

本机 Docker 由 snap 安装，snap 有私有 `/tmp` 且 AppArmor 限制，实测（deploy 身份）：

| 探测 | 结果 |
|---|---|
| `docker run -v /srv/elicloud-deploy-test:/x …` | ✗ `mkdir /srv/…: read-only file system` |
| `docker run --env-file /srv/elicloud-deploy-test/app.env …` | ✗ `open /srv/…/app.env: no such file or directory` |
| `docker build /srv/elicloud-deploy-test/ctx` | ✗ `path "/srv/…" not found` |
| `docker build $HOME/ctx` | ✓ 成功 |

影响：`deploy.sh` 里**任何把 `/srv` 路径交给 docker 的写法都会失败**。
不影响：scp 上传 `/srv/<app>/deploy.sh`（走 SFTP，非 snap 约束）、`deploy.sh` 自身读 `/srv/<app>/app.env`。

绕法（本仓库验证用的真实部署脚本就是这么写的，见第 6 节）：变量由 shell `source app.env` 读出后用 `-e`
传给容器；不要在 snap Docker 下做 `/srv` 构建上下文或 bind mount。
更彻底的办法是把 Docker 换成官方 apt 源的 `docker-ce`。

### E2 `ghcr.io` 直连本机几乎不可用

从该服务器直连 ghcr.io 拉取本仓库镜像：进程反复重启、9 分钟无进展（`etime` 只增长十几秒即重置）。
改用 `ghcr.nju.edu.cn` 镜像源：**56 秒**拉取完成，digest `sha256:fdf169079cdf42d92286d752e00aa4488ff624734dd8f210af0ea986672494b3`。
该服务器上已存在 `ghcr.nju.edu.cn/...` 镜像，说明这是既有运维习惯。

建议：给 dockerd 配 `/etc/docker/daemon.json` 的 `registry-mirrors`（snap 版在
`/var/snap/docker/common/etc/daemon.json`），或让 `deploy.sh` 支持镜像源变量。

### E3 免费版账号：private 仓库无法使用分支保护与 Required reviewers

- 分支保护：`PUT /branches/main/protection` → **403** `Upgrade to GitHub Pro or make this repository public`
- Environment 审批：`PUT /environments/production`（带 reviewers）→ **422** `billing plan does not support the required reviewers protection rule`

本仓库因此改为 public，之后两项配置均成功（见 `README-deploy.md` 的清单段落）。
另外单账号不能给自己的 PR 审批，所以 `required_approving_review_count` 目前为 0。

### E4（次要）`SSH_USER=deploy` 会让 GitHub 把日志里的 "deploy" 全部打码

Actions 日志里 `Trigger remote deploy`、`/srv/elicloud-deploy-test` 等都会显示成
`Trigger remote ***`、`/srv/elicloud-***-test`（secret 值打码），排查日志时容易困惑。属正常行为，无法关闭。

## 6. 参考实现：`deploy.sh` 的「项目自定义部署逻辑」

框架只给骨架，真实逻辑由项目补。下面是本次验证实际跑通的最小实现（**未提交进 `deploy/deploy.sh`**，
以保持框架骨架纯净；需要上线时把它拷进 `deploy/deploy.sh` 即可）：

```bash
REF="${1:-prod}"                     # 已由框架解析
SHORT="<sha-<short> 的来源：由 CI 传入或按 ref 反查>"
APP_DIR="/srv/elicloud-deploy-test"
REGISTRY="ghcr.nju.edu.cn"           # ghcr.io 直连本机不可用，见 E2
IMAGE="${REGISTRY}/elipese568/elicloud-deploy-test:sha-${SHORT}"

docker pull "$IMAGE"

set -a; . "${APP_DIR}/app.env"; set +a   # snap Docker 读不了 /srv，必须由 shell 读出

docker rm -f elicloud-deploy-test >/dev/null 2>&1 || true
docker run -d --name elicloud-deploy-test --restart unless-stopped \
  -p 127.0.0.1:18080:8080 \
  -e APP_VERSION="$APP_VERSION" -e APP_REF="$REF" -e PORT=8080 \
  "$IMAGE"
```

实测输出：

```
/healthz -> ok
/ -> {"app":"elicloud-deploy-test","version":"0.1.0","ref":"prod","node":"v22.23.3","pid":1}
[app] elicloud-deploy-test 0.1.0 (ref=prod) listening on http://0.0.0.0:8080
```

## 7. 未验证 / 已知限制

- `deploy/deploy.sh` 按 skill 硬性约束**仍是骨架**（真实逻辑见第 6 节，未入库）。因此"部署成功"目前只意味着"脚本被正确调用并成功退出"。
- 真实部署验证用的是镜像源 `ghcr.nju.edu.cn`；`ghcr.io` 直连未跑通（E2）。
- 分支保护目前 `required_approving_review_count = 0`（单账号无法自审）。加协作者后建议调 1（main）/ 2（prod）。
- D4 未在模板层修复（本仓库 `deploy-prod.yml` 保持与 skill 模板一致），仅记录修法。
- 服务器上仍有一台验证用的容器 `elicloud-deploy-test`（`127.0.0.1:18080`，未暴露公网），
  如不需要：`docker rm -f elicloud-deploy-test`。
