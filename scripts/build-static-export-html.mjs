#!/usr/bin/env node
/** 从 images/*.png 生成四页静态 HTML 包（需先放好截图） */
import { writeFile, mkdir, copyFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "static-page-exports");
const shotDir = "/var/folders/nh/mtxdgfvx5fl2kw60g5jcv6hr0000gn/T/cursor/screenshots";

const PAGES = [
  { id: "overview", title: "配置总览", file: "01-config-overview.html", png: "overview.png" },
  { id: "indices", title: "指数研究", file: "02-indices.html", png: "indices.png" },
  { id: "products", title: "产品选择", file: "03-products.html", png: "products.png" },
  { id: "monitor", title: "盘中监控", file: "04-monitor.html", png: "monitor.png" },
];

function pageShell({ title, imgRel, nav, generatedAt }) {
  const navItems = nav
    .map((p) => `<a href="${p.file}" class="${p.active ? "active" : ""}">${p.title}</a>`)
    .join("\n      ");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} · 价值底仓配置台（静态截面）</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "IBM Plex Sans", "Noto Sans SC", -apple-system, sans-serif; background: #0a0c10; color: #eff1f5; min-height: 100vh; }
    .bar { position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; background: rgba(10,12,16,0.95); border-bottom: 1px solid #252b36; backdrop-filter: blur(8px); }
    .bar h1 { font-size: 15px; font-weight: 600; }
    .bar p { font-size: 12px; color: #8f95a3; margin-top: 2px; }
    nav { display: flex; flex-wrap: wrap; gap: 8px; }
    nav a { padding: 6px 12px; border-radius: 6px; font-size: 13px; color: #9ba1af; text-decoration: none; border: 1px solid #242a34; }
    nav a:hover { color: #eff1f5; border-color: #4f7df3; }
    nav a.active { color: #fff; background: rgba(79,125,243,0.15); border-color: #4f7df3; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .dl, .home { padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 500; text-decoration: none; }
    .dl { background: #4f7df3; color: #fff; }
    .dl:hover { background: #3d6ae8; }
    .home { border: 1px solid #242a34; color: #9ba1af; }
    .home:hover { border-color: #4f7df3; color: #eff1f5; }
    main { padding: 16px; display: flex; justify-content: center; }
    figure { max-width: 1440px; width: 100%; margin: 0; }
    img { width: 100%; height: auto; display: block; border-radius: 8px; border: 1px solid #242a34; box-shadow: 0 16px 48px rgba(0,0,0,0.45); }
    figcaption { margin-top: 10px; font-size: 11px; color: #6a7080; text-align: center; }
    @media print { .bar { position: static; } .dl, .home { display: none; } main { padding: 0; } img { border: none; box-shadow: none; } }
  </style>
</head>
<body>
  <header class="bar">
    <div>
      <h1>${title}</h1>
      <p>静态截面 · ${generatedAt}</p>
    </div>
    <nav aria-label="页面切换">${navItems}</nav>
    <div class="actions">
      <a class="home" href="index.html">索引</a>
      <a class="dl" href="${imgRel}" download="${imgRel.split("/").pop()}">下载 PNG</a>
    </div>
  </header>
  <main>
    <figure>
      <img src="${imgRel}" alt="${title}" width="1440" loading="lazy" />
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
      <img src="${p.imgRel}" alt="" loading="lazy" />
      <div class="card-body"><h2>${p.title}</h2><p>${p.file}</p></div>
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
    body { font-family: "IBM Plex Sans", "Noto Sans SC", sans-serif; background: #0a0c10; color: #eff1f5; padding: 32px 24px 48px; max-width: 1100px; margin: 0 auto; }
    h1 { font-size: 1.75rem; font-weight: 600; background: linear-gradient(135deg, #fff, #9ba8c9); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .lead { margin-top: 8px; color: #8f95a3; font-size: 14px; line-height: 1.6; }
    .meta { margin-top: 12px; font-size: 12px; color: #6a7080; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; margin-top: 28px; }
    .card { display: block; text-decoration: none; color: inherit; border: 1px solid #242a34; border-radius: 16px; overflow: hidden; background: #0f131a; transition: border-color 0.2s, transform 0.2s; }
    .card:hover { border-color: #4f7df3; transform: translateY(-2px); }
    .card img { width: 100%; aspect-ratio: 16/10; object-fit: cover; object-position: top; }
    .card-body { padding: 14px 16px; }
    .card h2 { font-size: 16px; font-weight: 600; }
    .card p { margin-top: 4px; font-size: 11px; color: #8f95a3; font-family: monospace; }
    ul { margin-top: 16px; padding-left: 20px; color: #8f95a3; font-size: 13px; line-height: 1.8; }
  </style>
</head>
<body>
  <h1>价值底仓配置台 · 四页静态截面</h1>
  <p class="lead">配置总览、指数研究、产品选择、盘中监控 — 可离线打开或转发评审。</p>
  <p class="meta">生成时间：${generatedAt}</p>
  <ul>
    <li>点击卡片打开单页 HTML（含全页截图）</li>
    <li>单页内可「下载 PNG」保存高清图</li>
    <li>将整个 <code>static-page-exports</code> 文件夹打包发送即可</li>
  </ul>
  <div class="grid">${cards}</div>
</body>
</html>`;
}

async function main() {
  await mkdir(join(outDir, "images"), { recursive: true });
  const generatedAt = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const exported = [];

  for (const p of PAGES) {
    const src = join(shotDir, p.png);
    const dest = join(outDir, "images", `${p.id}.png`);
    await copyFile(src, dest);
    exported.push({ ...p, imgRel: `images/${p.id}.png` });
    console.log(`Copied ${p.png}`);
  }

  for (const p of exported) {
    await writeFile(
      join(outDir, p.file),
      pageShell({
        title: p.title,
        imgRel: p.imgRel,
        generatedAt,
        nav: exported.map((x) => ({ file: x.file, title: x.title, active: x.id === p.id })),
      }),
      "utf8"
    );
  }

  await writeFile(join(outDir, "index.html"), indexHtml(exported, generatedAt), "utf8");
  await writeFile(
    join(outDir, "README.md"),
    `# 四页静态截面\n\n生成：${generatedAt}\n\n打开 index.html，或将本文件夹 zip 后发送。\n`,
    "utf8"
  );

  try {
    execSync("zip -r -q static-page-exports.zip static-page-exports", { cwd: root });
    console.log(`\n✓ ${outDir}`);
    console.log(`✓ ${join(root, "static-page-exports.zip")}`);
  } catch {
    console.log(`\n✓ ${outDir} (zip 需系统 zip 命令)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
