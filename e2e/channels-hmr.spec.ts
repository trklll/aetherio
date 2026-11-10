import { expect, test } from "@playwright/test";

test("la navegación de Canales registra su firma de hooks para Fast Refresh", async ({ request }) => {
  const pageModule = await request.get("/src/pages/Channels/index.tsx");
  expect(pageModule.ok()).toBe(true);
  const source = await pageModule.text();
  const hookUrl = source.match(/import useTVGuideNavigation from ["']([^"']+)["']/)?.[1];
  expect(hookUrl).toBeTruthy();

  const hookModule = await request.get(hookUrl!);
  expect(hookModule.ok()).toBe(true);
  // Without a signature, editing this custom hook can preserve an incompatible
  // ChannelsPage state and throw "Rendered more hooks than during the previous render".
  expect((await hookModule.text()).includes("$RefreshSig$")).toBe(true);
});
