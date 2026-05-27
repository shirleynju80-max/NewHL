/** 由 scripts/analyze_dividend_pool.mts 生成，见 public/data/dividend_representative_pool.json */

export type DividendRepresentativePool = {
  generatedAt: string;
  representativeCodes: string[];
  representativeIndexCodes?: string[];
  indexRepresentatives?: {
    index: string;
    name: string;
    primaryEtf?: string;
    annReturnPct: number;
    maxDrawdownPct: number;
    volatilityPct: number;
  }[];
  byIndex: Record<string, string[]>;
  primaryRepresentativeCodes: string[];
  strongDualExcess: {
    etf: string;
    strategy: string;
    version: string;
    excessReturn?: number;
    excessTrain: number;
    excessVal: number;
    roundCount?: number;
    winRate?: number;
    avgHoldDays?: number;
  }[];
  swingCandidates: {
    etf: string;
    strategy: string;
    rounds: number;
    roundsPerYear?: number;
    winRate?: number;
    excessReturn?: number;
    avgHoldDays?: number;
  }[];
  fund007751?: string;
};

export function parseDividendRepresentativePool(
  text: string,
): DividendRepresentativePool | null {
  try {
    const raw = JSON.parse(text) as DividendRepresentativePool;
    if (!raw?.byIndex || !Array.isArray(raw.representativeCodes)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function representativeCodesForIndex(
  pool: DividendRepresentativePool | null | undefined,
  indexCode: string,
): string[] | undefined {
  if (!pool) return undefined;
  const codes = pool.byIndex[indexCode];
  return codes?.length ? codes : undefined;
}

export function isQuantRepresentative(
  pool: DividendRepresentativePool | null | undefined,
  code: string,
): boolean {
  return pool?.representativeCodes.includes(code) ?? false;
}

export function isPrimaryRepresentative(
  pool: DividendRepresentativePool | null | undefined,
  code: string,
): boolean {
  return pool?.primaryRepresentativeCodes.includes(code) ?? false;
}

export function strongDualExcessKey(
  etf: string,
  strategyId: string,
  paramVersion: string,
): string {
  return `${etf}|${strategyId}|${paramVersion}`;
}

export function buildStrongDualExcessSet(
  pool: DividendRepresentativePool | null | undefined,
): Set<string> {
  const s = new Set<string>();
  if (!pool) return s;
  for (const row of pool.strongDualExcess) {
    s.add(strongDualExcessKey(row.etf, row.strategy, row.version));
  }
  return s;
}

export function buildSwingCandidateSet(
  pool: DividendRepresentativePool | null | undefined,
): Set<string> {
  const s = new Set<string>();
  if (!pool) return s;
  for (const row of pool.swingCandidates) {
    s.add(`${row.etf}|${row.strategy}`);
  }
  return s;
}
