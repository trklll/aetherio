import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  AudioLines,
  Captions,
  Check,
  ChevronLeft,
  ChevronRight,
  Crop,
  Minus,
  ListVideo,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  TimerReset,
  Volume2,
  X,
} from "lucide-react";
import type { SelectOption, VideoScaleMode } from "./types";
import { formatTime } from "./utils";
import ContextMenu from "../../components/ui/ContextMenu";
import { tweenTo } from "../../utils/motion";

interface PlayerControlsProps {
  active: boolean;
  currentMetaTitle: string;
  title: string;
  currentTime: number;
  duration: number;
  playing: boolean;
  volume: number;
  selectedMpvAudio: string;
  selectedSubtitleValue: string;
  selectedSpeed: string;
  videoScaleMode: VideoScaleMode;
  audioOptions: SelectOption[];
  subtitleOptions: SelectOption[];
  speedOptions: string[];
  subtitlesLoading: boolean;
  subtitleDelayMs: number;
  subtitleScalePercent: number;
  subtitleVerticalPercent: number;
  showPanelToggle: boolean;
  showEpisodePanel: boolean;
  hasEpisodeOptions: boolean;
  controlsLocked: boolean;
  canGoPrevEpisode: boolean;
  canGoNextEpisode: boolean;
  onControlsEnter: () => void;
  onControlsLeave: () => void;
  onSeek: (value: number) => void;
  onJump: (offset: number) => void;
  onTogglePlay: () => void;
  onVolumeChange: (value: number) => void;
  onAudioChange: (value: string) => void;
  onSubtitleChange: (value: string) => void;
  onSubtitleDelayChange: (next: number) => void;
  onSubtitleScaleChange: (next: number) => void;
  onSubtitleVerticalChange: (next: number) => void;
  onSpeedChange: (value: string) => void;
  onToggleVideoScale: () => void;
  onToggleEpisodePanel: () => void;
  onNavigateEpisode: (direction: "prev" | "next") => void;
}

