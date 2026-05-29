# Cloudflare 部署方案

## 唯一发布链路：push 即部署

> 常规发布**只走这一条**，不要再手工跑 `pages deploy` / `release:worker-pages` 去推生产，避免「两条链路谁先生效」的混乱与陈旧。

1. **前端**：Cloudflare Pages 直连 GitHub 仓库，`main` 分支为 Production branch。push `main` → 自动 `npm run build` 并发布到生产（无需 Promote）。
2. **数据**：`cloudflare-r2-upload` Action 在「Realtime crawler」/「Index T-1 sync」成功后自动把 `public/data/*.csv` 上传到 R2（也可 `workflow_dispatch` 手动触发）。Worker `/api/bundle` 实时从 R2 读取，前端**不打包 CSV**。
3. **Worker**：属稳定基础设施，仅在 `workers/data-api` 改动时手动 `wrangler deploy` 一次。

前置一次性配置：Pages 项目里设好构建命令 `npm run build`、输出目录 `dist`、环境变量 `VITE_DATA_API_BASE_URL`（指向 Worker）。

`npm run release:worker-pages` 与 `Cloudflare Pages deploy (manual)` workflow **仅作本地/应急回退**，不是常规发布手段。

---

目标：

- 前端公开访问：Cloudflare Pages 托管 `dist/`
- 数据不作为静态 `/data/*.csv` 暴露：Cloudflare Worker 从私有 R2 bucket 读取 CSV
- 本地开发仍可读取 `public/data/*.csv`

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

## 4. 发布 Pages 前端

Cloudflare Pages 连接 GitHub 仓库 `shirleynju80-max/NewHL`。

构建配置：

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

## 5. GitHub Actions（可选）

仓库已包含：

- [.github/workflows/cloudflare-r2-upload.yml](../.github/workflows/cloudflare-r2-upload.yml)：将 `public/data/*.csv` 上传到 R2；可在实时 / 指数同步成功后自动触发，或手动 `workflow_dispatch`。
- [.github/workflows/cloudflare-pages-deploy.yml](../.github/workflows/cloudflare-pages-deploy.yml)：手动构建并 `pages deploy`（须加 `--branch=main` 与 Production branch 一致，否则只进 Preview）。

**wrangler 直传常见坑**：Actions 显示 deploy 成功，但 `newhl-dashboard.pages.dev` 仍是旧版 → 到 Cloudflare **Deployments** 把最新部署 **Promote to production**，或 workflow 使用 `--branch=main` 后重跑。

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
