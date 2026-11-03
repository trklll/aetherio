# Sports local

Aetherio's **Sports** screen consumes the upstream Nuvio addon as a sports data/stream source;
you do not install or open Nuvio as a separate app. Desktop Aetherio bundles the
official addon as a managed local process by default; it listens only on
`127.0.0.1:7310` (its resolver uses `127.0.0.1:7311`) and is stopped when
Aetherio exits. Sports uses the existing Aetherio player. A remote instance is
available as a fallback in settings and on web.

The default addon profile is football and MMA, `America/Lima`, with Spanish
preferred. Nuvio itself keeps English at its top language tier, so Aetherio also
moves Spanish-labelled sources ahead of other candidates before probing them.

## Prepare a licensed local checkout

Aetherio obtains the official source from
`https://github.com/rajhodedara/live-sport-plugin` at pinned revision
`50611f7157571878e70582da310bbf2a8e538ed7`. The checkout is kept under
`vendor/nuvio-live-sports` and ignored as a local build dependency; Aetherio
does not require a separate installed app.

The upstream repository declares MIT in `package.json` and README but omits a
`LICENSE` file. For the pinned official source, staging includes the standard MIT
notice in the packaged resources, attributed to the repository owner, and writes
the source revision and license provenance into the third-party notice. A custom
`NUVIO_SOURCE` fork must provide a license identifier and a non-empty
`LICENSE*` file itself.

1. Install Node.js 22 or newer. If `vendor/nuvio-live-sports` is absent, staging
   fetches the pinned source revision automatically.
2. Run `npm run nuvio:stage`. This installs dependencies if needed, builds the
   checkout, and stages its `dist`,
   production dependencies, and license under `src-tauri/resources/nuvio-live-sports`.
3. Run `npm run tauri build`. The Tauri build invokes the staging script as part
   of `beforeBuildCommand`. Set `NUVIO_SOURCE` only when you want to build from a
   different authorized checkout.

For local development, run `npm run nuvio:stage` and then `npm run tauri dev`.
The staging script only replaces its generated destination or the known empty
placeholder in this repository; any other unmarked directory is left untouched
and causes a clear error. It regenerates `dist` in the source checkout. The
staged copy installs only production dependencies from the patched lockfile;
it no longer copies development dependencies only to delete them afterward.
Promotion renames the previous managed directory first, so a locked native DLL
cannot leave the old runtime half-deleted.

## Desktop runtime profile

Staging applies `scripts/nuvio-desktop-profile.cjs` before bundling the pinned
upstream code. This is an Aetherio build adaptation, not an upstream change:

- All upstream archive providers are retained for the **Repeticiones** row,
  with lower scheduling priority than live providers. Upstream's 12-hour
  replay-cache cadence is unchanged.
- Catalog provider concurrency is capped at four. The first useful
  football/MMA schedule can populate an empty cache before the full sync ends.
- Speculative stream and whole-catalog prewarming are disabled; sources are
  still verified before being offered for playback.
- The agenda is published independently of slow stream verification. Football
  and MMA catalog requests run together; the budget is applied after sorting.
- Empty local catalogs are retried briefly only while the first sync is
  running. An empty replay row checks every five seconds while local discovery
  is running; remote, failed and legitimately empty catalogs are not polled.
- Replays load independently, in pages of 100, from the flat
  `nuvio_sports_catalog` with `genre=Replays`, `sports=all` and `replayFilter=all`.
  **Cargar más** appends pages to the virtualized row without the usual 200-card
  cap. Football/MMA and followed-team preferences do not hide other replays.
- Replay sources resolve only on activation and use the existing player as
  VOD (`type=sports-replay`, `live=false`). Request headers are preserved;
  movie/series metadata and source searches are not used. Back returns to Sports.
- Cards and the hero have a network-independent artwork fallback. Failed
  images do not leave broken image boxes or a black hero.

The staging script retains the `proxy-addr@2.0.8` override for
`GHSA-jqcg-44mw-7w3h`; this is not a claim that other dependency advisories or
upstream provider failures have been resolved.

## Startup diagnostics

Native startup errors are preserved rather than replaced with a generic
message. Process stdout/stderr go to `nuvio-live-sports/service.log` inside
Aetherio's app-data directory (`%APPDATA%/com.aetherio` on Windows). A log over
1 MiB is rotated to `service.previous.log` at the next launch. No Aetherio
credentials are passed to the addon.

Readiness probes bypass system proxies and use IPv4 loopback. In development,
the Rust manager prefers the current staged workspace resources over a stale
Cargo resource copy. Only simultaneous starts share a promise; a later refresh
checks readiness again so a crashed child can recover.

## Select the source

In Big Picture, open **Ajustes → Fuentes → Sports** and choose
**Local** or **Remota**. Desktop defaults to Local; web defaults to Remota. The
selected backend is used on the next Sports load.

Local means the addon process runs on this device, not that all discovery or
stream delivery is local: Nuvio may still contact third-party providers and
Cloudflare Workers. Only use sources you are authorized to access.
