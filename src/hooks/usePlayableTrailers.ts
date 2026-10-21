import { useEffect, useRef, useState } from "react";

import { probeTrailerKey } from "../services/trailerProbe";

const NO_TRAILERS: never[] = [];

interface TrailerStreamLike {
  id?: string;
  url?: string;
  externalUrl?: string;
  infoHash?: string;
  fileIdx?: number;
}

interface TrailerLike {
  key?: string;
  name?: string;
  thumbnail?: string;
  stream?: TrailerStreamLike;
}

function trailerKey(trailer: TrailerLike): string {
  return typeof trailer.key === "string" ? trailer.key.trim() : "";
}

function trailerIdentity(trailer: TrailerLike): string {
  const key = trailerKey(trailer);
  if (key) return `key:${key}`;
  const stream = trailer.stream;
  return [
    trailer.name ?? "",
    trailer.thumbnail ?? "",
    stream?.id ?? "",
    stream?.url ?? "",
    stream?.externalUrl ?? "",
    stream?.infoHash ?? "",
    stream?.fileIdx ?? "",
  ].join("\u0001");
}

/**
 * Devuelve solo los trailers con un video de YouTube que existe de verdad.
 *
 * Mientras se comprueban las claves `ready` es false, para que el detalle no
 * pinte una fila que puede acabar desapareciendo. Los trailers sin `key` se
 * muestran tal cual: son streams de addon y no hay thumbnail que validar.
 */
export function usePlayableTrailers<T extends TrailerLike>(trailers: readonly T[] | null | undefined) {
  const list = trailers ?? NO_TRAILERS;
  const signature = list.map(trailerIdentity).join("\u0000");
  const listRef = useRef<readonly T[]>(list);
  listRef.current = list;

  const [result, setResult] = useState<{ signature: string; trailers: T[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const current = listRef.current;
    if (!current.length) {
      setResult({ signature, trailers: [] });
      return;
    }

    const keys = Array.from(new Set(
      current
        .map(trailerKey)
        .filter((key): key is string => Boolean(key)),
    ));
    if (!keys.length) {
      setResult({ signature, trailers: [...current] });
      return;
    }

    void Promise.all(keys.map(async key => [key, await probeTrailerKey(key)] as const)).then(entries => {
      if (cancelled) return;
      const valid = new Set(entries.filter(([, ok]) => ok).map(([key]) => key));
      setResult({
        signature,
        trailers: current.filter(trailer => {
          const key = trailerKey(trailer);
          return !key || valid.has(key);
        }),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [signature]);

  const ready = result?.signature === signature;
  return {
    trailers: ready ? result.trailers : (NO_TRAILERS as unknown as T[]),
    ready,
  };
}
