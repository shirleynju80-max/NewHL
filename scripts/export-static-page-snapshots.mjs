#!/usr/bin/env node
/**
 * 抓取四个主页面全页截图，生成可离线打开的静态 HTML 包。
 * 用法: node scripts/export-static-page-snapshots.mjs [baseUrl]
 */
import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "static-page-exports");

const BASE = process.argv[2] ?? "http://localhost:5173";

const PAGES = [
  { id: "overview", path: "/", title: "配置总览", file: "01-config-overview.html" },
  { id: "indices", path: "/indices", title: "指数研究", file: "02-indices.html" },
  { id: "products", path: "/products", title: "产品选择", file: "03-products.html" },
  { id: "monitor", path: "/monitor", title: "盘中监控", file: "04-monitor.html" },
];

async function ensurePlaywright() {
  try {
    await import("playwright");
    return true;
  } catch {
    console.log("Installing playwright (one-time)…");
    execSync("npm install -D playwright@1.49.1", { cwd: root, stdio: "inherit" });
    execSync("npx playwright install chromium", { cwd: root, stdio: "inherit" });
    return true;
  }
}

function pageShell({ title, imgRel, nav }) {
  const navItems = nav
    .map(
      (p) =>
        `<a href="${p.file}" class="${p.active ? "active" : ""}">${p.title}</a>`
    )
    .join("\n      ");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} · 价值底仓配置台（静态截面）</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "IBM Plex Sans", "Noto Sans SC", -apple-system, sans-serif;
      background: #0a0c10;
      color: #eff1f5;
      min-height: 100vh;
    }
    .bar {
      position: sticky; top: 0; z-index: 10;
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;
      padding: 12px 20px;
      background: rgba(10, 12, 16, 0.95);
      border-bottom: 1px solid #252b36;
      backdrop-filter: blur(8px);
    }
    .bar h1 { font-size: 15px; font-weight: 600; }
    .bar p { font-size: 12px; color: #8f95a3; margin-top: 2px; }
    nav { display: flex; flex-wrap: wrap; gap: 8px; }
    nav a {
      padding: 6px 12px; border-radius: 6px; font-size: 13px;
      color: #9ba1af; text-decoration: none; border: 1px solid #242a34;
    }
    nav a:hover { color: #eff1f5; border-color: #4f7df3; }
    nav a.active { color: #fff; background: rgba(79,125,243,0.15); border-color: #4f7df3; }
    .dl {
      padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 500;
      background: #4f7df3; color: #fff; text-decoration: none;
    }
    .dl:hover { background: #3d6ae8; }
    main { padding: 16px; display: flex; justify-content: center; }
    figure { max-width: 1440px; width: 100%; margin: 0; }
    img {
      width: 100%; height: auto; display: block;
      border-radius: 8px; border: 1px solid #242a34;
      box-shadow: 0 16px 48px rgba(0,0,0,0.45);
    }
    figcaption {
      margin-top: 10px; font-size: 11px; color: #6a7080; text-align: center;
    }
    @media print {
      .bar { position: static; }
      .dl { display: none; }
      main { padding: 0; }
      img { border: none; box-shadow: none; border-radius: 0; }
    }
  </style>
</head>
<body>
  <header class="bar">
    <div>
      <h1>${title}</h1>
      <p>静态截面 · 生成于 ${new Date().toISOString().slice(0, 10)} · 数据以导出时页面为准</p>
    </div>
    <nav aria-label="页面切换">
      ${navItems}
    </nav>
    <a class="dl" href="${imgRel}" download="${imgRel}">下载 PNG</a>
  </header>
  <main>
    <figure>
      <img src="${imgRel}" alt="${title} 页面截图" width="1440" />
      <figcaption>价值底仓配置台 — ${title}（1440px 视口全页截图）</figcaption>
    </figure>
  </main>
</body>
</html>`;
}

function indexHtml(pages, generatedAt) {
  const cards = pages
    .map(
      (p) => `
    <a class="card" href="${p.file}">
      <img src="${p.png}" alt="" loading="lazy" />
      <div class="card-body">
        <h2>${p.title}</h2>
        <p>${p.path}</p>
      </div>
    </a>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>价值底仓配置台 · 四页静态截面</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "IBM Plex Sans", "Noto Sans SC", sans-serif;
      background: #0a0c10; color: #eff1f5; padding: 32px 24px 48px;
      max-width: 1200px; margin: 0 auto;
    }
    h1 {
      font-size: 1.75rem; font-weight: 600;
      background: linear-gradient(135deg, #fff, #9ba8c9);
      -webkit-background-clip: text; background-clip: text; color: transparent;
    }
    .lead { margin-top: 8px; color: #8f95a3; font-size: 14px; line-height: 1.6; }
    .meta { margin-top: 12px; font-size: 12px; color: #6a7080; }
    .grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px; margin-top: 28px;
    }
    .card {
      display: block; text-decoration: none; color: inherit;
      border: 1px solid #242a34; border-radius: 16px; overflow: hidden;
      background: #0f131a; transition: border-color 0.2s, transform 0.2s;
    }
    .card:hover { border-color: #4f7df3; transform: translateY(-2px); }
    .card img { width: 100%; aspect-ratio: 16/10; object-fit: cover; object-position: top; }
    .card-body { padding: 14px 16px; }
    .card h2 { font-size: 16px; font-weight: 600; }
    .card p { margin-top: 4px; font-size: 12px; color: #8f95a3; font-family: monospace; }
    .zip {
      display: inline-block; margin-top: 24px; padding: 10px 18px;
      background: #4f7df3; color: #fff; border-radius: 8px; font-size: 14px;
      font-weight: 500; text-decoration: none;
    }
    .zip:hover { background: #3d6ae8; }
    ul { margin-top: 16px; padding-left: 20px; color: #8f95a3; font-size: 13px; line-height: 1.8; }
  </style>
</head>
<body>
  <h1>价值底仓配置台 · 四页静态截面</h1>
  <p class="lead">配置总览、指数研究、产品选择、盘中监控四个主流程页面的全页截图，可离线浏览或转发评审。</p>
  <p class="meta">生成时间：${generatedAt} · 来源 ${BASE}</p>
  <ul>
    <li>点击下方卡片打开单页 HTML（含高清 PNG 与下载按钮）</li>
    <li>或将整个 <code>static-page-exports</code> 文件夹打包发送</li>
  </ul>
  <div class="grid">${cards}</div>
  <p class="meta" style="margin-top:28px">单页文件：${pages.map((p) => p.file).join(" · ")}</p>
</body>
</html>`;
}

async function main() {
  await ensurePlaywright();
  const { chromium } = await import("playwright");

  await mkdir(join(outDir, "images"), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  const exported = [];

  for (const page of PAGES) {
    const url = `${BASE.replace(/\/$/, "")}${page.path}`;
    const pngName = `${page.id}.png`;
    const pngPath = join(outDir, "images", pngName);
    console.log(`Capturing ${url} …`);

    const tab = await context.newPage();
    await tab.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
    await tab.waitForTimeout(1500);
    await tab.screenshot({ path: pngPath, fullPage: true });
    await tab.close();

    exported.push({ ...page, png: `images/${pngName}` });
  }

  await browser.close();

  const generatedAt = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

  for (const p of exported) {
    const html = pageShell({
      title: p.title,
      imgRel: p.png,
      nav: exported.map((x) => ({
        file: x.file,
        title: x.title,
        active: x.id === p.id,
      })),
    });
    await writeFile(join(outDir, p.file), html, "utf8");
  }

  await writeFile(join(outDir, "index.html"), indexHtml(exported, generatedAt), "utf8");

  const readme = `# 价值底仓配置台 · 四页静态截面

生成时间：${generatedAt}
来源：${BASE}

## 文件

- index.html — 入口索引
- 01-config-overview.html — 配置总览
- 02-indices.html — 指数研究
- 03-products.html — 产品选择
- 04-monitor.html — 盘中监控
- images/*.png — 全页截图（2x）

## 使用

1. 用浏览器打开 index.html
2. 单页 HTML 内可「下载 PNG」
3. 将整个文件夹 zip 后转发

重新生成：\`node scripts/export-static-page-snapshots.mjs http://localhost:5173\`
`;
  await writeFile(join(outDir, "README.md"), readme, "utf8");

  try {
    execSync(`zip -r static-page-exports.zip static-page-exports`, { cwd: root, stdio: "inherit" });
    console.log(`\nDone → ${outDir}`);
    console.log(`Zip  → ${join(root, "static-page-exports.zip")}`);
  } catch {
    console.log(`\nDone → ${outDir} (zip skipped — install zip CLI to bundle)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
