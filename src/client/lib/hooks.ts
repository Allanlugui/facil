import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorMessage } from "./api";

/**
 * Carregamento de dados com estados explicitos.
 *
 * `useAsync` roda a cada mudança das dependencias e expoe `reload` para refazer
 * a busca depois de uma ação (ex.: após registrar um movimento, a lista volta a
 * ser lida do servidor em vez de ser ajustada em memoria).
 */
export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useAsync<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let active = true;
    setLoading(true);
    loaderRef
      .current()
      .then((result) => {
        if (!active) return;
        setData(result);
        setError(null);
      })
      .catch((cause) => {
        if (!active) return;
        setError(apiErrorMessage(cause));
        setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, error, loading, reload };
}

/** Executa uma ação (POST/PATCH/DELETE) controlando `loading` e erro. */
export interface MutationState<TArgs, TResult> {
  run: (args: TArgs) => Promise<TResult | null>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

export function useMutation<TArgs, TResult>(
  action: (args: TArgs) => Promise<TResult>,
  options: { onSuccess?: (result: TResult) => void } = {},
): MutationState<TArgs, TResult> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const successRef = useRef(options.onSuccess);
  successRef.current = options.onSuccess;

  const run = useCallback(async (args: TArgs): Promise<TResult | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await action(args);
      successRef.current?.(result);
      return result;
    } catch (cause) {
      setError(apiErrorMessage(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { run, loading, error, clearError: () => setError(null) };
}

export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Fecha com a tecla Esc (dialogos e menus). */
export function useEscape(handler: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") handler();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [handler, active]);
}
