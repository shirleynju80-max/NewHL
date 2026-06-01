# Agent notes

**价值底仓配置台** — Vite + React，数据来自 `public/data/*.csv`（可选 Worker `/api/bundle`）。

面向 AI 助手的项目说明（[agents.md](https://agents.md) 惯例）。细节口径以 `docs/` 为准，本文件只写高频约束与踩坑。

## 必读

- [docs/project-status.md](docs/project-status.md) — 状态、口径、命令
- [docs/current-handoff.md](docs/current-handoff.md) — 当前交接与未完成项
- [docs/csv-schema.md](docs/csv-schema.md) — CSV 字段口径
- [docs/ui-spec.md](docs/ui-spec.md) — UI 设计规范 + 文案术语表（改视觉/文案必读）
- [scripts/index_data_sync/README.md](scripts/index_data_sync/README.md) — 指数数据同步
- [docs/cloudflare-deploy.md](docs/cloudflare-deploy.md) — 部署

## 常用命令

```bash
npm run dev
npm run build                    # 改完至少跑一遍
npm test                         # 核心金融逻辑单测
npm run lint                     # ESLint（react-hooks + ts）
npm run format                   # Prettier 全量格式化
```

**发布**：`push main` → GitHub Actions 构建并部署 Pages（Direct Upload）；数据 sync 成功后刷新 R2。验收：Actions **Cloudflare Pages deploy** 三步 ✓（含 **Verify production site**）。`npm run release:worker-pages` 仅应急。见 [docs/cloudflare-deploy.md](docs/cloudflare-deploy.md)。

## Agent 行为准则（Karpathy 四条 + 开源惯例）

来源：[Karpathy 关于 LLM 写代码的观察](https://x.com/karpathy/status/2015883857489522876)；社区整理 [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills)。LLM Wiki 模式里用 schema 文件（如本 `AGENTS.md`）约束 agent，见 [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)。

1. **先想清楚再写** — 显式写出假设；有多种理解时列出来，不要默默选一种；有更简单做法要说；不清楚就停下来问，不要带着困惑硬做。
2. **简单优先** — 只实现当前需求；不为单次使用造抽象；不写未要求的“可配置/可扩展”；200 行能 50 行解决就重写。
3. **手术式修改** — 只动与任务直接相关的行；不顺手“优化”邻近代码、注释、格式；不删用户没让删的旧死代码（可提示）；自己改动产生的无用 import 要清掉。
4. **目标可验证** — 把“修好/加上”变成可检查的结果（如 `npm run build` 通过、某页某列可见、某 API 返回 200）；多步任务先列简短计划与每步验收方式。

**渐进披露**：字段定义、部署细节、同步脚本不要堆进本文件；需要时读 `docs/` 对应文档。

## 产品设计

- **站在用户视角，而非开发者视角**：文案、表头、空态、错误提示回答“我能做出什么判断”，而不是“数据从哪来、用了哪个文件/接口”。
- 页面上避免 `public/data`、`CSV`、内部字段名；代理数据、回测/监控、非投资建议等**必须对用户可见**。
- 首屏与移动端：宁可短加载文案，也不要让用户以为“没数据”；表格首列要认得清标的名称。
- 同一概念（如分位数、触发状态）在不同页面口径与用词要一致，降低跨页理解成本。

## 约定

- 指数层：研究、全收益绩效、股息率/利差；ETF 层：产品落地与盘中执行
- 缺数据留空，禁止对 `div_yield_nominal_pct` 前向填充
- 勿向本仓库添加与看板无关的 openskills / 通用 agent 技能包
- **未经用户明确要求，不要 `git commit` / `git push`**

## 接手流程

1. 先跑 `git status --short`，确认工作区里哪些是已有改动；不要回滚未确认的用户/Cursor 改动。
2. 读 `docs/current-handoff.md` 和本文件，再定位相关源码；不要靠聊天记忆直接改。
3. 修改前先用 `rg` 找到唯一来源；同一文案/逻辑可能同时存在于页面、组件、数据 helper。
4. 每次只收敛当前明确需求；UI 大改、数据爬虫、部署不要混在一个小修里。
5. 改完至少跑 `npm run build`；涉及浏览器可见 UI 时，用本地页面复查目标元素是否消失/生效。

## 本仓库踩坑（开发经验）

| 现象 | 处理 |
|------|------|
| Safari / 微信内浏览器刷新后白屏 | `index.html` 与 `public/_headers` 的 no-cache；强刷仍白屏则关标签重开或无痕；线上以 Actions **Verify production site** 为准 |
| Safari（手机/电脑）感觉特别慢、别的浏览器正常 | 多半是 Safari 旧缓存/BFCache 残留：清缓存（`⌥⌘E`）/无痕/`?v=` 干净加载即恢复。iOS 上 Safari 与微信同用 WebKit，引擎/CPU 一致，差异基本来自缓存状态 |
| 对外网页加载慢（尤其手机/微信） | 两个主因：① `text/csv` 不在 Cloudflare 默认压缩名单，CSV 原样下发；② 前端 `no-store`+`?_t` 绕过缓存。已分别用 `_headers` content-type 改写 + 前端去时间戳解决，见下两行 |
| `/data/*.csv` 传输未压缩（`index_bars.csv` 3MB+） | Cloudflare 不压缩 `text/csv`；`public/_headers` 把 `/data/*.csv` 的 `Content-Type` 改 `text/plain` 触发边缘 br/gzip（前端按纯文本解析不受影响）。验证：`curl -sI -H 'Accept-Encoding: br' .../data/index_bars.csv` 看 `content-encoding` |
| 数据每次打开都重下、缓存不生效 | 前端勿对 `/data/*` 用 `cache:"no-store"` 或 `?_t=` 时间戳——会废掉 `_headers` 的 `max-age=300`。URL 保持稳定，靠 `must-revalidate` 兜新鲜度（`DataSourceContext`） |
| 境内手机长时间白屏或「打不开」 | 勿依赖 Google Fonts；前端**优先同域 `/data/*.csv`**（与部署/R2 同源同新），仅缺失/失败才回退 Worker `/api/bundle`（workers.dev 境内可能慢，12s 超时）。不要再首屏并行叠加 API 全量下载 |
| 线上“没数据”但本地有 | sync 脚本 commit CSV 后**同时**触发 Pages 部署（刷 `dist/data/`）和 `cloudflare-r2-upload`（刷 R2），二者同源。排查：Pages 是否注入 `VITE_DATA_API_BASE_URL`、Worker 是否在线、R2 是否被刷新过 |
| 配置了 `VITE_DATA_API_BASE_URL` 但 Worker/R2 不可用 | 同域 CSV 为主源不受影响；API 仅兜底。发布前确认 Worker 与 R2 **remote** 上传 |
| `wrangler r2` 上传后生产仍旧数据 | 必须 `--remote`；本地 `.wrangler/` 勿提交（已 gitignore） |
| 布林带/触发与分位数矛盾 | “当前状态”以**当前 K 线信号**为准，不要用历史最后一次非 HOLD |
| ETF 当指数展示 | 仅允许代理场景，且页面**显式注释** |
| 策略层文案 | 标明回测/监控，不构成投资建议 |

## 分层边界

- `Layout.tsx`：全站标题与导航。不要在顶栏放实时数据统计、重载按钮或长状态文案。
- `Home.tsx` / `ConfigDeskOverview.tsx`：只回答“长期底仓怎么配”。不要写短线择时、交易信号或策略推荐。
- `IndicesListPage.tsx` / `IndexDetailPage.tsx`：指数研究层。展示指数表现、股息率、利差、主跟踪 ETF。
- `ProductsPage.tsx` / ETF 详情：产品落地层。关注规模、费率、跟踪指数、历史行情、分红/复权。
- `Monitor.tsx` / `Registry.tsx` / `FeaturedTrackingPage.tsx`：策略与执行层。策略结果必须明确是回测/监控，不构成投资建议。

## 数据口径

- 标普港股通红利低波指数、标普中国 A 股大盘红利低波 50 指数如无指数行情，可用主跟踪 ETF 行情做代理展示，但页面必须显式注释。
- `index_bars.csv` 为指数层主数据；`barsmore.csv`/ETF bars 为产品层数据。不要静默把 ETF 数据写成指数原始数据。
- `bars`/`barsmore` 按 `(code, date)` 合并成同一条完整序列，**不是**「近期/历史」切片。
- **头条数字按全历史计算**（回测超额/胜率/轮次=全 `etf.bars`；股债利差分位=整段历史排名），「默认近 5 年」只是图表显示窗口。**不要按近 N 年切片做首屏**，否则分位/回测会先算错再跳变（误导性金融数字）。首屏要降载得走「构建期预计算快照 JSON + 按需补全 bars」，不能简单截断 CSV。
- 股息率只使用显式观测值；非观测日保持空。
- ETF 前复权历史行情会因分红除权变化，补数脚本应支持全量刷新，不只拼接 T-1。

## UI 收敛规则

- 深色专业金融界面优先：少色块、少框、弱边线、清晰层级。
- 表格首列名称不能截断到不可辨认；长名称用两行或 tooltip。
- 状态标签必须有足够对比度；黄色标签不要放在浅色文字上。
- 首页尽量短，只保留核心判断和入口；解释性长文移到对应研究页。
- 图表阈值色块必须说明用途；如果解释成本高，优先删除色块或改成简短图例。
