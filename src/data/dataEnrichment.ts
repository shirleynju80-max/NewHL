/**
 * 预留：联网或付费数据源补全（Wind / Choice / 聚源 / 交易所公开接口等）。
 * 浏览器内默认不发起外网请求；可在后续接入服务端代理或配置 API Key 后在此实现。
 */
export type EnrichHint = {
  code: string;
  field: "name" | "div_yield" | "meta";
};

export async function tryEnrichEtfMeta(_hint: EnrichHint): Promise<null> {
  void _hint;
  return null;
}
