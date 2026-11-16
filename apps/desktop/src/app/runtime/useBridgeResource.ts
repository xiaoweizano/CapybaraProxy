import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RuntimeBridgeResult,
  RuntimeError,
} from "../../platform/runtime";

export type BridgeResourceState<T> = {
  data: T | null;
  isLoading: boolean;
  error: RuntimeError | null;
  unavailable: boolean;
  reload: () => Promise<void>;
  setData: (updater: (current: T | null) => T | null) => void;
};

const bridgeFailure: RuntimeError = {
  code: "internal",
  message: "FlowProxy could not load live Mihomo data.",
  retryable: true,
};

export function useBridgeResource<T>(
  load: () => Promise<RuntimeBridgeResult<T>>,
  enabled: boolean,
): BridgeResourceState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<RuntimeError | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const requestGeneration = useRef(0);
  const mounted = useRef(true);

  const applyResult = useCallback((result: RuntimeBridgeResult<T>) => {
    if (result.status === "ok") {
      setDataState(result.data);
      setError(null);
      setUnavailable(false);
    } else if (result.status === "unavailable") {
      setUnavailable(true);
      setError(null);
    } else {
      setError(result.error);
      setUnavailable(false);
    }
  }, []);

  const reload = useCallback(async () => {
    if (!enabled) {
      return;
    }

    const generation = ++requestGeneration.current;
    await Promise.resolve();

    if (!mounted.current || generation !== requestGeneration.current) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await load();

      if (mounted.current && generation === requestGeneration.current) {
        applyResult(result);
      }
    } catch {
      if (mounted.current && generation === requestGeneration.current) {
        setError(bridgeFailure);
      }
    } finally {
      if (mounted.current && generation === requestGeneration.current) {
        setIsLoading(false);
      }
    }
  }, [applyResult, enabled, load]);

  useEffect(() => {
    mounted.current = true;

    if (!enabled) {
      requestGeneration.current += 1;
      return () => {
        mounted.current = false;
      };
    }

    const generation = ++requestGeneration.current;

    void (async () => {
      try {
        const result = await load();

        if (mounted.current && generation === requestGeneration.current) {
          applyResult(result);
        }
      } catch {
        if (mounted.current && generation === requestGeneration.current) {
          setError(bridgeFailure);
        }
      } finally {
        if (mounted.current && generation === requestGeneration.current) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
    };
  }, [applyResult, enabled, load]);

  const setData = useCallback(
    (updater: (current: T | null) => T | null) => {
      setDataState(updater);
    },
    [],
  );

  if (!enabled) {
    return {
      data: null,
      isLoading: false,
      error: null,
      unavailable: false,
      reload,
      setData,
    };
  }

  return { data, isLoading, error, unavailable, reload, setData };
}
