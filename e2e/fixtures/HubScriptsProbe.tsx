import { createRoot } from "react-dom/client";
import AddonsPage from "../../src/pages/Addons/index.tsx";
import BigPictureAddons from "../../src/pages/BigPicture/BigPictureAddons.tsx";
import { refreshBundledAddonDirectory, useAddonStore } from "../../src/store/addonStore.ts";
import { scrapeProviderRuntimes } from "../../src/services/providerRuntimeService.ts";
import { getStreamAddonLogo } from "../../src/utils/sourceLogos.ts";
import "../../src/index.css";
import "../../src/pages/BigPicture/BigPictureSettings.css";

function container() {
  const node = document.createElement("div");
  document.body.replaceChildren(node);
  return node;
}

export async function mountHubScripts(kind: "desktop" | "big-picture") {
  await refreshBundledAddonDirectory();
  createRoot(container()).render(kind === "big-picture" ? <BigPictureAddons /> : <AddonsPage />);
}

export async function runHubScript(id: string) {
  // Only the native HTTP bridge is replaced. Script fetching, dependency loading,
  // the actual web worker, argument passing and stream normalization are real.
  (window as any).__TAURI_INTERNALS__ = {
    async invoke(command: string, args: any) {
      if (command !== "provider_http_request") throw new Error(`Unexpected native command: ${command}`);
      const request = args.request;
      const response = await fetch(request.url, { method: request.method ?? "GET", headers: request.headers, body: request.body });
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return { status: response.status, statusText: response.statusText, url: response.url,
        headers: Object.fromEntries(response.headers), bodyBase64: btoa(binary) };
    },
  };
  const streams = await scrapeProviderRuntimes({ type: "series", id: "tmdb:123", season: 1, episode: 3 }, "Sample", [`aetherio-hub:${id}`]);
  createRoot(container()).render(<section aria-label="Real script results">
    <output data-testid="real-script-results">{JSON.stringify(streams)}</output>
    {streams.map(stream => <div key={stream.id}><img src={getStreamAddonLogo(stream) ?? undefined} alt={`Logo de ${stream.sourceName}`} width={48} height={48} />{stream.sourceName}</div>)}
  </section>);
  return streams;
}

export { useAddonStore };
