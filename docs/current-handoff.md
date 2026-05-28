# 当前交接（2026-05-28）

## 当前状态

- 线上站点：<https://newhl-dashboard.pages.dev/> 可用
- 部署模式：静态 Pages + `dist/data/*.csv`（R2/Worker 暂不作为必需）
- 最近关注：移动端首屏缓存/空态体验、精选跟踪策略表可读性

## 本地未完成工作（需决定是否发布）

当前工作区仍有未提交改动（截至本文件更新时）：

- `src/components/ConfigDeskOverview.tsx`
- `src/lib/indicatorPercentile.ts`
- `src/pages/FeaturedTrackingPage.tsx`
- `src/index.css`
- `src/pages/Monitor.tsx`
- `src/pages/Registry.tsx`
- `docs/project-status.md`

其中包含：

1. 配置总览“现金流 vs 沪深300”加载中提示
2. 精选跟踪表格列精简 + 策略年化 + 今日盘中价格
3. 布林带分位文案与当前触发状态修正
4. 首页移动端 tooltip 溢出修复
5. 盘中监控说明与策略研究加载态收敛
6. 待办口径同步：P0 / R2 Worker 已完成，流动性/折溢价/跟踪误差暂不列入近期

## 建议发布节奏

1. 本地回归（首页、精选跟踪、盘中监控、产品详情）
2. `npm run build`
3. 手工部署到 Pages（`--branch=main`）
4. 手机端验证（iOS Safari + 微信内置浏览器）
5. 再 push 到远端并打上“移动端缓存修复”说明

## 高优先级待办（未来 1-3 天）

- [ ] 做一次移动端专项验收（冷启动、返回、跨页）
- [ ] 统一“分位数/触发状态”在精选跟踪与盘中监控的口径

## 风险提示

- 若 Cloudflare 启用 Git 自动构建，可能覆盖手工上传产物；需明确以哪条发布链路为准。
- 若后续重新引入 `VITE_DATA_API_BASE_URL`，需要同步验证 Worker 可用性，否则首屏会经历 API 失败再回退 CSV。
