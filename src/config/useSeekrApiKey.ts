import { useCallback, useEffect, useState } from "react";
import { clearSeekrApiKey, readSeekrApiKey, saveSeekrApiKey } from "./seekr";

export interface SeekrApiKeyState {
  apiKey: string;
  ready: boolean;
  save: (value: string) => Promise<string>;
  clear: () => Promise<void>;
}

// La clave vive en el Credential Manager de Windows: el reproductor la lee una
// vez al montar y la mantiene en memoria mientras dura la sesion.
export function useSeekrApiKey(): SeekrApiKeyState {
  const [apiKey, setApiKey] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readSeekrApiKey()
      .then(value => {
        if (cancelled) return;
        setApiKey(value);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (value: string) => {
    const stored = await saveSeekrApiKey(value);
    setApiKey(stored);
    return stored;
  }, []);

  const clear = useCallback(async () => {
    await clearSeekrApiKey();
    setApiKey("");
  }, []);

  return { apiKey, ready, save, clear };
}
