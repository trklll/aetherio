import accountIcon from "../../assets/settings-icons/user-circle-fill.svg";
import designIcon from "../../assets/settings-icons/palette-fill.svg";
import addonsIcon from "../../assets/settings-icons/puzzle-piece-fill.svg";
import sourcesIcon from "../../assets/settings-icons/database-fill.svg";
import playbackIcon from "../../assets/settings-icons/monitor-play-fill.svg";
import aboutIcon from "../../assets/settings-icons/info-fill.svg";

export type SettingsCategory = "account" | "design" | "addons" | "sources" | "playback" | "about";

const CATEGORY_ICONS: Record<SettingsCategory, { src: string; label: string }> = {
  account: { src: accountIcon, label: "Cuenta" },
  design: { src: designIcon, label: "Diseño" },
  addons: { src: addonsIcon, label: "Complementos" },
  sources: { src: sourcesIcon, label: "Fuentes" },
  playback: { src: playbackIcon, label: "Reproducción" },
  about: { src: aboutIcon, label: "Acerca de" },
};

/** Original Phosphor Fill SVGs, one per general category, reused at every depth. */
export default function SettingsCategoryIcon({ category }: { category: SettingsCategory }) {
  const icon = CATEGORY_ICONS[category];
  return <img className="settings-surface__image settings-surface__category-icon"
    data-settings-category-icon={category} src={icon.src} alt={`Icono de ${icon.label}`}
    width={256} height={256} draggable={false} />;
}
