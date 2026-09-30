import { invokeCommand } from "../../../runtime/platform";
import { parseSubtitleCuesFromText, type SubtitleSyncCue } from "./parser";

// Menos de tres lineas no permiten emparejar nada: es el mismo umbral que usa
// el analisis con las referencias externas.
const MIN_REFERENCE_CUES = 3;

export interface EmbeddedReferenceInput {
  url: string | null;
  localPath: string | null;
  streamUrl: string | null;
  headers: Record<string, string> | undefined;
  language: string | null;
}

/**
 * Pide al backend la pista de subtitulos de texto embebida en el video.
 *
 * La referencia es un extra: si el archivo no la trae, el backend falla o la
 * pista es inutilizable, se devuelve una lista vacia y el llamante sigue con lo
 * que tuviera. Nunca lanza.
 */
export async function fetchEmbeddedReferenceCues(
  input: EmbeddedReferenceInput,
): Promise<SubtitleSyncCue[]> {
  const localPath = input.localPath?.trim() || null;
  const url = localPath ? null : input.url?.trim() || null;
  if (!localPath && !url) return [];

  try {
    const vtt = await invokeCommand<string | null>("embedded_subtitle_text", {
      url,
      localPath,
      language: input.language,
      streamUrl: input.streamUrl || null,
      headers: input.headers ?? null,
    });
    if (!vtt) return [];
    const cues = parseSubtitleCuesFromText(vtt, "embedded://reference")
      .filter(cue => cue.text.trim().length > 0);
    return cues.length >= MIN_REFERENCE_CUES ? cues : [];
  } catch {
    return [];
  }
}
