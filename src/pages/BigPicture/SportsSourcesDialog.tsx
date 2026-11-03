import { Radio } from "lucide-react";
import type { LiveEvent, LiveSource } from "../../types/liveSports.ts";
import SportsDialog from "./SportsDialog.tsx";
import { sortLiveSources } from "../../services/liveSportsSourceRanking.ts";

export default function SportsSourcesDialog({ event, onSelect, onClose }: { event: LiveEvent; onSelect: (source: LiveSource) => void; onClose: () => void }) {
  const sources = sortLiveSources(event.sources.filter(source => !source.validUntil || Date.parse(source.validUntil) > Date.now()));
  return <SportsDialog title="Elegir fuente" onClose={onClose}>
    <p className="sports-dialog__intro">{event.title}</p>
    <p className="sports-dialog__hint">Narraciones identificadas en español primero. A igualdad de idioma se prioriza Highfly; IPTV y los demás addons siguen disponibles como alternativas.</p>
    <div className="sports-source-options">
      {sources.map(source => <button key={source.id} type="button" className="sports-source-option" onClick={() => onSelect(source)}>
        <Radio size={20} aria-hidden="true" />
        <span><strong>{source.channelName || source.label}</strong><small>{[source.origin === "iptv" ? "IPTV" : "Addon", source.quality, source.language].filter(Boolean).join(" · ")}</small></span>
        {source.origin === "iptv" && source.validUntil && <span className="sports-source-option__match">Programación coincide</span>}
      </button>)}
    </div>
    {!sources.length && <p role="status">No hay fuentes disponibles. Actualiza la agenda y vuelve a intentarlo.</p>}
  </SportsDialog>;
}
