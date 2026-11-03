import adminHtml from "./assets/admin.html.txt";
import adminCss from "./assets/admin.css.txt";
import adminJs from "./assets/admin.js.txt";

const SECURITY_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "content-security-policy": [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' https: data:",
    "connect-src 'self'",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
};

export function adminPageResponse(pathname: string): Response | null {
  if (pathname === "/admin" || pathname === "/admin/") {
    return new Response(adminHtml, {
      status: 200,
      headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8" },
    });
  }
  if (pathname === "/admin/assets/admin.css") {
    return new Response(adminCss, {
      status: 200,
      headers: { ...SECURITY_HEADERS, "content-type": "text/css; charset=utf-8" },
    });
  }
  if (pathname === "/admin/assets/admin.js") {
    return new Response(adminJs, {
      status: 200,
      headers: { ...SECURITY_HEADERS, "content-type": "application/javascript; charset=utf-8" },
    });
  }
  return null;
}
