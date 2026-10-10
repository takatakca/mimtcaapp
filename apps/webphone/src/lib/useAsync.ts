import { useCallback, useEffect, useRef, useState } from "react";
import { toErrorKey } from "../api/errors";
import type { TKey } from "../i18n/core";

export interface AsyncState<T> {
  data: T | undefined;
  error: TKey | null;
  loading: boolean;
  reload: () => void;
  setData: (updater: (prev: T | undefined) => T | undefined) => void;
}

/** Runs `fn` on mount and whenever `deps` change; errors become translated message keys. */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<TKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fnRef
      .current()
      .then((d) => alive && setDataState(d))
      .catch((e: unknown) => alive && setError(toErrorKey(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((u: (prev: T | undefined) => T | undefined) => setDataState(u), []);
  return { data, error, loading, reload, setData };
}
