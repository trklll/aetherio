import { sportsDataJson } from "./sportsDataHttp";
import { array, object, text } from "./sportsDataValues";

export interface TeamClubFacts { wikidataId: string; source: string; founded?: string; stadium?: string; website?: string }
// Explicitly checked identities; never choose a men's/women's/e-sports team by
// the first Wikidata search result. Unknown teams simply lack enrichment.
const WIKIDATA_IDS: Record<string, string> = { "club:man-city": "Q50602", "club:man-utd": "Q18656", "club:fl-alianza-lima": "Q572957", "club:fl-atletico-grau": "Q3288724" };
function claimValue(entity: Record<string, unknown>, property: string): unknown {
  const claims = array(object(entity.claims)[property]).map(object).filter(claim => claim.rank !== "deprecated" && !object(claim.qualifiers).P582);
  const claim = claims.find(claim => claim.rank === "preferred") ?? claims[0];
  return object(object(claim?.mainsnak).datavalue).value;
}
export async function loadTeamClubFacts(entityId: string): Promise<TeamClubFacts | undefined> {
  const id = WIKIDATA_IDS[entityId]; if (!id) return undefined;
  const options = { ttlMs: 86_400_000 };
  const payload = object(await sportsDataJson(`https://www.wikidata.org/wiki/Special:EntityData/${id}.json`, options));
  const entity = object(object(payload.entities)[id]);
  if (!Object.keys(entity).length) return undefined;
  const founding = object(claimValue(entity, "P571"));
  const founded = typeof founding.precision === "number" && founding.precision >= 9 ? text(founding.time)?.match(/^\+(\d{4})-/)?.[1] : undefined;
  const website = text(claimValue(entity, "P856"));
  const facts: TeamClubFacts = { wikidataId: id, source: `https://www.wikidata.org/wiki/${id}`, founded, website: website?.startsWith("https://") ? website : undefined };
  const stadium = text(object(claimValue(entity, "P115")).id);
  if (stadium && /^Q\d+$/.test(stadium)) {
    // Missing stadium labels never discard the other available club facts.
    try {
      const labels = object(await sportsDataJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${stadium}&props=labels&languages=es%7Cen&format=json&origin=*`, options));
      const names = object(object(object(labels.entities)[stadium]).labels);
      facts.stadium = text(object(names.es).value) ?? text(object(names.en).value);
    } catch { /* Optional enrichment only. */ }
  }
  return facts;
}
