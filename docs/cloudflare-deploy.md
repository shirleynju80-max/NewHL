# Cloudflare 部署方案

## 唯一发布链路：push 即部署

> 常规发布**只走这一条**，不要再手工跑 `pages deploy` / `release:worker-pages` 去推生产，避免「两条链路谁先生效」的混乱与陈旧。

**本项目实际形态（2026-06）**：`newhl-dashboard` 为 **Direct Upload** 项目——Cloudflare Dashboard 里**没有** Builds / Connect to Git，由 GitHub Actions [cloudflare-pages-deploy.yml](../.github/workflows/cloudflare-pages-deploy.yml) 在 push `main` 时 `npm run build` + `wrangler pages deploy`。

1. **前端 UI / 文案**：push `main` → Actions 构建 `dist/` → Pages Production（<https://newhl-dashboard.pages.dev/>）。
2. **行情 / 指数数据**：各 sync workflow 成功 → [cloudflare-r2-upload.yml](../.github/workflows/cloudflare-r2-upload.yml) 上传 R2 → Worker `/api/bundle` 读取。**通常不需要**为数据单独 redeploy Pages。
3. **Worker 代码**：仅在 `workers/data-api` 改动时手动 `wrangler deploy`。

生产环境数据加载顺序：配置了 `VITE_DATA_API_BASE_URL` 时**先请求 Worker（R2）**；失败则回退到构建时打进 `dist/data/` 的静态 CSV（仅作兜底，可能与 R2 不同步）。

`npm run release:worker-pages` **仅作本地/应急回退**，不是常规发布手段。

---

## 怎么确认对外网页已更新

Direct Upload 项目在 Cloudflare Deployments **通常没有 Assets 文件浏览器**，请用下面方式验收。

### 1. 部署是否成功

| 步骤 | 检查 |
|------|------|
| GitHub Actions | [cloudflare-pages-deploy.yml](../.github/workflows/cloudflare-pages-deploy.yml) 对应 commit 为绿色 ✓ |
| Cloudflare | Workers & Pages → `newhl-dashboard` → **Production** 区块 = 目标 commit / SHA |
| Actions 日志 | **Verify build artifacts** 步骤列出 `index-*.js`、`Home-*.js` |

### 2. UI 是否真的换新（常见误判）

Vite 按**文件内容** hash 命名 chunk。改配置总览等页面时，文案往往在懒加载的 **`Home-*.js`** 里，**`index-*.js` 文件名可能不变**，不能单靠 `index.html` 里的主包 hash 判断失败。

推荐验收：

1. 打开 <https://newhl-dashboard.pages.dev/>（无痕窗口或 Disable cache 后刷新）
2. 开发者工具 → **Network**，筛选 `Home-`，确认已加载新的 `Home-xxxxx.js`
3. 或直接看页面：配置总览小字、页底两行免责声明是否为新文案

可选命令（将 `Home-xxxxx.js` 换为 Network 里看到的文件名）：

```bash
curl -sL "https://newhl-dashboard.pages.dev/assets/index-B-fOP-wd.js" | grep -o 'Home-[^"]*\.js' | head -1
curl -sL "https://newhl-dashboard.pages.dev/assets/Home-xxxxx.js" | grep '近5年窗口'
```

### 3. 数据是否为新（与 UI 分开）

| 改了什么 | 需要什么 |
|----------|----------|
| React 组件 / 文案 | push `main`（Pages deploy） |
| sync 脚本产出的 CSV | 等 sync workflow → R2 upload；**不必** redeploy Pages |
| Worker 逻辑 | 手动 `wrangler deploy` |

站内若长期显示「示例数据」或明显旧日期，查 Worker / R2，而不是 Pages 部署。

### 4. 仍像旧版时

- Safari / 微信：关标签重开，或清缓存后再访问（`/assets/*` 缓存 1 年 immutable）
- Cloudflare Production 已是新 commit 但页面旧：看 Network 是否仍命中旧 `Home-*.js`
- Actions 绿但 Production 未变：Deployments 是否误在 Preview → **Promote to production**（`--branch=main` 已配置时较少见）

---

## 目标架构

- 前端公开访问：Cloudflare Pages 托管 `dist/`
- 数据主路径：Worker 从 R2 读取 CSV（非公开静态目录）
- 本地开发：仍可读取 `public/data/*.csv`

## 1. 创建 R2 Bucket

```bash
npx wrangler login
npx wrangler r2 bucket create newhl-data
```

## 2. 上传本地 CSV 到 R2

在项目根目录执行（推荐，默认上传到远端 R2）：

```bash
npm run r2:upload
```

如需手动逐个上传，务必带 `--remote`（否则会写到本地模拟存储）：

```bash
npx wrangler r2 object put newhl-data/etfs.csv --file public/data/etfs.csv --remote
npx wrangler r2 object put newhl-data/bars.csv --file public/data/bars.csv --remote
npx wrangler r2 object put newhl-data/etf_params.csv --file public/data/etf_params.csv --remote
npx wrangler r2 object put newhl-data/bonds.csv --file public/data/bonds.csv --remote
```

