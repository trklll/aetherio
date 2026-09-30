import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { hasEntrancePlayed, markEntrancePlayed } from "../../utils/homeEntrance.ts";
import type { MediaItem } from "../../types/ui.ts";
import { ensureOriginalTmdbImage } from "../../utils/tmdbArtwork.ts";
import { gsap, prefersReducedMotion, tweenTo } from "../../utils/motion.ts";
import { GAMEPAD_ACTION_EVENT, type GamepadActionDetail } from "../../hooks/useGamepad.ts";
import { useYouTubePlayer } from "../../hooks/useYouTubePlayer.ts";
import {
  fetchYouTubeClip,
  getCachedFirstTrailerClipInfo,
  type YouTubeClipCandidate,
} from "../../services/youtubeClips.ts";

import {
  HERO_NEXT_EVENT,
  HERO_PREV_EVENT,
  openPictureRail,
} from "../../navigation/spatialNav.ts";

const START_TIME = 60;
const HERO_WIPE_MS = 850;
// Volumen de los clips/trailers del hero (0.78 → 0.6 para no pisar el resto).
const HERO_CLIP_VOLUME = 0.6;
// Ciclo del hero: background -> info en pantalla -> 2.5s -> trailer ->
// background 2.5s -> siguiente. El conteo previo al trailer arranca cuando la
// info (copy del hero) ya es visible, no al montar el item.
const PRE_VIDEO_STILL_MS = 2500;
// Al terminar el trailer: fade al still del medio actual y pausa antes de avanzar.
const POST_VIDEO_STILL_MS = 2500;
// El trailer solo suena hasta el 96% de su duración (corta coletillas,
// end-cards y fundidos a negro de YouTube).
const TRAILER_PLAY_FRACTION = 0.96;
// Duración del fundido de salida (audio e imagen) al cortarse el trailer.
const TRAILER_FADE_MS = 800;

