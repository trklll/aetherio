import { useLayoutEffect, useRef, useState } from "react";
import { gsap, prefersReducedMotion } from "../../utils/motion";
import { appendBackdropLayer, settleBackdropLayers, type BackdropLayer } from "./backdropLayers";

export default function DetailBackdrop({ background }: { background?: string }) {
  const imageRefs = useRef(new Map<number, HTMLImageElement>());
  const loadTokenRef = useRef(0);
  const initialUrl = background ?? "";
  const targetUrlRef = useRef(initialUrl);
  const [layers, setLayers] = useState<BackdropLayer[]>(() => initialUrl
    ? [{ id: 0, url: initialUrl, initialOpacity: 1 }]
    : []);

  useLayoutEffect(() => {
    const next = background ?? "";
    if (!next || targetUrlRef.current === next) return;

    const token = ++loadTokenRef.current;
    let cancelled = false;
    const commit = () => {
      if (cancelled || loadTokenRef.current !== token) return;
      targetUrlRef.current = next;
      setLayers(current => appendBackdropLayer(current, {
        id: token,
        url: next,
        initialOpacity: 0,
      }));
    };

    if (!targetUrlRef.current) {
      commit();
      return () => { cancelled = true; };
    }

    const probe = new Image();
    probe.decoding = "async";
    probe.src = next;
    if (probe.complete) {
      if (probe.naturalWidth > 0) commit();
    } else {
      probe.onload = commit;
    }
    return () => {
      cancelled = true;
      probe.onload = null;
    };
  }, [background]);

  useLayoutEffect(() => {
    const incomingLayer = layers[layers.length - 1];
    if (!incomingLayer || incomingLayer.initialOpacity === 1) return;

    const images = layers
      .map(layer => imageRefs.current.get(layer.id))
      .filter((image): image is HTMLImageElement => Boolean(image));
    const incoming = imageRefs.current.get(incomingLayer.id);
    if (!incoming) return;

    // GSAP lee la opacidad actual; al reorientar una transición no hay reset
    // de las capas que ya estaban a medio fundir.
    const outgoing = images.filter(image => image !== incoming);
    gsap.killTweensOf(images);
    const duration = prefersReducedMotion() ? 0.18 : 0.72;
    if (outgoing.length) {
      gsap.to(outgoing, {
        opacity: 0,
        duration,
        ease: "power1.inOut",
        overwrite: true,
      });
    }
    gsap.to(incoming, {
      opacity: 1,
      duration,
      ease: "power1.inOut",
      overwrite: true,
      onComplete: () => setLayers(current => settleBackdropLayers(current, incomingLayer.id)),
    });
    return () => gsap.killTweensOf(images);
  }, [layers]);

  return (
    <>
      {layers.map((layer, index) => (
        <img
          key={layer.id}
          ref={image => {
            if (image) imageRefs.current.set(layer.id, image);
            else imageRefs.current.delete(layer.id);
          }}
          src={layer.url}
          alt=""
          width="1920"
          height="1080"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center",
            opacity: layer.initialOpacity,
            zIndex: index,
            willChange: layer.initialOpacity === 0 ? "opacity" : undefined,
          }}
        />
      ))}
    </>
  );
}
