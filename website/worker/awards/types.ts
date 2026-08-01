// Tipos públicos del catálogo de premiaciones de Aetherio.

export type AwardCeremony =
  | "oscar"
  | "bafta"
  | "golden_globes"
  | "emmy"
  | "goya"
  | "japan_academy"
  | "crunchyroll"
  | "cannes"
  | "venice"
  | "mar_del_plata";

export type AwardStatus = "winner" | "nominee" | "official_selection";
export type AwardSubject = "work" | "person" | "episode" | "song" | "technical";
export type AwardCoverage = "complete" | "partial";
export type EditionStatus = "ok" | "stale" | "parser_failed";
export type SourceTier = "official" | "secondary";
export type MediaType = "movie" | "tv" | "anime";

export interface AwardRecord {
  id: string;
  ceremony: AwardCeremony;
  edition: number | null;
  awardYear: number;
  categoryEs: string;
  categoryOriginal: string;
  status: AwardStatus;
  subject: AwardSubject;
  recipients: string[];
  workTitle: string;
  workYear?: number;
  sourceUrl: string;
  sourceTier: SourceTier;
  /** Identidad de la obra asociada, disponible cuando existe un enlace resuelto. */
  mediaType?: MediaType;
  tmdbId?: number;
  imdbId?: string;
  anilistId?: number;
}

export interface CeremonyMeta {
  nameEs: string;
  nameOriginal: string;
  /** Orden estable para el destacado del hero (menor = más prioritario). */
  featuredOrder: number;
  /** Tipos de medio que premia principalmente. */
  mediaKinds: MediaType[];
  /** Años sin archivo oficial disponible se marcan como cobertura parcial. */
  partialArchiveEditions?: number[];
}

export interface EditionCoverage {
  ceremony: AwardCeremony;
  edition: number;
  awardYear: number;
  coverage: AwardCoverage;
  status: EditionStatus;
  sourceUrl: string;
  fetchedAt: string;
  checksum: string;
  recordCount: number;
}

export interface CoverageSummary {
  ceremony: AwardCeremony;
  /** Ediciones esperadas según el manifest (complete + partial). */
  expectedEditions: number[];
  /** Esperadas sin importar todavía. */
  pendingEditions: number[];
  /** Huecos explícitos: canceladas, sin archivo o bloqueadas. */
  gapEditions: Array<{ edition: number; type: "canceled" | "no_archive" | "blocked" }>;
  completeEditions: number[];
  partialEditions: number[];
  staleEditions: number[];
  failedEditions: number[];
  lastSyncAt: string | null;
}

export interface CoverageResponse {
  byCeremony: Record<AwardCeremony, CoverageSummary>;
  generatedAt: string;
}

/** Razón por la que una obra no devuelve registros de premiaciones. */
export type AwardEmptyReason =
  | "edition_not_imported"
  | "identity_unresolved"
  | "identity_ambiguous"
  | "no_matching_records"
  | "sync_failed";

export interface AwardMediaResponse {
  mediaType?: MediaType;
  tmdbId?: number | null;
  imdbId?: string | null;
  anilistId?: number | null;
  records: AwardRecord[];
  featured: AwardRecord | null;
  /** Null cuando hay registros; la razón del vacío en caso contrario. */
  reason?: AwardEmptyReason | null;
  resolution: {
    status: "resolved" | "pending" | "ambiguous" | "unresolved";
    workKey: string | null;
    matchedTitle?: string | null;
    matchedYear?: number | null;
  };
  /** Identidad coincidente con la obra consultada (qué se vinculó y contra qué). */
  matched: {
    workKey: string;
    workTitle: string;
    workYear: number | null;
    matchedTitle: string | null;
    matchedYear: number | null;
    tmdbId: number | null;
    imdbId: string | null;
    anilistId: number | null;
  } | null;
  coverage: Record<AwardCeremony, CoverageSummary>;
  /** Cobertura de las ceremonias con ediciones en los años de la obra. */
  relevantCoverage?: Record<string, CoverageSummary>;
  generatedAt: string;
}

/** Premios recibidos por una persona, filtrados desde el array de destinatarios. */
export interface AwardPersonResponse {
  personName: string;
  identity: {
    id: string | null;
    canonicalName: string | null;
    tmdbId: number | null;
    imdbId: string | null;
    wikidataId: string | null;
    anilistStaffId: number | null;
  };
  resolution: {
    status: "resolved" | "pending" | "ambiguous" | "unresolved";
    reason: string | null;
  };
  records: AwardRecord[];
  summary: { winners: number; nominees: number; ceremonies: number };
  generatedAt: string;
}

/** Resultado bruto de un parser por edición, antes de traducir/persistir. */
export interface ParsedRecord {
  categoryOriginal: string;
  categoryEs?: string;
  status: AwardStatus;
  subject: AwardSubject;
  recipients: string[];
  workTitle: string;
  workYear?: number;
  section?: string;
  sourceUrl: string;
  sourceTier?: SourceTier;
}

export interface ParsedEdition {
  ceremony: AwardCeremony;
  edition: number;
  awardYear: number;
  coverage: AwardCoverage;
  records: ParsedRecord[];
}

export interface ImportTarget {
  ceremony: AwardCeremony;
  edition: number;
}

export interface ImportRunResult {
  runId: number | null;
  scope: string;
  outcome: "success" | "partial" | "failed";
  recordsImported: number;
  recordsUpdated: number;
  editionsOk: number;
  editionsFailed: number;
  errors: string[];
  results: Array<{
    ceremony: AwardCeremony;
    edition: number;
    ok: boolean;
    skipped?: boolean;
    imported?: number;
    updated?: number;
    error?: string;
  }>;
}
