interface LoadingStateProps {
  label?: string;
  shellPreviewLoading?: boolean;
}

export default function LoadingState({ label = "Cargando", shellPreviewLoading = false }: LoadingStateProps) {
  return (
    <div
      data-detail-loading
      data-shell-preview-loading={shellPreviewLoading || undefined}
      aria-busy="true"
      aria-label={label}
      style={{
        display: "grid",
        placeItems: "center",
        width: "100%",
        minHeight: "100vh",
        overflow: "hidden",
        background: shellPreviewLoading ? "transparent" : "#1f1f1f",
        color: "rgba(255,255,255,0.5)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }} role="status" aria-live="polite">
        <span className="aetherio-loading-spinner" aria-hidden="true" />
      </div>
    </div>
  );
}
