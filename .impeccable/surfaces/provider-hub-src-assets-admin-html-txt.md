---
version: 1
slug: "provider-hub-src-assets-admin-html-txt"
primary_target: "provider-hub/src/assets/admin.html.txt"
related_targets: ["provider-hub/src/assets/admin.css.txt","provider-hub/src/assets/admin.js.txt"]
---

## Scope and visitor mode
Provider Hub administrator at `/admin`. Operate: maintain, search, configure, validate, test, and remove streaming providers safely.

### Stremio extension (2026-11-02)
The user approved a unified list: Stremio add-ons appear first alongside script providers, with All / Stremio / Scripts filters. Preserve the incumbent CSS and catalog + inspector layout. Add manifest, logo, defaults and integration settings for Stremio; keep the compiled-script inspector unchanged. On 2026-11-02, the user asked to separate AnimeAV1 from AnimES and chose a separate informational row in the Hub only. This row is not a second public addon, toggle, or installation: the official upstream has one combined AnimES manifest and the Hub must not claim otherwise. NyaaSi remains integrated within Torrentio. Highfly personal URLs stay local; PenguPlay retains its authenticated proxy. Default-enabled is not a global health check or an override of existing personal preferences.

## Audience and task
User clarification after the first extension: AnimeAV1 must also be separate inside Aetherio with its official identity/artwork. The earlier informational-only choice is superseded. Publish a filtered logical source (`aetherio.source.animeav1`) with its own Hub-served official logo and controls; keep AnimES for the complementary results. Clearly describe their shared real upstream rather than inventing a separate official Stremio service. This is data/behavior work inside existing layouts, not a redesign.

An Aetherio operator works in a desktop browser, sometimes on a narrow screen. They need to understand Hub health, find a provider, make a change, and know whether it is saved or deployed. Preserve token-only access, session-only token handling, all existing API behavior, fields, status distinctions, and mobile responsiveness. Do not invent capabilities or change factual copy.

## Direction contract
THESIS: Treat the directory as the operator's stage: one unmistakable selection, one contextual inspector, no dashboard clutter. Refuse the generic pile of metrics and tiny controls.
OWN-WORLD: Aetherio's deep blue-green and mint remain the identity. Use calm near-black planes, legible system typography, restrained mint for active/healthy states, warm red only for destructive/error states, and generous spacing. No decorative glass, gradients, or excessive microtype.
STORY: First establish secure access; then show Hub health and directory scope, make search/filter immediate, and keep the selected provider's editable details and test actions together. Distinguish healthy, paused, saving, failed, and deployed states in words and visuals.
FIRST VIEWPORT: After login, a quiet top bar carries Provider Hub, connection state, refresh and sign out. A large “Directorio de proveedores” heading and primary “Nueva fuente” action lead. Compact summary metrics sit above a wide searchable provider list. Selecting a provider opens a persistent right inspector; on small screens it becomes a full-width section below the list.
FORM: User-locked catalog + inspector composition, chosen from the user's options. Seed key 49383988; user direction overrides the roll's default. Apple TV is a usability influence only: unmistakable focus, clear hierarchy, spacious targets, and purposeful transitions; this remains an admin tool, not a tvOS clone.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved decisions
None. Keep the existing API and form behavior unchanged.
