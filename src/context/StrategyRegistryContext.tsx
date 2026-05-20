import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { UserRegisteredStrategy } from "../types";

const LS_KEY = "desk.userRegisteredStrategies.v1";

function loadFromStorage(): UserRegisteredStrategy[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as UserRegisteredStrategy[];
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function saveToStorage(entries: UserRegisteredStrategy[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
}

type Ctx = {
  entries: UserRegisteredStrategy[];
  addEntry: (e: Omit<UserRegisteredStrategy, "id" | "createdAt"> & { id?: string }) => void;
  removeEntry: (id: string) => void;
};

const StrategyRegistryContext = createContext<Ctx | null>(null);

export function StrategyRegistryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<UserRegisteredStrategy[]>([]);

  useEffect(() => {
    setEntries(loadFromStorage());
  }, []);

  const addEntry = useCallback((e: Omit<UserRegisteredStrategy, "id" | "createdAt"> & { id?: string }) => {
    const id = e.id ?? `reg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setEntries((prev) => {
      const row: UserRegisteredStrategy = {
        ...e,
        id,
        createdAt: new Date().toISOString(),
      };
      const next = [row, ...prev];
      saveToStorage(next);
      return next;
    });
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => {
      const next = prev.filter((x) => x.id !== id);
      saveToStorage(next);
      return next;
    });
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      entries,
      addEntry,
      removeEntry,
    }),
    [entries, addEntry, removeEntry]
  );

  return <StrategyRegistryContext.Provider value={value}>{children}</StrategyRegistryContext.Provider>;
}

export function useStrategyRegistry(): Ctx {
  const v = useContext(StrategyRegistryContext);
  if (!v) throw new Error("useStrategyRegistry must be used within StrategyRegistryProvider");
  return v;
}
