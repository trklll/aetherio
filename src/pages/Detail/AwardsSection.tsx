// Sección "Premios y festivales" del Detail: agrupa los registros del catálogo
// por ceremonia/edición, con filtros por estado y avisos de cobertura parcial.

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { openExternalUrl } from "../../runtime/platform";
import {
  ceremonyName,
  STATUS_LABELS,
  type AwardRecord,
  type AwardResolutionStatus,
  type AwardStatus,
  type AwardEmptyReason,
  type CoverageSummary,
  type AwardCeremony,
} from "../../hooks/useAwards";
import { AwardLogo } from "../../components/awards/AwardLogo";

const INITIAL_VISIBLE = 6;

/** Mensaje por razón del vacío (espejo de emptyReason en el worker). */
const EMPTY_REASON_MESSAGES: Record<AwardEmptyReason, string> = {
  edition_not_imported: "El archivo histórico de esta edición aún no se ha sincronizado; volverá a aparecer tras el backfill.",
  identity_unresolved: "No pudimos identificar esta obra en el catálogo de premiaciones.",
  identity_ambiguous: "Hay varias obras con este mismo nombre en el catálogo; no vinculamos premiaciones para evitar errores.",
  no_matching_records: "No hay premiaciones registradas para esta obra.",
  sync_failed: "La sincronización de premiaciones falló; lo reintentaremos más tarde.",
};

type Filter = "all" | AwardStatus;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "winner", label: "Ganadoras" },
  { key: "nominee", label: "Nominadas" },
  { key: "official_selection", label: "Selección oficial" },
];

const STATUS_CHIP_STYLE: Record<AwardStatus, { background: string; color: string }> = {
  winner: { background: "rgba(245,197,24,0.14)", color: "#f5c518" },
  nominee: { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.75)" },
  official_selection: { background: "rgba(124,200,255,0.12)", color: "#7cc8ff" },
};

interface CeremonyGroup {
  ceremony: AwardCeremony;
  edition: number | null;
  awardYear: number;
  sourceUrl: string;
  records: AwardRecord[];
}

function groupRecords(records: AwardRecord[]): CeremonyGroup[] {
  const groups: CeremonyGroup[] = [];
  for (const record of records) {
    const last = groups[groups.length - 1];
    if (last && last.ceremony === record.ceremony && last.edition === record.edition) {
      last.records.push(record);
      continue;
    }
    groups.push({
      ceremony: record.ceremony,
      edition: record.edition,
      awardYear: record.awardYear,
      sourceUrl: record.sourceUrl,
      records: [record],
    });
  }
  return groups;
}

