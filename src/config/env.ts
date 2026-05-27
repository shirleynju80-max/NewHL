/** 浏览器端可见的环境变量（Vite 仅暴露 VITE_*） */
export const dataApiBaseUrl = (
  import.meta.env.VITE_DATA_API_BASE_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  ""
).trim();

export function hasApiConfigured(): boolean {
  return dataApiBaseUrl.length > 0;
}
