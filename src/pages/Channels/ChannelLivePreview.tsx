import { useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw, Volume2, VolumeX } from "lucide-react";
import type Hls from "hls.js";
import type { IptvChannel } from "../../services/iptvChannels";
import { resolveIptvChannelStream } from "../../services/iptvChannels";
import { fetchIptvBytes, publicIptvUrl } from "../../services/iptvSportsHttp";
import { isTauriRuntime } from "../../runtime/platform";
import { cleanChannelName } from "./liveChannelModel";

type PreviewState = "loading" | "playing" | "error" | "paused";

export default function ChannelLivePreview({ channel }: { channel: IptvChannel }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<PreviewState>("loading");
  const [muted, setMuted] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    let hls: Hls | undefined;
    setState("loading");
    setMuted(true);
    setLogoFailed(false);
    video.muted = true;
    const fail = () => { if (!disposed) setState("error"); };
    const play = () => video.play().catch(() => { if (!disposed) setState("paused"); });
    video.addEventListener("error", fail);
    const deadline = window.setTimeout(fail, 20_000);
    const playing = () => { window.clearTimeout(deadline); setState("playing"); };
    video.addEventListener("playing", playing);

    // A focus dwell avoids opening streams for every channel crossed by a held D-pad.
    const dwell = window.setTimeout(() => {
      void resolveIptvChannelStream(channel).then(async resolved => {
        if (disposed) return;
        if (/\.m3u8(?:[?#]|$)/i.test(resolved.streamUrl) || !/\.(?:mp4|webm|ogg)(?:[?#]|$)/i.test(resolved.streamUrl)) {
          const { default: HlsPlayer } = await import("hls.js");
          if (disposed) return;
          if (HlsPlayer.isSupported()) {
            const BaseLoader = HlsPlayer.DefaultConfig.loader;
            // Reuse Aetherio's public-URL validation, request bounds and native
            // provider transport. WebView2 cannot fetch CORS-restricted HLS itself.
            class NativeLoader extends BaseLoader {
              override load(context: Parameters<InstanceType<typeof BaseLoader>["load"]>[0], config: Parameters<InstanceType<typeof BaseLoader>["load"]>[1], callbacks: Parameters<InstanceType<typeof BaseLoader>["load"]>[2]) {
                if (!publicIptvUrl(context.url)) {
                  callbacks.onError({ code: 0, text: "La señal contiene una URL no pública." }, context, null, this.stats);
                  return;
                }
                if (!isTauriRuntime()) { super.load(context, config, callbacks); return; }
                this.context = context;
                this.stats.loading.start = performance.now();
                const headers: Record<string, string> = {};
                if (context.rangeStart !== undefined && context.rangeEnd !== undefined) headers.Range = `bytes=${context.rangeStart}-${context.rangeEnd - 1}`;
                void fetchIptvBytes(context.url, headers, 16 * 1024 * 1024).then(bytes => {
                  if (disposed || this.stats.aborted) return;
                  this.stats.loading.first = this.stats.loading.end = performance.now();
                  this.stats.loaded = this.stats.total = bytes.byteLength;
                  callbacks.onSuccess({ url: context.url, data: context.responseType === "arraybuffer" ? new Uint8Array(bytes).buffer : new TextDecoder().decode(bytes) }, this.stats, context, null);
                }).catch(error => {
                  if (!disposed && !this.stats.aborted) callbacks.onError({ code: 0, text: String(error) }, context, null, this.stats);
                });
              }
              override abort() { this.stats.aborted = true; super.abort(); }
              override destroy() { this.stats.aborted = true; super.destroy(); }
            }
            hls = new HlsPlayer({ loader: NativeLoader, maxBufferLength: 12, backBufferLength: 0, capLevelToPlayerSize: true, startLevel: 0 });
            hls.on(HlsPlayer.Events.ERROR, (_, data) => { if (data.fatal) { hls?.destroy(); fail(); } });
            hls.on(HlsPlayer.Events.MANIFEST_PARSED, () => { void play(); });
            hls.loadSource(resolved.streamUrl);
            hls.attachMedia(video);
            return;
          }
          if (!video.canPlayType("application/vnd.apple.mpegurl")) { fail(); return; }
        }
        video.src = resolved.streamUrl;
        void play();
      }).catch(fail);
    }, 320);
    return () => {
      disposed = true;
      window.clearTimeout(dwell);
      window.clearTimeout(deadline);
      hls?.destroy();
      video.removeEventListener("error", fail);
      video.removeEventListener("playing", playing);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [channel, attempt]);

  return <div className="live-preview" aria-label={`Vista previa de ${cleanChannelName(channel.name)}`} data-preview-state={state}>
    <video ref={videoRef} autoPlay muted={muted} playsInline disablePictureInPicture aria-label={`Emisión en directo de ${cleanChannelName(channel.name)}`} />
    {state !== "playing" && <div className="live-preview__standby">
      {channel.logo && !logoFailed ? <img className="live-preview__logo" src={channel.logo} alt={cleanChannelName(channel.name)} onError={() => setLogoFailed(true)} /> : <strong>{cleanChannelName(channel.name)}</strong>}
      <div className="live-preview__message" role="status">
        {state === "loading" ? <><LoaderCircle className="live-channels__spinner" size={18} aria-hidden="true" />Conectando con el canal…</>
          : state === "paused" ? <button type="button" onClick={() => { void videoRef.current?.play().catch(() => setState("error")); }}>Iniciar vista previa</button>
          : <><span>La vista previa no está disponible</span><button type="button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={15} aria-hidden="true" /> Reintentar</button></>}
      </div>
    </div>}
    <span className="live-preview__badge liquid-glass-dark rounded-full">{state === "playing" && <i aria-hidden="true" />}{state === "playing" ? "EN DIRECTO" : "VISTA PREVIA"}</span>
    {state === "playing" && <button type="button" className="live-preview__sound liquid-glass-dark rounded-full" aria-label={muted ? "Activar sonido de la vista previa" : "Silenciar vista previa"} onClick={() => setMuted(value => !value)}>
      {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
    </button>}
  </div>;
}
