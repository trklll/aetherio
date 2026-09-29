import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ImgHTMLAttributes } from "react";
import { spatialPosterSignature, useSpatialPosterSettings } from "../config/spatialPosters";
import { getReadyPosterArtwork, posterArtworkKey, preloadPosterArtwork } from "../services/posterArtworkCache";

type SpatialPosterImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src?: string };

const SpatialPosterImage = forwardRef<HTMLImageElement, SpatialPosterImageProps>(function SpatialPosterImage(
  { src, alt, onLoad, onError, ...props }, ref,
) {
  const settings = useSpatialPosterSettings();
  const signature = spatialPosterSignature(settings);
  const key = src ? posterArtworkKey(src, settings, signature) : "";
  const [loaded, setLoaded] = useState<{ key: string; url: string | undefined } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const displaySrc = loaded?.key === key ? loaded.url : src ? getReadyPosterArtwork(src, settings, signature) : undefined;

  useEffect(() => {
    if (!src) return;
    let active = true;
    void preloadPosterArtwork(src, settings, signature).then(url => {
      if (active) setLoaded({ key, url: url ?? src });
    });
    return () => { active = false; };
  }, [key, src, settings, signature]);

  useImperativeHandle(ref, () => imageRef.current as HTMLImageElement, [displaySrc]);

  return <img {...props} ref={imageRef} src={displaySrc} alt={alt} onLoad={onLoad} onError={onError} />;
});

export default SpatialPosterImage;
