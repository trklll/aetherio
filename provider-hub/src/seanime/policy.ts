/** These rules apply only to the additional sources, not the Spanish roster. */
const HARD_SUB = /\b(?:hard[ ._-]*sub(?:bed|s)?|burn(?:ed|t)[ ._-]*in|hardsubbed)\b/i;
const FOREIGN_DUB = /\b(?:dub(?:bed|s)?|dual[ ._-]*audio|multi[ ._-]*audio|english[ ._-]*audio|german[ ._-]*audio|french[ ._-]*audio|chinese[ ._-]*audio|korean[ ._-]*audio|hindi[ ._-]*audio|tamil[ ._-]*audio|telugu[ ._-]*audio|russian[ ._-]*audio|arabic[ ._-]*audio|italian[ ._-]*audio|portuguese[ ._-]*audio)\b/i;
const RAW_OR_SOFT = /\b(?:raws?|soft[ ._-]*sub(?:bed|s)?|unsubbed|no[ ._-]*subs?)\b/i;
const KNOWN_SOFT_RELEASE = /^\s*\[(?:SubsPlease|Erai-raws|Ohys-Raws|Leopard-Raws)\]/i;

export function allowsAdditionalTorrent(torrent: Record<string, unknown>, rawCategory = false): boolean {
  const name = String(torrent.name ?? "");
  if (HARD_SUB.test(name) || torrent.hardsub === true || FOREIGN_DUB.test(name)) return false;
  const audio = String(torrent.audio_lang ?? torrent.audioLanguage ?? "").toLowerCase();
  if (audio && !/^(ja|jpn|japanese|es(?:-[a-z0-9]+)?|spa|spanish)$/.test(audio)) return false;
  return rawCategory || torrent.hardsub === false && Boolean(audio)
    || RAW_OR_SOFT.test(name) || KNOWN_SOFT_RELEASE.test(name);
}

export function allowsAdditionalVideo(source: Record<string, unknown>, server: string, trustedSoft = false): boolean {
  const label = [server, source.label, source.quality, source.subType].filter(Boolean).join(" ");
  if (HARD_SUB.test(label) || /\b(?:dub|english|hindi|tamil|telugu|german|french|portuguese|italian|korean|russian|arabic)\b/i.test(label)) return false;
  return /\b(?:soft(?:[ ._-]*sub)?|raw)\b/i.test(label)
    || trustedSoft && Array.isArray(source.subtitles) && source.subtitles.length > 0;
}