export default function PlayerControls({
  active,
  currentMetaTitle,
  title,
  currentTime,
  duration,
  playing,
  volume,
  selectedMpvAudio,
  selectedSubtitleValue,
  selectedSpeed,
  videoScaleMode,
  audioOptions,
  subtitleOptions,
  speedOptions,
  subtitlesLoading,
  subtitleDelayMs,
  subtitleScalePercent,
  subtitleVerticalPercent,
  showPanelToggle,
  showEpisodePanel,
  hasEpisodeOptions,
  controlsLocked,
  canGoPrevEpisode,
  canGoNextEpisode,
  onControlsEnter,
  onControlsLeave,
  onSeek,
  onJump,
  onTogglePlay,
  onVolumeChange,
  onAudioChange,
  onSubtitleChange,
  onSubtitleDelayChange,
  onSubtitleScaleChange,
  onSubtitleVerticalChange,
  onSpeedChange,
  onToggleVideoScale,
  onToggleEpisodePanel,
  onNavigateEpisode,
}: PlayerControlsProps) {
  const controlsRef = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => {
    tweenTo(controlsRef.current, { opacity: active ? 1 : 0 }, 0.3);
  }, [active]);

  function runControlAction(action: () => void) {
    setOpenMenu(null);
    action();
  }

  return (
    <div
      ref={controlsRef}
      data-player-interactive
      className="absolute inset-x-0 bottom-0 z-40 px-4 pb-3"
      style={{ opacity: 1, pointerEvents: active ? "auto" : "none" }}
      onMouseEnter={onControlsEnter}
      onMouseLeave={onControlsLeave}
      onMouseMove={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div
        className="mx-auto w-full max-w-[1240px] rounded-[26px] border border-white/[0.08] px-5 py-3.5 shadow-[0_30px_90px_rgba(0,0,0,0.76)]"
        style={{
          background: "linear-gradient(135deg, rgba(64,64,64,0.44), rgba(18,18,20,0.68))",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
        }}
      >
        <div className="mb-2 flex items-center gap-3 text-xs text-white/72">
          <span className="max-w-[36ch] truncate text-base font-semibold text-white/92">{currentMetaTitle}</span>
          {title ? (
            <>
              <span className="h-1 w-1 rounded-full bg-white/45" />
              <span>{title}</span>
            </>
          ) : null}
        </div>

        <div className="mb-3.5 flex items-center gap-3">
          <span className="w-12 text-right text-xs text-white/84">{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={1}
            value={Math.min(currentTime, duration || currentTime)}
            onChange={event => onSeek(Number(event.target.value))}
            disabled={!duration}
            style={{ pointerEvents: controlsLocked ? "none" : "auto", opacity: controlsLocked ? 0.42 : 1 }}
            className="h-1.5 flex-1 accent-white disabled:opacity-35"
          />
          <span className="w-12 text-xs text-white/84">{formatTime(duration)}</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <IconButton label="Retroceder 10 segundos" disabled={controlsLocked} onClick={() => runControlAction(() => onJump(-10))}>
              <RotateCcw size={19} />
            </IconButton>
            <IconButton label={playing ? "Pausar" : "Reproducir"} disabled={controlsLocked} onClick={() => runControlAction(onTogglePlay)} large>
              {playing ? <Pause size={24} fill="white" /> : <Play size={24} fill="white" />}
            </IconButton>
            <IconButton label="Avanzar 10 segundos" disabled={controlsLocked} onClick={() => runControlAction(() => onJump(10))}>
              <RotateCw size={19} />
            </IconButton>
            <div className="flex items-center gap-3 rounded-full border border-white/[0.08] bg-white/12 px-3.5 py-2.5">
              <Volume2 size={17} className="text-white/84" />
              <input
                type="range"
                min={0}
                max={2}
                step={0.01}
                value={volume}
                onChange={event => onVolumeChange(Number(event.target.value))}
                disabled={controlsLocked}
                className="h-1 w-32 accent-white"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <IconMenu
              id="audio"
              label="Audio"
              icon={<AudioLines size={17} />}
              value={selectedMpvAudio}
              options={[{ value: "", label: "Sin audio" }, ...audioOptions]}
              onChange={onAudioChange}
              open={openMenu === "audio"}
              disabled={controlsLocked}
              onToggle={() => setOpenMenu(value => value === "audio" ? null : "audio")}
              onClose={() => setOpenMenu(null)}
            />
            <SubtitleMenu
              label={subtitlesLoading ? "Cargando subtitulos" : "Subtitulos"}
              selectedSubtitleValue={selectedSubtitleValue}
              subtitleOptions={[{ value: "", label: subtitlesLoading ? "Cargando subtitulos..." : "Apagado" }, ...subtitleOptions]}
              open={openMenu === "subtitles"}
              disabled={controlsLocked}
              subtitleDelayMs={subtitleDelayMs}
              subtitleScalePercent={subtitleScalePercent}
              subtitleVerticalPercent={subtitleVerticalPercent}
              onToggle={() => setOpenMenu(value => value === "subtitles" ? null : "subtitles")}
              onClose={() => setOpenMenu(null)}
              onSubtitleChange={onSubtitleChange}
              onSubtitleDelayChange={onSubtitleDelayChange}
              onSubtitleScaleChange={onSubtitleScaleChange}
              onSubtitleVerticalChange={onSubtitleVerticalChange}
            />
            <IconMenu
              id="speed"
              label="Velocidad"
              icon={<TimerReset size={17} />}
              value={selectedSpeed}
              options={speedOptions.map(option => ({ value: option, label: `${option}x` }))}
              onChange={onSpeedChange}
              open={openMenu === "speed"}
              disabled={controlsLocked}
              onToggle={() => setOpenMenu(value => value === "speed" ? null : "speed")}
              onClose={() => setOpenMenu(null)}
            />

            <IconButton
              label={videoScaleMode === "crop" ? "Recortar" : "Original"}
              disabled={controlsLocked}
              onClick={() => runControlAction(onToggleVideoScale)}
            >
              <Crop size={18} />
            </IconButton>

            {showPanelToggle && (
              <button
                onClick={() => runControlAction(onToggleEpisodePanel)}
                disabled={controlsLocked}
                className={`flex h-10 w-10 items-center justify-center rounded-full border text-white gsap-transition ${
                  showEpisodePanel
                    ? "border-white/[0.11] bg-white/18 text-white"
                    : "border-white/[0.07] bg-white/10 text-white/90 hover:bg-white/14"
                }`}
                title="Episodios"
                aria-label="Episodios"
              >
                <ListVideo size={16} />
              </button>
            )}

            {hasEpisodeOptions && (
              <>
                <IconButton
                  label="Episodio anterior"
                  onClick={() => runControlAction(() => onNavigateEpisode("prev"))}
                  disabled={controlsLocked || !canGoPrevEpisode}
                >
                  <ChevronLeft size={18} />
                </IconButton>
                <IconButton
                  label="Episodio siguiente"
                  onClick={() => runControlAction(() => onNavigateEpisode("next"))}
                  disabled={controlsLocked || !canGoNextEpisode}
                >
                  <ChevronRight size={18} />
                </IconButton>
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

function SubtitleMenu({
  label,
  selectedSubtitleValue,
  subtitleOptions,
  open,
  disabled,
  subtitleDelayMs,
  subtitleScalePercent,
  subtitleVerticalPercent,
  onToggle,
  onClose,
  onSubtitleChange,
  onSubtitleDelayChange,
  onSubtitleScaleChange,
  onSubtitleVerticalChange,
}: {
  label: string;
  selectedSubtitleValue: string;
  subtitleOptions: SelectOption[];
  open: boolean;
  disabled?: boolean;
  subtitleDelayMs: number;
  subtitleScalePercent: number;
  subtitleVerticalPercent: number;
  onToggle: () => void;
  onClose: () => void;
  onSubtitleChange: (value: string) => void;
  onSubtitleDelayChange: (next: number) => void;
  onSubtitleScaleChange: (next: number) => void;
  onSubtitleVerticalChange: (next: number) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedOption = subtitleOptions.find(option => option.value === selectedSubtitleValue);
  const initialLanguage = selectedOption ? subtitleLanguageKey(selectedOption) : "off";
  const [selectedLanguage, setSelectedLanguage] = useState(initialLanguage);

  useEffect(() => {
    if (!open) return;
    setSelectedLanguage(initialLanguage);
  }, [initialLanguage, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      onClose();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [onClose, open]);

  const languageEntries = useMemo(() => {
    const seen = new Set<string>();
    const entries = [{ key: "off", label: "Apagado" }];
    for (const option of subtitleOptions) {
      if (!option.value || option.value === "") continue;
      const key = subtitleLanguageKey(option);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      entries.push({ key, label: subtitleLanguageLabel(option) });
    }
    return entries;
  }, [subtitleOptions]);

  const variantOptions = useMemo(() => {
    if (selectedLanguage === "off") return [];
    return subtitleOptions.filter(option => subtitleLanguageKey(option) === selectedLanguage);
  }, [selectedLanguage, subtitleOptions]);

  return (
    <div className="relative" data-player-menu data-menu-id="subtitles">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={`flex h-10 w-10 items-center justify-center rounded-full border text-white gsap-transition ${
          open ? "border-white/[0.12] bg-white/18" : "border-white/[0.07] bg-white/10 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35"
        }`}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Captions size={17} />
      </button>
      {open && !disabled ? (
        <div
          ref={menuRef}
          role="dialog"
          aria-label="Subtitulos"
          className="fixed bottom-[81px] left-1/2 z-[45] flex w-[min(760px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-white/12 text-white shadow-[0_24px_70px_rgba(0,0,0,0.68)]"
          style={{
            height: "min(460px, calc(100vh - 190px))",
            minHeight: 300,
            background: "linear-gradient(135deg, rgba(20,20,22,0.96), rgba(7,7,9,0.94))",
            backdropFilter: "blur(18px) saturate(155%)",
            WebkitBackdropFilter: "blur(18px) saturate(155%)",
          }}
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <Captions size={18} className="shrink-0 text-white/72" />
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white">Subtitulos</h3>
                <p className="truncate text-xs text-white/48">{selectedOption?.label || "Apagados"}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/64 gsap-transition hover:bg-white/10 hover:text-white"
              aria-label="Cerrar subtitulos"
              title="Cerrar"
            >
              <X size={17} />
            </button>
          </div>

          <div
            className="grid min-h-0 flex-1"
            style={{ gridTemplateColumns: "minmax(160px, 0.72fr) minmax(0, 1.6fr)" }}
          >
            <section className="flex min-h-0 flex-col border-r border-white/10 p-3">
              <h4 className="mb-2 px-1 text-xs font-bold uppercase text-white/46">Idioma</h4>
              <div className="min-h-0 space-y-1.5 overflow-y-auto pr-1">
                {languageEntries.map(entry => (
                  <SubtitleItemButton
                    key={entry.key}
                    active={selectedLanguage === entry.key}
                    label={entry.label}
                    onClick={() => {
                      setSelectedLanguage(entry.key);
                      if (entry.key === "off") onSubtitleChange("");
                      else {
                        const first = subtitleOptions.find(option => subtitleLanguageKey(option) === entry.key);
                        if (first) onSubtitleChange(first.value);
                      }
                    }}
                  />
                ))}
              </div>
            </section>

            <section className="flex min-h-0 min-w-0 flex-col">
              <div className="flex min-h-0 flex-1 flex-col p-3">
                <h4 className="mb-2 px-1 text-xs font-bold uppercase text-white/46">Pista</h4>
                <div className="min-h-0 space-y-1.5 overflow-y-auto pr-1">
                  {selectedLanguage === "off" ? (
                    <p className="px-2 py-3 text-sm text-white/42">Subtitulos desactivados.</p>
                  ) : variantOptions.length ? (
                    variantOptions.map(option => (
                      <SubtitleVariantButton
                        key={option.value}
                        option={option}
                        active={option.value === selectedSubtitleValue}
                        onClick={() => onSubtitleChange(option.value)}
                      />
                    ))
                  ) : (
                    <p className="px-2 py-3 text-sm text-white/42">No hay pistas disponibles.</p>
                  )}
                </div>
              </div>

              <div className="shrink-0 border-t border-white/10 p-3">
                <h4 className="mb-2 px-1 text-xs font-bold uppercase text-white/46">Ajustes</h4>
                <div className="grid grid-cols-3 gap-2">
                  <SubtitleStepper
                    label="Atraso"
                    value={formatDelay(subtitleDelayMs)}
                    onDecrease={() => onSubtitleDelayChange(subtitleDelayMs - 250)}
                    onIncrease={() => onSubtitleDelayChange(subtitleDelayMs + 250)}
                  />
                  <SubtitleStepper
                    label="Tamano"
                    value={`${subtitleScalePercent}%`}
                    onDecrease={() => onSubtitleScaleChange(subtitleScalePercent - 5)}
                    onIncrease={() => onSubtitleScaleChange(subtitleScalePercent + 5)}
                  />
                  <SubtitleStepper
                    label="Posicion vertical"
                    value={`${subtitleVerticalPercent}%`}
                    onDecrease={() => onSubtitleVerticalChange(subtitleVerticalPercent - 5)}
                    onIncrease={() => onSubtitleVerticalChange(subtitleVerticalPercent + 5)}
                  />
                </div>
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  disabled = false,
  large = false,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  large?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center rounded-full border border-white/[0.07] bg-white/10 text-white gsap-transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-35 ${
        large ? "h-11 w-11" : "h-10 w-10"
      }`}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function IconMenu({
  id,
  icon,
  label,
  value,
  options,
  onChange,
  open,
  onToggle,
  onClose,
  disabled = false,
}: {
  id: string;
  icon: ReactNode;
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative" data-player-menu data-menu-id={id}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={`flex h-10 w-10 items-center justify-center rounded-full border text-white gsap-transition ${
          open ? "border-white/[0.12] bg-white/18" : "border-white/[0.07] bg-white/10 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35"
        }`}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {icon}
      </button>
      <ContextMenu
        open={open && !disabled}
        anchorRef={buttonRef}
        onClose={onClose}
        width={224}
        maxHeight={288}
        placement="above-end"
        items={options.map(option => ({
          label: option.label,
          icon: option.value === value ? <Check size={14} /> : undefined,
          onSelect: () => onChange(option.value),
        }))}
      />
    </div>
  );
}

function SubtitleItemButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-sm font-semibold gsap-transition ${
        active
          ? "border-white/22 bg-white/14 text-white"
          : "border-transparent bg-white/[0.04] text-white/76 hover:bg-white/[0.08] hover:text-white"
      }`}
    >
      <span className="min-w-0 truncate">{label}</span>
      {active ? <Check size={14} className="shrink-0" /> : null}
    </button>
  );
}

function SubtitleVariantButton({
  option,
  active,
  onClick,
}: {
  option: SelectOption;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-12 w-full items-center gap-3 rounded-md border px-3 py-2 text-left gsap-transition ${
        active
          ? "border-white/22 bg-white/14 text-white"
          : "border-transparent bg-white/[0.04] text-white/84 hover:bg-white/[0.08]"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{clipSubtitleLabel(option.label)}</span>
        <span className="mt-0.5 block truncate text-xs font-medium text-white/48">{subtitleVariantSourceLabel(option)}</span>
      </span>
      {active ? <Check size={15} className="shrink-0" /> : null}
    </button>
  );
}

function SubtitleStepper({
  label,
  value,
  onDecrease,
  onIncrease,
}: {
  label: string;
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 truncate px-1 text-xs font-semibold text-white/56" title={label}>{label}</p>
      <div className="grid h-10 min-w-0 grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-1 rounded-md border border-white/10 bg-white/[0.05] px-1">
        <button type="button" onClick={onDecrease} style={stepperButtonStyle}><Minus size={16} /></button>
        <span className="truncate text-center text-sm font-bold text-white/94">{value}</span>
        <button type="button" onClick={onIncrease} style={stepperButtonStyle}><Plus size={16} /></button>
      </div>
    </div>
  );
}

const stepperButtonStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 6,
  border: "none",
  background: "rgba(255,255,255,0.07)",
  color: "rgba(255,255,255,0.95)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

function subtitleLanguageKey(option: SelectOption) {
  if (option.languageKey?.trim()) return option.languageKey.trim().toLowerCase();
  if (!option.value) return "off";
  const label = option.label.trim().toLowerCase();
  if (!label) return "other";
  const langQuery = label.match(/(?:^|[?&])(?:lang|lang_code|language)=([a-z-]{2,12})/i);
  if (langQuery?.[1]) return langQuery[1].toLowerCase();
  const token = label.split(" - ")[0]?.trim() ?? label;
  if (!token) return "other";
  return token;
}

function subtitleLanguageLabel(option: SelectOption) {
  if (option.languageLabel?.trim()) return option.languageLabel.trim();
  const label = option.label.trim();
  const token = label.split(" - ")[0]?.trim() ?? label;
  if (!token) return "Otro";
  if (/^es$|spa|spanish|espanol|español/i.test(token)) return "Espanol";
  if (/^en$|eng|english/i.test(token)) return "English";
  return token.length <= 18 ? token : token.slice(0, 18);
}

function subtitleVariantSourceLabel(option: SelectOption) {
  if (option.sourceLabel?.trim()) return option.sourceLabel.trim();
  if (!option.value) return "Ninguno";
  if (option.value.startsWith("track:")) return "Embebido";
  return "Externo";
}

function clipSubtitleLabel(label: string) {
  const trimmed = label.trim();
  if (trimmed.length <= 34) return trimmed;
  return `${trimmed.slice(0, 33)}...`;
}

function formatDelay(valueMs: number) {
  if (!valueMs) return "--";
  const seconds = valueMs / 1000;
  return `${seconds > 0 ? "+" : ""}${seconds.toFixed(2)}s`;
}