interface Props {
  items: MediaItem[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onActiveItem: (item: MediaItem | undefined) => void;
  animateEntrance?: boolean;
  contentVisible?: boolean;
}

/**
 * Hero de picture: rota por los medios igual que el hero anterior.
 * Por cada medio carga su clip; cuando el clip termina, pasa al siguiente.
 * El video va en el background maximizado (lógica Detail: blur al bajar).
 */
export default function BigPictureBackdrop({ items, scrollRef, onActiveItem, animateEntrance = false, contentVisible = true }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [clipCandidates, setClipCandidates] = useState<YouTubeClipCandidate[]>([]);
  const [clipIndex, setClipIndex] = useState(0);
  const [fetchSettled, setFetchSettled] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [preHoldDone, setPreHoldDone] = useState(false);
  const preHoldTimerRef = useRef<number | null>(null);
  // Fade-in del backdrop solo en la entrada fresca a la app, una sola vez
  // (al volver del detalle el backdrop se remonta: debe salir visible).
  const [entranceFadedIn, setEntranceFadedIn] = useState(!animateEntrance || hasEntrancePlayed());
  const entranceDoneRef = useRef(!animateEntrance || hasEntrancePlayed());
  const fadeEntranceIn = useCallback(() => {
    if (entranceDoneRef.current) return;
    entranceDoneRef.current = true;
    markEntrancePlayed();
    requestAnimationFrame(() => requestAnimationFrame(() => setEntranceFadedIn(true)));
  }, []);

  useEffect(() => {
    if (!animateEntrance) return;
    const timer = window.setTimeout(() => fadeEntranceIn(), 3500);
    return () => window.clearTimeout(timer);
  }, [animateEntrance, fadeEntranceIn]);
  // Los clips van siempre con sonido (sin botón de volumen). Si el navegador
  // bloquea el autoplay con sonido, se reintenta muteado en vez de fallar.
  const [isMuted, setIsMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoEndHandledRef = useRef(false);

  const backdropRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const darkRef = useRef<HTMLDivElement>(null);
  const blurRef = useRef(0);
  const vignetteValueRef = useRef(1);
  const darkValueRef = useRef(0);
  const holdTimerRef = useRef<number | null>(null);
  // Trailer en pausa por scroll (bajó a las rows): muestra el still.
  // El video SOLO suena/reproduce en el hero; en las rows rotan stills.
  const pausedByScrollRef = useRef(false);
  const [inHero, setInHero] = useState(true);

  const activeItem = items.length ? items[activeIndex % items.length] : undefined;
  const [displayItem, setDisplayItem] = useState<MediaItem | undefined>(activeItem);
  const [transitionItem, setTransitionItem] = useState<MediaItem | undefined>(undefined);
  const displayBg = ensureOriginalTmdbImage(displayItem?.background) ?? displayItem?.poster ?? "";
  const transitionBg = ensureOriginalTmdbImage(transitionItem?.background) ?? transitionItem?.poster ?? "";

  useEffect(() => {
    onActiveItem(activeItem);
  }, [activeItem, onActiveItem]);

  useEffect(() => () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (preHoldTimerRef.current !== null) {
      window.clearTimeout(preHoldTimerRef.current);
      preHoldTimerRef.current = null;
    }
  }, []);

  // Reset del ciclo con cada item (no arranca el conteo aquí).
  useEffect(() => {
    setVideoReady(false);
    setPreHoldDone(false);
    videoEndHandledRef.current = false;
    if (preHoldTimerRef.current !== null) {
      window.clearTimeout(preHoldTimerRef.current);
      preHoldTimerRef.current = null;
    }
    // Un fundido de salida del item anterior no debe arrastrar el volumen
    // a 0 en el siguiente trailer.
    if (videoRef.current) gsap.killTweensOf(videoRef.current, "volume");
    if (audioRef.current) gsap.killTweensOf(audioRef.current, "volume");
    videoRef.current?.pause();
    audioRef.current?.pause();
    return () => {
      if (preHoldTimerRef.current !== null) {
        window.clearTimeout(preHoldTimerRef.current);
        preHoldTimerRef.current = null;
      }
    };
  }, [activeItem?.id, activeItem?.type]);

  // El conteo de 2.5s arranca cuando la info ya está en pantalla.
  useEffect(() => {
    if (!contentVisible || !activeItem || preHoldDone) return;
    if (preHoldTimerRef.current !== null) return;
    preHoldTimerRef.current = window.setTimeout(() => {
      preHoldTimerRef.current = null;
      setPreHoldDone(true);
    }, PRE_VIDEO_STILL_MS);
    return () => {
      if (preHoldTimerRef.current !== null) {
        window.clearTimeout(preHoldTimerRef.current);
        preHoldTimerRef.current = null;
      }
    };
  }, [activeItem?.id, activeItem?.type, contentVisible, preHoldDone]);

  useEffect(() => {
    if (!activeItem) {
      setDisplayItem(undefined);
      setTransitionItem(undefined);
      return;
    }
    if (displayItem?.id === activeItem.id && displayItem.type === activeItem.type) return;
    if (!displayItem || prefersReducedMotion()) {
      setDisplayItem(activeItem);
      setTransitionItem(undefined);
      return;
    }

    setTransitionItem(activeItem);
    const timer = window.setTimeout(() => {
      setDisplayItem(activeItem);
      setTransitionItem(undefined);
    }, HERO_WIPE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  // The active media identity is the transition trigger; the displayed item is
  // intentionally held until the curtain has finished.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem?.id, activeItem?.type]);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const advance = () => {
    clearHoldTimer();
    if (preHoldTimerRef.current !== null) {
      window.clearTimeout(preHoldTimerRef.current);
      preHoldTimerRef.current = null;
    }
    setVideoReady(false);
    videoEndHandledRef.current = false;
    setActiveIndex(index => (items.length ? (index + 1) % items.length : 0));
  };

  const failCurrentStream = () => {
    setVideoReady(false);
    setClipIndex(index => Math.min(index + 1, Math.max(clipCandidates.length - 1, 0)));
  };

  // Carga de clips del medio activo (caché o fetch), igual que HeroSection.
  useEffect(() => {
    setVideoReady(false);
    // La rotación en las rows no levanta el pause: el autoplay sigue
    // bloqueado hasta volver al hero.
    const shell = scrollRef.current;
    pausedByScrollRef.current = shell
      ? shell.scrollTop > Math.min(window.innerHeight * 0.62, 640)
      : false;
    setClipCandidates([]);
    setClipIndex(0);
    setFetchSettled(false);
    if (!activeItem) {
      setFetchSettled(true);
      return;
    }
    const cached = getCachedFirstTrailerClipInfo(activeItem);
    if (cached) {
      setClipCandidates([
        { videoId: cached.videoId, source: cached.source, duration: cached.duration },
        ...(cached.fallbacks ?? []),
      ]);
      setFetchSettled(true);
      return;
    }
    let cancelled = false;
    void fetchYouTubeClip(activeItem, { firstTrailerOnly: true }).then(result => {
      if (cancelled) return;
      if (result) {
        setClipCandidates([
          { videoId: result.videoId, source: result.source, duration: result.duration },
          ...(result.fallbacks ?? []),
        ]);
      }
      setFetchSettled(true);
    });
    return () => { cancelled = true; };
  }, [activeItem?.id, activeItem?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  const clipInfo = clipCandidates[clipIndex] ?? null;
  const { stream, loading: streamLoading, error: streamError } = useYouTubePlayer(
    clipInfo ? clipInfo.videoId : null,
  );

  // Prefetch del clip del siguiente medio mientras suena el actual.
  useEffect(() => {
    if (!clipCandidates.length || items.length < 2) return;
    const nextItem = items[(activeIndex + 1) % items.length];
    const timer = window.setTimeout(() => {
      void fetchYouTubeClip(nextItem, { priority: "background", firstTrailerOnly: true });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [activeIndex, clipCandidates.length, items]);

  useEffect(() => {
    videoEndHandledRef.current = false;
    setIsMuted(false);
  }, [clipInfo?.videoId]);

  // Ciclado del medio del banner desde el botón Reproducir: adelante igual
  // que el "Siguiente"; atrás solo si hay un medio anterior — en el primero
  // no hay nada a lo que volver y abre el rail (scaffold nativo).
  const goBack = () => {
    if (activeIndex <= 0) {
      openPictureRail();
      return;
    }
    clearHoldTimer();
    if (preHoldTimerRef.current !== null) {
      window.clearTimeout(preHoldTimerRef.current);
      preHoldTimerRef.current = null;
    }
    setVideoReady(false);
    videoEndHandledRef.current = false;
    setActiveIndex(index => Math.max(0, index - 1));
  };

  // Botón "Siguiente" del hero / derecha-izquierda desde Reproducir.
  useEffect(() => {
    const onNext = () => advance();
    const onPrev = () => goBack();
    window.addEventListener(HERO_NEXT_EVENT, onNext);
    window.addEventListener(HERO_PREV_EVENT, onPrev);
    return () => {
      window.removeEventListener(HERO_NEXT_EVENT, onNext);
      window.removeEventListener(HERO_PREV_EVENT, onPrev);
    };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onGamepadAction = (event: Event) => {
      if (!inHero || items.length < 2) return;
      const id = (event as CustomEvent<GamepadActionDetail>).detail?.id;
      if (id !== "lb" && id !== "rb") return;
      event.preventDefault();
      window.dispatchEvent(new CustomEvent(id === "lb" ? HERO_PREV_EVENT : HERO_NEXT_EVENT));
    };
    window.addEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
    return () => window.removeEventListener(GAMEPAD_ACTION_EVENT, onGamepadAction);
  }, [inHero, items.length]);

  // Stream fallido: siguiente candidato.
  useEffect(() => {
    if (!streamError) return;
    failCurrentStream();
  }, [streamError]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve colgado (yt-dlp sin respuesta): no quedarse clavado para siempre.
  useEffect(() => {
    if (!clipInfo || stream || !streamLoading) return;
    const timer = window.setTimeout(() => {
      console.warn("[Aetherio:YouTube] Resolve sin respuesta en picture, pasando al siguiente candidato.");
      failCurrentStream();
    }, 25000);
    return () => window.clearTimeout(timer);
  }, [clipInfo?.videoId, stream, streamLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sin trailer reproducible (fetch vacío, candidatos agotados o reduced
  // motion): el background espera su hold tras la info y avanza.
  // En las rows también rotan stills (nunca video): el advance resetea el
  // pause pero el play queda bloqueado abajo hasta volver al hero.
  const exhausted = clipCandidates.length > 0 && streamError != null && clipIndex >= clipCandidates.length - 1;
  useEffect(() => {
    if (!activeItem || !fetchSettled || !preHoldDone) return;
    if (!inHero) {
      const timer = window.setTimeout(advance, POST_VIDEO_STILL_MS);
      return () => window.clearTimeout(timer);
    }
    const hasPlayableTrailer = !exhausted && clipCandidates.length > 0 && !prefersReducedMotion();
    if (hasPlayableTrailer) return;
    const timer = window.setTimeout(advance, POST_VIDEO_STILL_MS);
    return () => window.clearTimeout(timer);
  }, [activeItem, fetchSettled, preHoldDone, stream, streamLoading, exhausted, clipCandidates.length, inHero]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al terminar el pre-hold (info visible + 2.5s), arrancar el trailer si ya hay stream.
  useEffect(() => {
    if (!preHoldDone || !contentVisible || !inHero || pausedByScrollRef.current) return;
    if (!stream || streamLoading) return;
    if (prefersReducedMotion()) return;
    const video = videoRef.current;
    if (video && video.paused) {
      void video.play().catch(() => undefined);
    }
  }, [preHoldDone, contentVisible, inHero, stream, streamLoading]);

  const showTrailer = videoReady && preHoldDone && contentVisible;

  const finishVideo = () => {
    if (videoEndHandledRef.current) return;
    videoEndHandledRef.current = true;
    // Corte al 98%: fundido de salida en audio (rampa de volumen) e imagen
    // (videoReady=false dispara el crossfade CSS), hold de 2.5s sobre el
    // background y avance al siguiente medio (wipe).
    const video = videoRef.current;
    const audio = audioRef.current;
    const fading: Array<HTMLVideoElement | HTMLAudioElement> = [];
    if (video && !video.paused) fading.push(video);
    if (audio && !audio.paused) fading.push(audio);
    setVideoReady(false);
    clearHoldTimer();
    if (fading.length) {
      for (const el of fading) {
        gsap.killTweensOf(el, "volume");
        gsap.to(el, {
          volume: 0,
          duration: TRAILER_FADE_MS / 1000,
          ease: "power1.out",
          overwrite: true,
          onComplete: () => { el.pause(); },
        });
      }
    } else {
      video?.pause();
      audio?.pause();
    }
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      advance();
    }, TRAILER_FADE_MS + POST_VIDEO_STILL_MS);
  };

  // Solo si el navegador bloquea el autoplay con sonido: reintentar muteado.
  const fallbackToMuted = () => {
    const video = videoRef.current;
    const audio = audioRef.current;
    setIsMuted(true);
    if (video) {
      video.muted = true;
      video.play().catch(() => undefined);
    }
    if (audio) {
      audio.muted = true;
      audio.play().catch(() => undefined);
    }
  };

  // Blur por scroll — misma fórmula que Detail (updateBackdropBlur).
  // Además: al bajar a las rows el trailer se pausa y queda el still;
  // al volver arriba retoma su curso (mismo clip, misma posición).
  useEffect(() => {
    const shell = scrollRef.current;
    if (!shell) return;
    const heroHeight = () => Math.min(window.innerHeight * 0.62, 640);
    const onScroll = () => {
      const scrollTop = shell.scrollTop;
      const blur = Math.round(Math.min(28, Math.max(0, scrollTop / 12)));
      const vignetteOpacity = Math.round(Math.max(0, 1 - scrollTop / 240) * 100) / 100;
      const darkOpacity = Math.round(Math.min(0.55, Math.max(0, scrollTop / 400)) * 100) / 100;
      if (blur !== blurRef.current) {
        blurRef.current = blur;
        const el = backdropRef.current;
        if (el) {
          gsap.killTweensOf(el);
          gsap.set(el, { filter: `blur(${blur}px)`, scale: 1 + blur * 0.0018 });
        }
      }
      if (vignetteOpacity !== vignetteValueRef.current) {
        vignetteValueRef.current = vignetteOpacity;
        tweenTo(vignetteRef.current, { opacity: vignetteOpacity }, 0.24);
      }
      if (darkOpacity !== darkValueRef.current) {
        darkValueRef.current = darkOpacity;
        tweenTo(darkRef.current, { opacity: darkOpacity }, 0.24);
      }

      const pastHero = scrollTop > heroHeight();
      setInHero(prev => (prev === !pastHero ? prev : !pastHero));
      if (pastHero && !pausedByScrollRef.current) {
        pausedByScrollRef.current = true;
        // Fade de audio suave (no corte brusco): bajar el volumen a 0 y
        // pausar al llegar; lo mismo al volver (fade-in desde 0).
        const video = videoRef.current;
        const audio = audioRef.current;
        const audible: Array<HTMLVideoElement | HTMLAudioElement> = [];
        if (audio && !audio.muted && !audio.paused) audible.push(audio);
        if (video && !video.muted && !video.paused) audible.push(video);
        if (audible.length) {
          for (const el of audible) {
            gsap.killTweensOf(el, "volume");
            gsap.to(el, {
              volume: 0,
              duration: 0.35,
              ease: "power2.in",
              overwrite: true,
              onComplete: () => { el.pause(); },
            });
          }
        } else {
          videoRef.current?.pause();
          audioRef.current?.pause();
        }
        setVideoReady(false);
      } else if (!pastHero && pausedByScrollRef.current) {
        pausedByScrollRef.current = false;
        const video = videoRef.current;
        const audio = audioRef.current;
        if (video && stream) {
          // Carrera bajar/subir dentro del fade-out (0.35s): el tween se
          // cancela antes del pause(), el video nunca se detuvo y play()
          // NO re-dispara `playing`. Sin esto el still tapaba el video
          // para siempre (videoReady se puso en false al bajar).
          if (!video.paused) {
            setVideoReady(true);
          }
          const fadeInVolume = (el: HTMLVideoElement | HTMLAudioElement, target: number) => {
            gsap.killTweensOf(el, "volume");
            el.volume = 0;
            gsap.to(el, { volume: target, duration: 0.5, ease: "power1.out", overwrite: true });
          };
          if (stream.audioUrl && audio) {
            audio.currentTime = video.currentTime;
            audio.muted = isMuted;
            void audio.play().then(() => {
              fadeInVolume(audio, HERO_CLIP_VOLUME);
            }).catch(() => fallbackToMuted());
          }
          if (video.muted) {
            void video.play().catch(() => fallbackToMuted());
          } else {
            void video.play().then(() => {
              fadeInVolume(video, HERO_CLIP_VOLUME);
            }).catch(() => fallbackToMuted());
          }
        }
      }
    };
    shell.addEventListener("scroll", onScroll, { passive: true });
    return () => shell.removeEventListener("scroll", onScroll);
  }, [scrollRef, stream, isMuted]);

  return (
    <>
      <div
        className="bp-bg"
        aria-hidden="true"
        style={{
          opacity: entranceFadedIn ? 1 : 0,
          transition: animateEntrance ? "opacity 0.9s ease" : undefined,
        }}
      >
        <div className="bp-bg__frame">
          <div ref={backdropRef} className="bp-bg__image" style={{ filter: "blur(0px)", transform: "scale(1)" }}>
            {displayBg ? (
              <img
                key={`bp-current-${displayBg}`}
                src={displayBg}
                alt=""
                decoding="async"
                onLoad={fadeEntranceIn}
                onError={fadeEntranceIn}
                className="bp-bg__still"
                style={{
                  opacity: showTrailer ? 0 : 1,
                  // Crossfade simétrico con el video: entrada lenta (1.5s),
                  // salida al ritmo del fundido de corte (0.8s).
                  transition: `opacity ${showTrailer ? "1.5s" : "0.8s"} ease-in-out`,
                }}
              />
            ) : null}
            {transitionItem && transitionBg ? (
              <img
                key={`bp-transition-${transitionItem.id}-${activeIndex}`}
                src={transitionBg}
                alt=""
                decoding="async"
                className="bp-bg__still bp-bg__still--incoming bp-wipe-layer"
              />
            ) : null}
            {stream && !streamLoading && (
              <video
                ref={videoRef}
                key={clipInfo ? clipInfo.videoId : "placeholder"}
                src={stream.url}
                muted={stream.audioUrl ? true : isMuted}
                playsInline
                preload="auto"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  border: "none",
                  objectFit: "cover",
                  opacity: showTrailer ? 1 : 0,
                  // Entrada lenta (1.5s), salida al ritmo del fundido de
                  // corte (0.8s) para que el still quede solo 2.5s.
                  transition: `opacity ${showTrailer ? "1.5s" : "0.8s"} ease-in-out`,
                }}
                onLoadedMetadata={event => {
                  const video = event.currentTarget;
                  video.muted = stream.audioUrl ? true : isMuted;
                  if (!stream.audioUrl && !isMuted) video.volume = HERO_CLIP_VOLUME;
                  const duration = Number.isFinite(video.duration) ? video.duration : (stream.duration ?? clipInfo?.duration ?? 0);
                  const startAt = duration > START_TIME + 20
                    ? START_TIME
                    : Math.max(0, Math.min(12, duration * 0.15));
                  if (startAt > 0 && startAt < duration) {
                    video.currentTime = startAt;
                    if (audioRef.current) audioRef.current.currentTime = startAt;
                  }
                  // Solo en el hero, con la info visible y tras el hold de 2.5s:
                  // en las rows el still manda (sin autoplay).
                  if (!pausedByScrollRef.current && preHoldDone && contentVisible && !prefersReducedMotion()) {
                    video.play().catch(() => fallbackToMuted());
                  }
                }}
                onPlaying={event => {
                  if (pausedByScrollRef.current || !preHoldDone || !contentVisible || prefersReducedMotion()) {
                    event.currentTarget.pause();
                    return;
                  }
                  const audio = audioRef.current;
                  if (stream.audioUrl && audio) {
                    if (Math.abs(audio.currentTime - event.currentTarget.currentTime) > 0.2) {
                      audio.currentTime = event.currentTarget.currentTime;
                    }
                    audio.muted = isMuted;
                    audio.volume = HERO_CLIP_VOLUME;
                    void audio.play().catch(() => {
                      // Bloqueo de autoplay, no clip roto: seguir muteado.
                      fallbackToMuted();
                    });
                  }
                  setVideoReady(true);
                }}
                onPause={() => audioRef.current?.pause()}
                onTimeUpdate={event => {
                  // El trailer solo suena hasta el 96% de su duración.
                  const video = event.currentTarget;
                  const duration = video.duration;
                  if (Number.isFinite(duration) && duration > 0 && video.currentTime >= duration * TRAILER_PLAY_FRACTION) {
                    finishVideo();
                  }
                }}
                onEnded={finishVideo}
                onError={() => failCurrentStream()}
              />
            )}
            {stream?.audioUrl && !streamLoading && (
              <audio
                ref={audioRef}
                key={`${clipInfo?.videoId ?? "placeholder"}-audio`}
                src={stream.audioUrl}
                muted={isMuted}
                preload="auto"
                onError={() => failCurrentStream()}
              />
            )}
          </div>
        </div>
        <div ref={vignetteRef} className="bp-bg__vignette" />
        <div ref={darkRef} className="bp-bg__dark" />
      </div>
    </>
  );
}
