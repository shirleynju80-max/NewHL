# Cloudflare 部署方案

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

在项目根目录执行：

```bash
npx wrangler r2 object put newhl-data/etfs.csv --file public/data/etfs.csv
npx wrangler r2 object put newhl-data/bars.csv --file public/data/bars.csv
npx wrangler r2 object put newhl-data/etf_params.csv --file public/data/etf_params.csv
npx wrangler r2 object put newhl-data/bonds.csv --file public/data/bonds.csv
npx wrangler r2 object put newhl-data/barsmore.csv --file public/data/barsmore.csv
npx wrangler r2 object put newhl-data/indices.csv --file public/data/indices.csv
npx wrangler r2 object put newhl-data/index_bars.csv --file public/data/index_bars.csv
npx wrangler r2 object put newhl-data/index_tracking_etfs.csv --file public/data/index_tracking_etfs.csv
```

可选文件存在时再上传：

```bash
npx wrangler r2 object put newhl-data/etfsmore.csv --file public/data/etfsmore.csv
npx wrangler r2 object put newhl-data/bondsmore.csv --file public/data/bondsmore.csv
npx wrangler r2 object put newhl-data/fund_bars.csv --file public/data/fund_bars.csv
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
| `HSI_ACCESS_TOKEN` | 恒生 Index360 登录 token；用于 `index-t1-sync` 自动补齐 `HSI114`/`HSSCSOY.HI` |
| `FEISHU_WEBHOOK_URL` | （可选）飞书机器人 webhook，接收指数同步告警 |
| `FEISHU_BOT_SECRET` | （可选但建议）飞书机器人签名密钥；开启签名校验时必填 |
| `WECOM_WEBHOOK_URL` | （可选）企业微信机器人 webhook，接收指数同步告警 |

说明：`index-t1-sync` 默认会对恒生同步做最多 3 次重试（网络抖动自愈），并按**工作日**检测 `HSI114` / `HSSCSOY.HI` 是否陈旧（默认阈值 3 个工作日）。

本地一键上传脚本：`npm run r2:upload`（等价于 `scripts/cloudflare/upload_public_data_to_r2.sh`）。

## 6. 自动更新建议

第一阶段建议：

1. 本地或私有环境运行同步脚本，生成 `public/data/*.csv`
2. 用 `wrangler r2 object put` 上传到 R2
3. 前端无需重新部署，刷新页面会通过 Worker 读取最新 R2 数据

第二阶段再做 GitHub Actions：

- 公开接口脚本可直接在 Actions 跑
- 需要登录态的 token 放到 GitHub Secrets，例如 `HSI_ACCESS_TOKEN`
- 禁止把 token 写入仓库、前端环境变量或 `public/`

注意：公开前端为了画图仍会从 Worker API 收到图表所需数据；R2 只是避免原始 CSV 作为静态文件公开和避免数据源凭证暴露。若要完全隐藏原始序列，需要把指标计算和分页查询继续后移到 Worker。
