const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

export function hubJson(status: number, payload: unknown, cacheMaxAge?: number): Response {
  const headers = { ...JSON_HEADERS };
  if (cacheMaxAge) headers["cache-control"] = `public, max-age=${cacheMaxAge}`;
  return new Response(JSON.stringify(payload), { status, headers });
}
