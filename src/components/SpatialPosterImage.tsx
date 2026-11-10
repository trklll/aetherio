import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ImgHTMLAttributes } from "react";
import { isSpatialPosterUrl, spatialPosterSignature, useSpatialPosterSettings } from "../config/spatialPosters";
import { getReadyPosterArtwork, markPosterMissingOnDisk, posterArtworkKey, preloadPosterArtwork } from "../services/posterArtworkCache";
import { useNearViewport } from "../hooks/useNearViewport";

type SpatialPosterImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src?: string };

const SpatialPosterImage = forwardRef<HTMLImageElement, SpatialPosterImageProps>(function SpatialPosterImage(
  { src, alt, onLoad, onError, ...props }, ref,
) {
  const settings = useSpatialPosterSettings();
  const signature = spatialPosterSignature(settings);
  const key = src ? posterArtworkKey(src, settings, signature) : "";
  const [loaded, setLoaded] = useState<{ key: string; url: string | undefined } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const nearViewport = useNearViewport(imageRef, props.loading === "lazy");
  const spatial = isSpatialPosterUrl(src);
  // Ordinary images need no offscreen verification: it bypasses loading="lazy"
  // and makes every backdrop/fallback compete with the visible posters.
  const displaySrc = !nearViewport ? undefined : !spatial ? src
    : loaded?.key === key ? loaded.url : src ? getReadyPosterArtwork(src, settings, signature) : undefined;

  useEffect(() => {
    if (!nearViewport || !spatial || !src || getReadyPosterArtwork(src, settings, signature)) return;
    let active = true;
    void preloadPosterArtwork(src, settings, signature).then(url => {
      if (active) setLoaded({ key, url: url ?? src });
    });
    return () => { active = false; };
  }, [key, src, settings, signature, nearViewport, spatial]);

  useImperativeHandle(ref, () => imageRef.current as HTMLImageElement, [displaySrc]);

  // Si el registro persistido dijo "listo" pero la imagen no carga, el archivo no
  // esta en el cache del proxy (se evicto, o la cache se borro a mano). Se marca
  // como ausente para que el proximo arranque lo re-renderice de verdad en vez de
  // volver a confiar en un veredicto viejo.
  const handleError: ImgHTMLAttributes<HTMLImageElement>["onError"] = event => {
    if (spatial && displaySrc) markPosterMissingOnDisk(displaySrc);
    onError?.(event);
  };

  return <img {...props} ref={imageRef} src={displaySrc} alt={alt} onLoad={onLoad} onError={handleError} />;
});

export default SpatialPosterImage;
