/**
 * Página de invitación a salas Party: /join/ABC123[?server=...].
 *
 * La abre quien recibe el link (Discord, mensajes): muestra el código, intenta
 * abrir la app con el deep link aetherio://party/join y ofrece copiar el
 * código o descargar la app si no la tiene.
 */

const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;

export function parseJoinPath(pathname: string): string | null {
  const match = pathname.match(/^\/join\/([A-Za-z0-9]{6})\/?$/);
  if (!match) return null;
  const code = match[1].toUpperCase();
  return ROOM_CODE_RE.test(code) ? code : null;
}

/** Solo https (misma política que la app al aceptar el servidor del link). */
export function sanitizeJoinServer(raw: string | null): string {
  if (!raw) return "";
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return "";
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return "";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildPartyJoinDeepLink(code: string, server: string): string {
  const params = new URLSearchParams({ code });
  if (server) params.set("server", server);
  return `aetherio://party/join?${params.toString()}`;
}

export function buildPartyJoinPage(code: string, server: string): string {
  const deepLink = buildPartyJoinDeepLink(code, server);
  const safeCode = escapeHtml(code);
  const safeDeepLink = escapeHtml(deepLink);
  // JSON para el contexto JS (comillas y < escapados por construcción).
  const jsDeepLink = JSON.stringify(deepLink);
  return (
    "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    `<title>Unirse a la sala ${safeCode} · Aetherio Party</title>` +
    "<style>" +
    ":root{font:100%/1.5 -apple-system,BlinkMacSystemFont,\"SF Pro Text\",system-ui,\"Segoe UI\",Roboto,sans-serif;}" +
    "body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f5f5f7;" +
    "background-image:radial-gradient(60% 45% at 50% 0%,rgba(120,140,255,.14),transparent 70%)," +
    "radial-gradient(45% 35% at 85% 90%,rgba(90,200,250,.10),transparent 70%)," +
    "radial-gradient(40% 30% at 10% 85%,rgba(191,90,242,.08),transparent 70%)}" +
    ".card{width:min(420px,calc(100vw - 48px));text-align:center;border-radius:28px;padding:40px 32px 32px;" +
    "background:rgba(28,28,30,.72);-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);" +
    "border:1px solid rgba(255,255,255,.14);border-top-color:rgba(255,255,255,.28);" +
    "box-shadow:0 30px 80px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.12)}" +
    ".eyebrow{margin:0;font-size:12px;font-weight:700;letter-spacing:.22em;color:rgba(235,235,245,.6)}" +
    ".code{margin:14px 0 6px;font-size:clamp(2.6rem,9vw,3.6rem);font-weight:800;line-height:1.05;letter-spacing:-0.02em;" +
    "font-optical-sizing:auto;font-variant-numeric:tabular-nums}" +
    ".hint{margin:0 0 26px;font-size:15px;line-height:1.55;color:rgba(235,235,245,.72)}" +
    ".btn{display:block;width:100%;box-sizing:border-box;margin:10px 0;padding:15px;border-radius:999px;" +
    "font:inherit;font-weight:700;font-size:16px;letter-spacing:-0.01em;text-decoration:none;cursor:pointer;" +
    "transition:transform 100ms ease-out,background-color 160ms ease,opacity 160ms ease}" +
    ".btn:active{transform:scale(.97)}" +
    ".btn.primary{background:#f5f5f7;color:#000;border:none}" +
    ".btn.primary:hover{background:#fff}" +
    ".btn.ghost{background:rgba(255,255,255,.09);color:#f5f5f7;border:1px solid rgba(255,255,255,.14)}" +
    ".btn.ghost:hover{background:rgba(255,255,255,.14)}" +
    ".dim{display:inline-block;margin-top:18px;color:rgba(235,235,245,.55);font-size:13px}" +
    ".enter{animation:rise .5s cubic-bezier(.32,.72,0,1) both}" +
    ".enter.d1{animation-delay:.06s}.enter.d2{animation-delay:.14s}.enter.d3{animation-delay:.22s}" +
    "@keyframes rise{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}" +
    "@media (prefers-reduced-motion:reduce){.enter{animation:none}.btn{transition:none}.btn:active{transform:none}}" +
    "@media (prefers-contrast:more){.card{background:#161617;border-color:rgba(255,255,255,.4)}.hint{color:#e6e6eb}}" +
    "</style></head><body><main class=\"card\">" +
    "<p class=\"eyebrow enter\">AETHERIO PARTY</p>" +
    `<p class=\"code enter d1\">${safeCode}</p>` +
    "<p class=\"hint enter d2\">Te invitaron a ver algo juntos. Abre la app para entrar directo a la sala.</p>" +
    `<a class=\"btn primary enter d3\" href=\"${safeDeepLink}\">Abrir en Aetherio</a>` +
    `<button class=\"btn ghost enter d3\" id=\"copy\" type=\"button\">Copiar código</button>` +
    "<a class=\"dim\" href=\"/download/windows\">Descargar Aetherio para Windows</a>" +
    "<script>" +
    `var deepLink=${jsDeepLink};var code=${JSON.stringify(code)};` +
    "try{var t=setTimeout(function(){window.location.replace(deepLink)},900);}catch(e){}" +
    "document.getElementById('copy').addEventListener('click',function(){" +
    "clearTimeout(t);if(navigator.clipboard){navigator.clipboard.writeText(code).catch(function(){});}" +
    "this.textContent='¡Código copiado!';});" +
    "</script></main></body></html>"
  );
}

export function partyJoinPageResponse(code: string, server: string): Response {
  return new Response(buildPartyJoinPage(code, server), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
