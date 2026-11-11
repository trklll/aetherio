import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, Check, Download, FolderOpen, LoaderCircle, Play, RefreshCw, X } from "lucide-react";
import { useDownloads } from "../../hooks/useDownloads";
import { isTauriRuntime } from "../../runtime/platform";
import { openDownloadFolder } from "../../services/downloads";
import type { DownloadRecord } from "../../services/downloads";
import { prepareLocalMediaPlayback } from "../../utils/localMedia";

const ACTIVE_STATES = new Set<DownloadRecord["status"]>(["queued", "downloading"]);

export default function OfflineDownloadsTab({ bigPicture = false }: { bigPicture?: boolean }) {
  const navigate = useNavigate();
  const { items, loading, error, cancel, remove, retry } = useDownloads();
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [speeds, setSpeeds] = useState<Record<string, number>>({});
  const samples = useRef(new Map<string, { bytes: number; at: number }>());

  useEffect(() => {
    const now = Date.now();
    const nextSpeeds: Record<string, number> = {};
    for (const item of items) {
      if (!ACTIVE_STATES.has(item.status)) continue;
      const previous = samples.current.get(item.id);
      if (previous && now > previous.at && item.bytesDownloaded >= previous.bytes) {
        nextSpeeds[item.id] = (item.bytesDownloaded - previous.bytes) / ((now - previous.at) / 1000);
      }
      samples.current.set(item.id, { bytes: item.bytesDownloaded, at: now });
    }
    setSpeeds(nextSpeeds);
  }, [items]);

  async function runAction(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setActionError("");
    try {
      await action();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "No se pudo completar la acción.");
    } finally {
      setBusyId("");
    }
  }

  function play(item: DownloadRecord) {
    if (!item.filePath) return;
    const name = item.episodeTitle ? `${item.title} · ${item.episodeTitle}` : item.title;
    navigate(prepareLocalMediaPlayback(item.filePath, item.subtitlePaths ?? [], {
      name,
      poster: item.poster ?? undefined,
      background: item.background ?? undefined,
    }));
  }

  return (
    <section className="flex flex-col gap-5" aria-label="Gestor de descargas" data-bp-offline-downloads={bigPicture || undefined}>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-base font-medium leading-relaxed text-white/55">Aquí puedes consultar el progreso y gestionar tus archivos disponibles sin conexión.</p>
        </div>
      </header>

      {error || actionError ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-300/15 bg-rose-400/[0.07] px-4 py-3 text-sm font-semibold text-rose-100/85">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <span>{actionError || error}</span>
        </div>
      ) : null}

      {!isTauriRuntime() ? (
        <OfflineEmpty title="Abre Aetherio para ver archivos locales" description="Las descargas offline se guardan de forma privada en la app de escritorio." />
      ) : loading && items.length === 0 ? (
        <div role="status" className="flex min-h-44 items-center justify-center gap-3 text-sm font-semibold text-white/60">
          <LoaderCircle size={19} className="animate-spin" /> Cargando descargas…
        </div>
      ) : items.length ? (
        <div className="grid gap-3">
          {items.map(item => {
            const active = ACTIVE_STATES.has(item.status);
            const percent = item.totalBytes && item.totalBytes > 0
              ? Math.min(100, Math.round(item.bytesDownloaded / item.totalBytes * 100))
              : item.totalSegments && item.totalSegments > 0
                ? Math.min(100, Math.round(((item.segmentsDownloaded ?? 0) / item.totalSegments) * 100))
                : null;
            const busy = busyId === item.id;
            const episodeStill = Boolean(item.episodeTitle && item.episodeStill);
            const artwork = episodeStill ? item.episodeStill : item.poster;
            const amount = item.totalBytes && item.totalBytes > 0
              ? `${formatBytes(item.bytesDownloaded)} / ${formatBytes(item.totalBytes)}`
              : item.totalSegments && item.totalSegments > 0
                ? `${item.segmentsDownloaded ?? 0} / ${item.totalSegments} partes`
                : formatBytes(item.bytesDownloaded);
            const speed = speeds[item.id] ?? 0;
            return (
              <article key={item.id} aria-busy={busy || undefined} className="flex flex-col gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] sm:flex-row sm:items-center sm:gap-5 sm:p-5">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div className={`relative flex ${episodeStill ? "aspect-video w-48" : "aspect-[2/3] w-20"} shrink-0 items-center justify-center overflow-hidden rounded-xl bg-black/35`}>
                    {artwork ? <img src={artwork} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <Download size={18} className="text-white/30" />}
                    {active ? <span className="absolute inset-x-0 bottom-0 h-1.5 bg-white/20"><span className="block h-full bg-white/90 transition-[width]" style={{ width: `${percent ?? 3}%` }} /></span> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-extrabold text-white">{item.title}</h3>
                    {item.episodeTitle ? <p className="mt-1 truncate text-sm font-semibold text-white/55">{item.episodeTitle}</p> : null}
                    <p className={`mt-2 text-xs font-bold ${item.status === "completed" ? "text-emerald-100/80" : item.status === "failed" || item.status === "interrupted" ? "text-rose-200/80" : "text-white/60"}`}>
                      {statusLabel(item.status)}{active && percent !== null ? ` · ${percent}%` : ""}{active || item.status === "completed" ? ` · ${amount}` : ""}{active ? ` · ${formatBytes(speed)}/s` : ""}
                    </p>
                    {active ? (
                      <div className="mt-2 h-1.5 max-w-xl overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={`Progreso de ${item.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? 0}>
                        <div className="h-full rounded-full bg-white/90 transition-[width] duration-300" style={{ width: `${percent ?? 3}%` }} />
                      </div>
                    ) : null}
                    {item.error ? <p className="mt-2 line-clamp-2 text-xs font-semibold text-rose-200/80">{item.error}</p> : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 sm:shrink-0">
                  {item.status === "completed" && item.filePath ? (
                    <>
                      <SmallAction label="Reproducir sin conexión" visibleLabel="Reproducir" bigPicture={bigPicture} onClick={() => play(item)} dataDownloadAction="play"><Play size={16} fill="currentColor" /></SmallAction>
                      {!bigPicture ? (
                        <SmallAction label="Abrir carpeta" visibleLabel="Carpeta" bigPicture={bigPicture} disabled={busy} onClick={() => void runAction(item.id, () => openDownloadFolder(item.id))} dataDownloadAction="folder">
                          {busy ? <LoaderCircle size={15} className="animate-spin" /> : <FolderOpen size={15} />}
                        </SmallAction>
                      ) : null}
                    </>
                  ) : null}
                  {active ? (
                    <SmallAction label="Cancelar descarga" visibleLabel="Cancelar" bigPicture={bigPicture} disabled={busy} onClick={() => void runAction(item.id, () => cancel(item.id))} dataDownloadAction="cancel">
                      {busy ? <LoaderCircle size={15} className="animate-spin" /> : <X size={15} />}
                    </SmallAction>
                  ) : null}
                  {item.status === "failed" || item.status === "interrupted" ? (
                    <SmallAction label="Reintentar descarga" visibleLabel="" bigPicture={bigPicture} disabled={busy} onClick={() => void runAction(item.id, () => retry(item.id))} dataDownloadAction="retry">
                      {busy ? <LoaderCircle size={17} className="animate-spin" /> : <RefreshCw size={17} />}
                    </SmallAction>
                  ) : null}
                  {!active ? (
                    <SmallAction label="Eliminar descarga" visibleLabel="" bigPicture={bigPicture} disabled={busy} onClick={() => void runAction(item.id, () => remove(item.id))} dataDownloadAction="delete">
                      {busy ? <LoaderCircle size={17} className="animate-spin" /> : <TrashBinIcon />}
                    </SmallAction>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <OfflineEmpty title="Aún no hay descargas" description="Abre una película o episodio, elige una fuente compatible y pulsa el botón de descarga junto a ella." simple />
      )}
    </section>
  );
}

function SmallAction({ label, visibleLabel, bigPicture, disabled, onClick, children, dataDownloadAction }: { label: string; visibleLabel: string; bigPicture: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; dataDownloadAction?: string }) {
  return (
    <button type="button" data-download-action={dataDownloadAction} aria-label={label} title={label} disabled={disabled} onClick={onClick} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border ${dataDownloadAction ? "border-transparent bg-white/[0.04]" : "border-white/12 bg-white/[0.06]"} text-sm font-bold text-white/85 transition-transform duration-150 ease-out hover:bg-white/12 focus-visible:outline-none ${dataDownloadAction ? "" : "focus-visible:ring-4 focus-visible:ring-white/60 focus-visible:bg-white/20"} disabled:opacity-40 ${bigPicture ? "min-h-12 px-3" : "min-w-11 px-3"}`}>
      {children}
      {visibleLabel ? <span className={bigPicture ? "" : "sr-only"}>{visibleLabel}</span> : null}
    </button>
  );
}

function TrashBinIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]">
      <path d="M2.75 6.16667C2.75 5.70644 3.09538 5.33335 3.52143 5.33335L6.18567 5.3329C6.71502 5.31841 7.18202 4.95482 7.36214 4.41691C7.36688 4.40277 7.37232 4.38532 7.39185 4.32203L7.50665 3.94993C7.5769 3.72179 7.6381 3.52303 7.72375 3.34536C8.06209 2.64349 8.68808 2.1561 9.41147 2.03132C9.59457 1.99973 9.78848 1.99987 10.0111 2.00002H13.4891C13.7117 1.99987 13.9056 1.99973 14.0887 2.03132C14.8121 2.1561 15.4381 2.64349 15.7764 3.34536C15.8621 3.52303 15.9233 3.72179 15.9935 3.94993L16.1083 4.32203C16.1279 4.38532 16.1333 4.40277 16.138 4.41691C16.3182 4.95482 16.8778 5.31886 17.4071 5.33335H19.9786C20.4046 5.33335 20.75 5.70644 20.75 6.16667C20.75 6.62691 20.4046 7 19.9786 7H3.52143C3.09538 7 2.75 6.62691 2.75 6.16667Z" />
      <path d="M11.6068 21.9998H12.3937C15.1012 21.9998 16.4549 21.9998 17.3351 21.1366C18.2153 20.2734 18.3054 18.8575 18.4855 16.0256L18.745 11.945C18.8427 10.4085 18.8917 9.6402 18.45 9.15335C18.0084 8.6665 17.2628 8.6665 15.7714 8.6665H8.22905C6.73771 8.6665 5.99204 8.6665 5.55047 9.15335C5.10891 9.6402 5.15777 10.4085 5.25549 11.945L5.515 16.0256C5.6951 18.8575 5.78515 20.2734 6.66534 21.1366C7.54553 21.9998 8.89927 21.9998 11.6068 21.9998Z" />
    </svg>
  );
}

function OfflineEmpty({ title, description, simple = false }: { title: string; description: string; simple?: boolean }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-2xl border border-white/[0.07] bg-white/[0.02] px-5 text-center">
      {!simple ? <Check size={21} className="mb-3 text-white/32" /> : null}
      <h3 className={simple ? "text-2xl font-extrabold text-white sm:text-3xl" : "text-base font-extrabold text-white/78"}>{title}</h3>
      {!simple ? <p className="mt-1.5 max-w-lg text-xs font-medium leading-5 text-white/42">{description}</p> : null}
    </div>
  );
}

function statusLabel(status: DownloadRecord["status"]) {
  switch (status) {
    case "queued": return "En cola";
    case "downloading": return "Descargando";
    case "completed": return "Disponible sin conexión";
    case "failed": return "Error";
    case "cancelled": return "Cancelada";
    case "interrupted": return "Interrumpida";
  }
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
