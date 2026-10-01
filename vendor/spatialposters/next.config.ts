import type { NextConfig } from "next";

// CSP estesa (hardening): default-src 'self' mitiga XSS, img-src copre i
// poster TMDB diretti, gli still episodi TVDB (artworks.thetvdb.com, usati
// dall'anteprima Stagioni & Episodi e da AniZip) e i blob: delle preview
// secure (useSecurePosterUrl/usePosterPreview), connect-src 'self' basta perché TUTTE le fetch client
// passano da /api/* (le chiamate a TMDB/MDBList/JustWatch/ani.zip sono
// server-side). In dev si aggiungono 'unsafe-eval' (React Refresh) e il
// websocket HMR. frame-ancestors permette l'embedding su HF Spaces.
const isDev = process.env.NODE_ENV === "development";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://image.tmdb.org https://artworks.thetvdb.com https://i.ibb.co https://*.ibb.co",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws://127.0.0.1:* ws://localhost:*" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self' https://huggingface.co https://*.huggingface.co https://*.hf.space",
].join("; ");

const nextConfig: NextConfig = {
  // `standalone` serve al self-hosting Docker (il Dockerfile copia
  // .next/standalone). Su Vercel NON va impostato: con Next 16.3+ l'output
  // standalone salta la generazione dei file di tracing serverless
  // (.nft.json) e il build fallisce con
  // "ENOENT .next/next-server.js.nft.json" — lì si usa l'output default.
  output: process.env.VERCEL ? undefined : "standalone",
  // Next infiere que estamos en un monorepo si hay un lockfile o un
  // package.json en un directorio padre, y en ese caso acota el file tracing a
  // ese padre: el standalone sale incompleto o no sale. En Aetherio el source
  // vive en `vendor/spatialposters/`, o sea dentro de dos package.json, y el
  // build del CI no generaba `.next/standalone` (compilaba bien, 36 paginas
  // estaticas, y despues el staging no encontraba el server). Fijar la raiz del
  // tracing al directorio del proyecto hace que se comporte igual sin importar
  // donde este clonado.
  outputFileTracingRoot: __dirname,
  // React Compiler: ottimizza automaticamente il re-rendering dei componenti,
  // riducendo la necessita' di useMemo/useCallback manuali.
  reactCompiler: true,
  // DistDir separato per i test E2E (playwright.config.ts): evita il lock
  // "Another next dev server is already running" quando l'utente ha già un
  // `npm run dev` attivo su .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["@resvg/resvg-js", "sharp"],
  outputFileTracingIncludes: {
    "/api/poster/**/*": ["src/assets/fonts/**/*"],
  },
  outputFileTracingExcludes: {
    "/api/poster/**/*": ["next.config.ts"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ]
  },
};

export default nextConfig;
