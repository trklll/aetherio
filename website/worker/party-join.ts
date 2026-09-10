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
    "body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b0e14;color:#e6e9f0}" +
    "main{text-align:center;max-width:420px;padding:32px}" +
    ".code{font-size:44px;font-weight:900;letter-spacing:.25em;margin:12px 0 4px}" +
    ".hint{color:#9aa3b2;font-size:14px;margin:0 0 24px}" +
    "a.btn,button.btn{display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:14px;border-radius:999px;font-weight:800;font-size:15px;text-decoration:none;cursor:pointer;border:1px solid rgba(255,255,255,.14)}" +
    "a.primary{background:#fff;color:#000;border:none}" +
    "button.ghost{background:transparent;color:#e6e9f0}" +
    "a.dim{color:#9aa3b2;font-size:13px;margin-top:16px;display:inline-block}" +
    "</style></head><body><main>" +
    "<p style=\"margin:0;color:#9aa3b2;font-size:13px;font-weight:700;letter-spacing:.18em\">AETHERIO PARTY</p>" +
    `<p class=\"code\">${safeCode}</p>` +
    "<p class=\"hint\">Te invitaron a ver algo juntos. Abre la app para entrar a la sala.</p>" +
    `<a class=\"btn primary\" href=\"${safeDeepLink}\">Abrir en Aetherio</a>` +
    `<button class=\"btn ghost\" id=\"copy\">Copiar código</button>` +
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
