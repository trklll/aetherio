import type { ReactNode, RefObject } from "react";
import DetailBackdrop from "./DetailBackdrop";

interface DetailPageFrameProps {
  background?: string;
  bigPictureEpisodeTransitioning: boolean;
  backdropImageRef: RefObject<HTMLDivElement | null>;
  metadataVignetteRef: RefObject<HTMLDivElement | null>;
  darkOverlayRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

export default function DetailPageFrame({
  background,
  bigPictureEpisodeTransitioning,
  backdropImageRef,
  metadataVignetteRef,
  darkOverlayRef,
  children,
}: DetailPageFrameProps) {
  return (
    <div
      className="detail-page-root"
      data-bp-detail-exiting={bigPictureEpisodeTransitioning ? "true" : undefined}
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        marginTop: "calc(-1 * var(--app-shell-nav-height))",
        overflow: "hidden",
        background: "transparent",
      }}
    >
      <div
        aria-hidden="true"
        data-bp-detail-background
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          overflow: "hidden",
          background: "transparent",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: "max(100vw, 177.777778vh)",
            height: "max(100vh, 56.25vw)",
            aspectRatio: "16 / 9",
            transform: "translate(-50%, -50%)",
          }}
        >
          <div
            ref={backdropImageRef}
            style={{
              position: "absolute",
              inset: 0,
              filter: "blur(0px)",
              transform: "scale(1)",
            }}
          >
            <DetailBackdrop background={background} />
          </div>
        </div>
      </div>
      <div
        ref={metadataVignetteRef}
        aria-hidden="true"
        data-bp-detail-background
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          opacity: 1,
          background: "radial-gradient(ellipse 55% 85% at center, transparent 44%, rgba(0,0,0,0.28) 68%, rgba(0,0,0,0.9) 100%)",
          pointerEvents: "none",
        }}
      />
      <div
        ref={darkOverlayRef}
        aria-hidden="true"
        data-bp-detail-background
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          opacity: 0,
          background: "rgba(0,0,0,1)",
          pointerEvents: "none",
        }}
      />
      {children}
    </div>
  );
}
