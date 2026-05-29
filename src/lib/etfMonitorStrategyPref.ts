/** 各 ETF 在详情/回测中隐藏的策略 variant key（不含观测注册删除，仅 UI 过滤） */
const LS_KEY = "desk.etfMonitorStrategyPref.v1";

type Store = {
  hiddenByEtf: Record<string, string[]>;
};

function normalizeKeyList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  );
}

function normalizeStore(raw: unknown): Store {
  if (!raw || typeof raw !== "object") return { hiddenByEtf: {} };
  const hiddenByEtf = (raw as Store).hiddenByEtf;
  if (
    !hiddenByEtf ||
    typeof hiddenByEtf !== "object" ||
    Array.isArray(hiddenByEtf)
  ) {
    return { hiddenByEtf: {} };
  }
  const out: Record<string, string[]> = {};
  for (const [code, keys] of Object.entries(hiddenByEtf)) {
    if (typeof code !== "string" || !code) continue;
    const list = normalizeKeyList(keys);
    if (list.length) out[code] = list;
  }
  return { hiddenByEtf: out };
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { hiddenByEtf: {} };
    return normalizeStore(JSON.parse(raw));
  } catch {
    return { hiddenByEtf: {} };
  }
}

function writeStore(store: Store) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

export function getHiddenMonitorKeys(etfCode: string): Set<string> {
  try {
    const list = readStore().hiddenByEtf[etfCode] ?? [];
    return new Set(normalizeKeyList(list));
  } catch {
    return new Set();
  }
}

export function hideMonitorStrategy(etfCode: string, variantKey: string) {
  if (!etfCode || !variantKey) return;
  const store = readStore();
  const prev = store.hiddenByEtf[etfCode] ?? [];
  if (prev.includes(variantKey)) return;
  store.hiddenByEtf[etfCode] = [...prev, variantKey];
  writeStore(store);
}

export function setHiddenMonitorKeys(etfCode: string, keys: string[]) {
  if (!etfCode) return;
  const store = readStore();
  store.hiddenByEtf[etfCode] = [...new Set(keys.filter(Boolean))];
  writeStore(store);
}

/** 清除本 ETF 的隐藏列表（等同恢复显示全部已登记项，含观测注册） */
export function clearHiddenMonitorKeys(etfCode: string) {
  if (!etfCode) return;
  const store = readStore();
  delete store.hiddenByEtf[etfCode];
  writeStore(store);
}

/** 仅展示 etf_params（及 etfs 默认行）内置策略，隐藏观测注册与其余项 */
export function restoreBuiltinMonitorVisibility(
  etfCode: string,
  allVariants: { key: string }[],
  builtinVariants: { key: string }[],
) {
  const builtinKeys = new Set(builtinVariants.map((v) => v.key));
  const hidden = allVariants
    .filter((v) => !builtinKeys.has(v.key))
    .map((v) => v.key);
  setHiddenMonitorKeys(etfCode, hidden);
}

export function resetMonitorStrategyPrefStorage() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

/** 启动时修复损坏的 hidden 列表，避免 Safari 等环境读取后抛错 */
export function sanitizeMonitorStrategyPrefStorage() {
  try {
    const store = readStore();
    writeStore(store);
  } catch {
    resetMonitorStrategyPrefStorage();
  }
}
