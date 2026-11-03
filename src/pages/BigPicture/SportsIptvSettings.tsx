import { useEffect, useRef, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { getSportsIptvLists, IPTV_SPORTS_CHANGED_EVENT, MAX_IMPORTED_M3U, saveSportsIptvLists, type SportsIptvList } from "../../services/iptvSportsConfig.ts";
import { fetchIptvText, publicIptvUrl } from "../../services/iptvSportsHttp.ts";
import { parseSportsM3u } from "../../services/iptvSports.ts";
import { getIptvSportsStatus, IPTV_SPORTS_STATUS_EVENT } from "../../services/iptvSportsProvider.ts";
import SportsDialog from "./SportsDialog.tsx";

function guideUrls(text: string): string[] {
  const urls = text.split(/[,;\s]+/).filter(Boolean);
  if (urls.length > 4 || urls.some(url => !publicIptvUrl(url))) throw new Error("La guía necesita una URL HTTP o HTTPS pública. Admite hasta cuatro guías.");
  return [...new Set(urls.map(url => publicIptvUrl(url)!.href))];
}

function ListEntry({ list, onSave, onRemove }: { list: SportsIptvList; onSave: (list: SportsIptvList) => void; onRemove: () => void }) {
  const [epg, setEpg] = useState(list.epgUrls.join("\n"));
  const [error, setError] = useState("");
  return <li className="sports-iptv-list">
    <div className="sports-iptv-list__heading">
      <label className="sports-iptv-list__toggle"><input type="checkbox" checked={list.enabled} onChange={event => onSave({ ...list, enabled: event.target.checked })} aria-label={`Activar ${list.name}`} /><span><strong>{list.name}</strong><small>{list.url ? new URL(list.url).hostname : "Lista importada en este dispositivo"}</small></span></label>
      <button type="button" className="sports-dialog__close" aria-label={`Eliminar ${list.name}`} onClick={onRemove}><Trash2 size={18} /></button>
    </div>
    <details><summary>Guías de programación</summary><form onSubmit={event => { event.preventDefault(); try { onSave({ ...list, epgUrls: guideUrls(epg) }); setError(""); } catch (cause) { setError((cause as Error).message); } }}>
      <label>Guías XMLTV<textarea aria-label={`Guías XMLTV de ${list.name}`} value={epg} onChange={event => setEpg(event.target.value)} rows={2} placeholder="https://…/guide.xml.gz" /></label>
      <button className="sports-dialog__button" type="submit">Guardar guías</button>
      {error && <p className="sports-dialog__error" role="alert">{error}</p>}
    </form></details>
  </li>;
}

export default function SportsIptvSettings({ onClose }: { onClose: () => void }) {
  const [lists, setLists] = useState(getSportsIptvLists);
  const [status, setStatus] = useState(getIptvSportsStatus);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [epg, setEpg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => setLists(getSportsIptvLists());
    const refreshStatus = () => setStatus(getIptvSportsStatus());
    window.addEventListener(IPTV_SPORTS_CHANGED_EVENT, refresh);
    window.addEventListener(IPTV_SPORTS_STATUS_EVENT, refreshStatus);
    return () => { mounted.current = false; window.removeEventListener(IPTV_SPORTS_CHANGED_EVENT, refresh); window.removeEventListener(IPTV_SPORTS_STATUS_EVENT, refreshStatus); };
  }, []);

  function persist(next: SportsIptvList[]) {
    setLists(saveSportsIptvLists(next));
    setError("");
  }
  function update(next: SportsIptvList[]) {
    try { persist(next); } catch (cause) { setError((cause as Error).message); }
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    setError(""); setMessage("");
    if (lists.length >= 10) { setError("Puedes tener hasta 10 listas. Elimina una antes de añadir otra."); return; }
    if (Boolean(url.trim()) === Boolean(content.trim())) { setError("Introduce una URL o pega una lista M3U, pero no las dos cosas a la vez."); return; }
    if (content.length > MAX_IMPORTED_M3U) { setError("El contenido importado admite hasta 2 MB. Para listas mayores, usa su URL."); return; }
    if (url.trim() && !publicIptvUrl(url.trim())) { setError("Usa una URL HTTP o HTTPS pública, sin usuario ni contraseña."); return; }
    setBusy(true);
    try {
      const list: SportsIptvList = { id: crypto.randomUUID(), name: name.trim() || "Mi lista IPTV", enabled: true, epgUrls: guideUrls(epg), ...(url.trim() ? { url: publicIptvUrl(url.trim())!.href } : { content }) };
      const parsed = parseSportsM3u(list.content ?? await fetchIptvText(list.url!), list);
      if (!parsed.channels.length) throw new Error("No se encontraron canales deportivos. Revisa los nombres y grupos de la lista.");
      if (!mounted.current) return;
      persist([...getSportsIptvLists(), list]);
      setName(""); setUrl(""); setContent(""); setEpg("");
      setMessage(`${parsed.channels.length} canales deportivos importados. La fila mostrará los deportes que elegiste.`);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "No se pudo importar la lista. Revisa el archivo o la URL."); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <SportsDialog title="Listas IPTV" onClose={onClose}>
    <p className="sports-dialog__intro">Tus canales, dentro de Sports.</p>
    <p className="sports-dialog__hint">Se guardan solo en este perfil y dispositivo. Solo se muestran canales deportivos; la guía XMLTV permite saber qué encuentro emiten. Usa listas que tengas permiso para reproducir.</p>
    <p className="sports-iptv-status" role="status">{status.loading ? "Actualizando canales y programación…" : `${status.channels} canales · ${status.withGuide} con programación actual`}</p>
    {status.issues.map(issue => <p className="sports-dialog__hint" key={issue}>{issue}</p>)}
    <ul className="sports-iptv-lists">{lists.map(list => <ListEntry key={list.id} list={list} onSave={next => update(lists.map(value => value.id === next.id ? next : value))} onRemove={() => update(lists.filter(value => value.id !== list.id))} />)}</ul>
    <form className="sports-iptv-form" onSubmit={add} aria-busy={busy}>
      <h3>Añadir una lista</h3>
      <label>Nombre de la lista<input value={name} onChange={event => setName(event.target.value)} maxLength={100} placeholder="Mis deportes" /></label>
      <label>URL de la lista M3U<input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…/canales.m3u" maxLength={8192} /></label>
      <details><summary>Pegar M3U o importar un archivo</summary>
        <label>Contenido M3U<textarea value={content} onChange={event => setContent(event.target.value)} rows={4} placeholder={'#EXTM3U\n#EXTINF:-1 group-title="Fútbol",Mi canal\nhttps://…/live.m3u8'} /></label>
        <label>Archivo M3U<input type="file" accept=".m3u,.m3u8,audio/x-mpegurl,text/plain" onChange={async event => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.size > MAX_IMPORTED_M3U) { setError("El archivo admite hasta 2 MB. Para listas mayores, usa su URL."); return; }
          try {
            const text = await file.text();
            if (mounted.current) { setContent(text); setUrl(""); if (!name) setName(file.name.replace(/\.m3u8?$/i, "")); }
          } catch { if (mounted.current) setError("No se pudo leer el archivo. Prueba otro archivo o importa la lista por URL."); }
        }} /></label>
      </details>
      <label>URL de la guía XMLTV (opcional)<input type="url" value={epg} onChange={event => setEpg(event.target.value)} placeholder="https://…/guide.xml.gz" maxLength={8192} /></label>
      <p className="sports-dialog__hint">Si la lista ya incluye una guía, se detecta automáticamente. Sin guía, el canal se puede abrir, pero no se asigna a un partido.</p>
      {error && <p className="sports-dialog__error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button className="sports-dialog__button sports-dialog__button--primary" type="submit" disabled={busy}>{busy ? "Comprobando lista…" : "Añadir lista"}</button>
    </form>
  </SportsDialog>;
}