## 3. 发布 Worker 数据 API

```bash
cd workers/data-api
npx wrangler deploy
```

部署后会得到类似：

```text
https://newhl-data-api.<your-subdomain>.workers.dev
```

测试：

```bash
curl https://newhl-data-api.<your-subdomain>.workers.dev/api/bundle
```

## 4. 发布 Pages 前端（应急 / 历史说明）

> **常规不走本节。** 生产由 push `main` 触发 GitHub Actions 自动 deploy（见文首）。下列为 Git 直连 Pages 或本地 wrangler 直传时的参考配置。

若改用 Cloudflare **Connect to Git** 构建，仓库为 `shirleynju80-max/NewHL`，配置示例：

- Framework preset: `None` 或 `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Node.js version: `20` 或 `22`

环境变量：

```text
VITE_DATA_API_BASE_URL=https://newhl-data-api.<your-subdomain>.workers.dev
```

`public/_redirects` 已配置 SPA fallback，详情页刷新不会 404。

### 一键发布（R2 + Worker + Pages）——本地/应急回退

> 仅在 push 即部署链路不可用（如 Pages Git 集成临时失效）时使用；正常情况下不要用它推生产。

已提供发布脚本（默认使用 `newhl-data-api.shirleynju80.workers.dev`）：

```bash
npm run release:worker-pages
```

可选环境变量：

```bash
WORKER_URL=https://newhl-data-api.<your-subdomain>.workers.dev \
PAGES_PROJECT_NAME=newhl-dashboard \
PAGES_BRANCH=main \
npm run release:worker-pages
```

## 5. GitHub Actions

仓库已包含：

- [.github/workflows/cloudflare-r2-upload.yml](../.github/workflows/cloudflare-r2-upload.yml)：将 `public/data/*.csv` 上传到 R2；可在实时 / 指数同步成功后自动触发，或手动 `workflow_dispatch`。
- [.github/workflows/cloudflare-pages-deploy.yml](../.github/workflows/cloudflare-pages-deploy.yml)：**生产前端唯一常规链路**——`npm run build` + `wrangler pages deploy`（`--branch=main` + `--commit-hash`；构建后 **Verify build artifacts** 输出 chunk 列表供验收）。

**wrangler 直传常见坑**：Actions 显示 deploy 成功，但页面仍像旧版 → 先按上文「怎么确认对外网页已更新」查 `Home-*.js` 与缓存；若 Production commit 未变，到 Deployments **Promote to production**。

所需 Secrets：

| Secret | 用途 |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | wrangler 部署 Worker / 上传 R2 / Pages |
| `CLOUDFLARE_ACCOUNT_ID` | wrangler 账户 ID |
| `VITE_DATA_API_BASE_URL` | Pages 构建时注入 Worker URL |
| `HSI_LOGIN_USERNAME` | 恒生 IndexLab 登录邮箱；`index-t1-sync` 每次运行前自动登录拉取 HSI114/HSSCSOY.HI |
| `HSI_LOGIN_PASSWORD` | 恒生 IndexLab 登录密码（与 `HSI_LOGIN_USERNAME` 配对） |
| `HSI_ACCESS_TOKEN` | （可选，legacy）短期 accessToken；未配置账密时可临时使用 |
| `FEISHU_WEBHOOK_URL` | （可选）飞书机器人 webhook，接收指数同步告警 |
| `FEISHU_BOT_SECRET` | （可选但建议）飞书机器人签名密钥；开启签名校验时必填 |
| `WECOM_WEBHOOK_URL` | （可选）企业微信机器人 webhook，接收指数同步告警 |

说明：`index-t1-sync` 默认会对恒生同步做最多 3 次重试（网络抖动自愈），并按**工作日**检测 `HSI114` / `HSSCSOY.HI` 是否陈旧（默认阈值 3 个工作日）。

本地上传脚本：`npm run r2:upload`（默认使用 `npx wrangler@4.95.0` + `--remote`）。

## 6. 自动更新建议

第一阶段建议：

1. 本地或私有环境运行同步脚本，生成 `public/data/*.csv`
2. 用 `wrangler r2 object put` 上传到 R2
3. 前端无需重新部署，刷新页面会通过 Worker 读取最新 R2 数据

第二阶段再做 GitHub Actions：

- 公开接口脚本可直接在 Actions 跑
- 需要登录态的数据放到 GitHub Secrets，例如 `HSI_LOGIN_USERNAME` + `HSI_LOGIN_PASSWORD`
- 禁止把 token 写入仓库、前端环境变量或 `public/`

注意：公开前端为了画图仍会从 Worker API 收到图表所需数据；R2 只是避免原始 CSV 作为静态文件公开和避免数据源凭证暴露。若要完全隐藏原始序列，需要把指标计算和分页查询继续后移到 Worker。
