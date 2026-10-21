import "./ProfileBackdrop.css";

interface ProfileBackdropProps {
  /** Avatar del perfil activo: se usa como fuente del fondo borroso. */
  imageUrl?: string | null;
  /** Segunda imagen durante el crossfade (avatar que entra). */
  nextImageUrl?: string | null;
  transitioning?: boolean;
  className?: string;
}

/**
 * Fondo de perfil basado en el avatar, compartido por selección, Quick Start y AppShell.
 *
 * Es el mismo bloque que usaba Profiles —imagen del avatar con blur(70px)
 * saturate(1.3) más los degradados— extraído para que Quick Start comparta
 * exactamente el mismo fondo en vez de reinventarlo. Sin avatar (todavía no hay
 * perfil) quedan solo los degradados, que es lo que ya se veía en Profiles
 * cuando ningún perfil tiene foto.
 */
export default function ProfileBackdrop({
  imageUrl,
  nextImageUrl,
  transitioning = false,
  className,
}: ProfileBackdropProps) {
  return (
    <div className={`profile-selection-bg ${className ?? ""}`} aria-hidden="true">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className={`profile-selection-bg-img ${transitioning ? "bg-img-leave" : "bg-img-current"}`}
        />
      ) : null}
      {nextImageUrl ? (
        <img src={nextImageUrl} alt="" className={`profile-selection-bg-img bg-img-enter`} />
      ) : null}
      <div className="profile-selection-bg-tint" />
      <div className="profile-selection-bg-radial" />
      <div className="profile-selection-bg-vertical" />
      <div className="profile-selection-bg-bottom" />
    </div>
  );
}
