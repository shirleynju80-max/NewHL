import { useCallback, useEffect, useState } from "react";
import type { BondAnchorId } from "../types";
import {
  getHkBondAnchorPreference,
  HK_BOND_ANCHOR_EVENT,
  setHkBondAnchorPreference,
} from "../lib/bondAnchor";

export function useHkBondAnchorPreference(): readonly [
  BondAnchorId,
  (anchor: BondAnchorId) => void,
] {
  const [anchor, setAnchorState] = useState<BondAnchorId>(() =>
    getHkBondAnchorPreference(),
  );

  useEffect(() => {
    const sync = () => setAnchorState(getHkBondAnchorPreference());
    window.addEventListener(HK_BOND_ANCHOR_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(HK_BOND_ANCHOR_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setAnchor = useCallback((next: BondAnchorId) => {
    setHkBondAnchorPreference(next);
    setAnchorState(next);
  }, []);

  return [anchor, setAnchor] as const;
}
