/** 浏览器端可见的环境变量（Vite 仅暴露 VITE_*） */
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;

export function hasApiConfigured(): boolean {
  return Boolean(apiBaseUrl && apiBaseUrl.length > 0);
}
