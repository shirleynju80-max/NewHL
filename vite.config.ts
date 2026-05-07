import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 若部署在子路径（如 https://example.com/desk/），构建前设置：VITE_BASE_PATH=/desk/
const base = (process.env.VITE_BASE_PATH as string | undefined) || "/";

export default defineConfig({
  base,
  plugins: [react()],
  preview: {
    host: true,
    port: 4173,
  },
});