export function AwardsSection({
  records,
  coverage,
  isLoading = false,
  isError = false,
  errorMessage = null,
  resolutionStatus = null,
  reason = null,
  onRetry,
}: {
  records: AwardRecord[];
  coverage: Record<AwardCeremony, CoverageSummary> | null;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string | null;
  resolutionStatus?: AwardResolutionStatus | null;
  reason?: AwardEmptyReason | null;
  onRetry?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState(false);

  const groups = useMemo(() => {
    const filtered = filter === "all" ? records : records.filter(record => record.status === filter);
    return groupRecords(filtered);
  }, [records, filter]);

  const totalVisible = groups.reduce((sum, group) => sum + group.records.length, 0);
  const showExpand = records.length > INITIAL_VISIBLE;
  const visibleCount = expanded ? totalVisible : Math.min(totalVisible, INITIAL_VISIBLE);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: records.length, winner: 0, nominee: 0, official_selection: 0 };
    for (const record of records) result[record.status] += 1;
    return result;
  }, [records]);

  if (isLoading) {
    return (
      <section>
        <h2 style={{ fontSize: 19, fontWeight: 750, color: "#fff", lineHeight: 1.1, marginBottom: 12 }}>Premios y festivales</h2>
        <p style={{ margin: 0, color: "rgba(255,255,255,0.55)", fontSize: 13 }}>Consultando premiaciones…</p>
      </section>
    );
  }

  if (isError) {
    return (
      <section>
        <h2 style={{ fontSize: 19, fontWeight: 750, color: "#fff", lineHeight: 1.1, marginBottom: 12 }}>Premios y festivales</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <p style={{ margin: 0, color: "rgba(255,255,255,0.55)", fontSize: 13 }}>{errorMessage ?? "No se pudieron cargar las premiaciones."}</p>
          {onRetry && <button type="button" onClick={onRetry} style={{ border: "1px solid rgba(255,255,255,0.18)", borderRadius: 999, padding: "6px 12px", color: "#fff", background: "rgba(255,255,255,0.08)", cursor: "pointer", fontSize: 12, fontWeight: 650 }}>Reintentar</button>}
        </div>
      </section>
    );
  }

  if (records.length === 0) {
    const message = reason
      ? EMPTY_REASON_MESSAGES[reason]
      : resolutionStatus === "resolved"
        ? "No hay premiaciones registradas para esta obra."
        : "Las premiaciones aún no se han sincronizado para esta obra.";
    return (
      <section>
        <h2 style={{ fontSize: 19, fontWeight: 750, color: "#fff", lineHeight: 1.1, marginBottom: 12 }}>Premios y festivales</h2>
        <p style={{ margin: 0, color: "rgba(255,255,255,0.55)", fontSize: 13 }}>{message}</p>
      </section>
    );
  }

  let shown = 0;

  return (
    <section>
      <h2 style={{ fontSize: 19, fontWeight: 750, color: "#fff", lineHeight: 1.1, marginBottom: 16 }}>
        Premios y festivales
      </h2>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {FILTERS.map(item => {
          const active = filter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => { setFilter(item.key); setExpanded(false); }}
              style={{
                border: "none",
                borderRadius: 999,
                padding: "6px 14px",
                fontSize: 12.5,
                fontWeight: 650,
                cursor: "pointer",
                background: active ? "#fff" : "rgba(255,255,255,0.08)",
                color: active ? "#000" : "rgba(255,255,255,0.72)",
                transition: "background 0.18s ease, color 0.18s ease",
              }}
            >
              {item.label} · {counts[item.key]}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {groups.map(group => {
          const groupVisible = Math.max(0, Math.min(group.records.length, visibleCount - shown));
          shown += groupVisible;
          if (groupVisible === 0) return null;
          const summary = coverage?.[group.ceremony] ?? null;
          const partialEdition = summary?.partialEditions.includes(group.edition ?? -1) ?? false;
          const staleEdition = summary?.staleEditions.includes(group.edition ?? -1) ?? false;
          const failedEdition = summary?.failedEditions.includes(group.edition ?? -1) ?? false;
          return (
            <div key={`${group.ceremony}-${group.edition ?? ""}`}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <AwardLogo ceremony={group.ceremony} height={24} maxWidth={90} />
                <span style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{ceremonyName(group.ceremony)}</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontWeight: 500 }}>
                  {group.edition ? `Edición ${group.edition} · ` : ""}{group.awardYear}
                </span>
                {(partialEdition || staleEdition || failedEdition) && (
                  <span style={{ fontSize: 10.5, fontWeight: 650, color: "rgba(255,255,255,0.6)", background: "rgba(255,255,255,0.08)", borderRadius: 999, padding: "2px 8px" }}>
                    Archivo parcial
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void openExternalUrl(group.sourceUrl)}
                  title="Ver fuente"
                  style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, border: "none", background: "none", color: "rgba(255,255,255,0.5)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "4px 6px", borderRadius: 8 }}
                >
                  <ExternalLink size={13} />
                  Fuente
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {group.records.slice(0, groupVisible).map(record => {
                  const chip = STATUS_CHIP_STYLE[record.status];
                  return (
                    <div
                      key={record.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 12px",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.07)",
                      }}
                    >
                      <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap", background: chip.background, color: chip.color }}>
                        {STATUS_LABELS[record.status]}
                      </span>
                      {record.sourceTier === "secondary" && (
                        <span title="Fuente secundaria (Wikipedia)" style={{ fontSize: 9.5, fontWeight: 650, borderRadius: 999, padding: "2px 7px", whiteSpace: "nowrap", color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}>
                          Secundaria
                        </span>
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 650, color: "rgba(255,255,255,0.92)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {record.categoryEs || record.categoryOriginal}
                        </div>
                        {record.recipients.length > 0 && (
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {record.recipients.join(", ")}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void openExternalUrl(record.sourceUrl)}
                        title="Ver en la fuente"
                        style={{ marginLeft: "auto", border: "none", background: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", padding: 4, display: "flex", flexShrink: 0 }}
                      >
                        <ExternalLink size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {showExpand && visibleCount < totalVisible && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{ marginTop: 16, border: "1px solid rgba(255,255,255,0.14)", borderRadius: 999, padding: "8px 18px", fontSize: 13, fontWeight: 650, color: "#fff", background: "rgba(255,255,255,0.06)", cursor: "pointer" }}
        >
          Ver todos ({totalVisible})
        </button>
      )}
      {expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{ marginTop: 16, border: "none", borderRadius: 999, padding: "8px 18px", fontSize: 13, fontWeight: 650, color: "rgba(255,255,255,0.7)", background: "none", cursor: "pointer" }}
        >
          Ver menos
        </button>
      )}
    </section>
  );
}
