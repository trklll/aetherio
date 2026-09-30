# TAREA PARA ANTIGRAVITY (ejecutar vía CLI)

## Objetivo

Adaptar el diseño de UI de la página **Search** de la app de **Aetherio TV** al modo **Big Picture** (modo inmersivo/TV) de la app de **Aetherio desktop**.

La page es la de **search**. Hoy el Big Picture solo renderiza el Home maximizado; al pulsar "Buscar" en el rail se navega a `/search`, que sale del modo inmersivo (porque `App.tsx` solo captura rutas que empiezan por `/big-picture`). Hay que crear una versión TV-native del search dentro del chrome de Big Picture, reutilizando el lenguaje visual del rail/backdrop/cards (`bp-*`), y que funcione con navegación espacial (mando).

---

## Contexto del repo

- Repo: `C:\Users\Administrator\Documents\Projects\aetherio` (React + Vite + Tauri 2, TS).
- La app de Android TV comparte el MISMO codebase React; se distingue por `html.aetherio-android-tv` y por navegación espacial. NO existe una app separada de TV.
- El modo Big Picture es la versión desktop inmersiva (Steam-like) del mismo lenguaje TV.
- Git actual: rama con working tree sucio (muchos archivos modificados, `src/pages/BigPicture/` y `src/navigation/` sin trackear). **NO commitear nada** salvo que se pida explícitamente.

### Archivos clave (rutas relativas a la raíz)

| Archivo | Rol |
|---|---|
| `src/App.tsx` | Router. `isBigPicture = location.pathname.startsWith("/big-picture")` (línea ~423); si es true renderiza `` dentro de `PartyProvider` + `GamepadWakeListener`. |
| `src/pages/BigPicture/index.tsx` | Shell de Big Picture: backdrop, rail, scroll inercial, modal Party, confirm de salida, y renderiza `}/>` dentro de `.big-picture__scroll`. |
| `src/pages/BigPicture/BigPictureRail.tsx` | Rail/pill izquierdo (port de `TvPagePill.kt`). Items: `search -> /search`, `home -> /big-picture`, `party` (acción), `settings -> /settings`, `addons -> /addons`. |
| `src/pages/BigPicture/BigPictureRail.css` | Tokens del rail (276px, item 60px, etc.). |
| `src/pages/BigPicture/BigPicture.css` | Piel TV Native: `.big-picture`, `.big-picture__scroll`, `.bp-row`, `.bp-row__title`, `.bp-row__track`, `.bp-card`, `.bp-card__media`, `.bp-card__meta`, `.bp-card__name`, `.bp-card__sub`, `.bp-card__badge`, etc. |
| `src/pages/BigPicture/BigPictureHero.tsx` | Hero del Home. |
| `src/pages/BigPicture/BigPictureBackdrop.tsx` | Fondo ambient/video. |
| `src/pages/Search/index.tsx` | Search actual (desktop): header "Resultados para…", `TopResultCard` x3, filas "Películas"/"Programas de TV" con `PosterResultCard`, `usePosterWithFallback`, `useMediaSearch`. |
| `src/pages/Search/SearchResultGroup.tsx` | Subcomponentes de resultados. |
| `src/hooks/useMediaSearch.ts` | Hook de búsqueda (results, loading, correction, response). |
| `src/utils/searchProviders.ts` | `UnifiedSearchResult`, `normalizeMediaType`, providers. |
| `src/utils/mediaMetadata.ts` | `writeDetailMediaMeta`. |
| `src/store/homeScrollStore.ts` | `saveHomeScroll`, `rowKey`. |
| `src/navigation/spatialNav.ts` | Motor espacial. Reconoce `[data-row-key]`, `[data-item-index]`, `[data-row-count]`, `[data-row-header]`. Usa `isBigPictureMode()` / `.aetherio-android-tv`. |
| `src/hooks/useLongPressAction.ts` | Long-press para opciones (mando). |
| `src/pages/Home/CatalogRow.tsx` | Referencia de cómo se marcan las rows/cards para el motor espacial. |

---

## Diseño a copiar (TV native)

La Search de Big Picture debe verse como el resto del modo picture, NO como la Search desktop:

- Fondo `#050607` (o el ambient del backdrop), dentro de `.big-picture__scroll` para conservar scroll inercial.
- Sin chrome de AppShell (sin TopNav/Sidebar/WindowControls). El rail se mantiene.
- Barra de búsqueda grande tipo pill TV (input grande, focus ring `3px #f8f8f9`), reutilizando el material liquid glass (`getContextGlassStyle` en `src/components/ui/glassSurface.ts`).
- Resultados en filas horizontales (`bp-row` / `bp-row__track`) con cards `bp-card` (186x286 colapsadas, scale 1.045 + ring en `:focus-visible`).
- La fila "Top resultados" puede ser una fila de cards horizontales más anchas o una grilla de 3, pero con el lenguaje `bp-card` (no el layout desktop).
- Secciones: "Top resultados", "Películas", "Programas de TV" (mismas que la Search desktop).
- Reusar la lógica de datos de la Search desktop: `useMediaSearch({ query, mode: "full", addons, limit, allowCorrection })`, `writeDetailMediaMeta`, y el fallback de póster BetterPosters (`usePosterWithFallback` / `resolveBetterPosterSync`).
- Navegación espacial: cada fila con `data-row-key` y `data-row-count`; cada card con `data-item-index`; headers con `data-row-header` si aplica. Ver `src/pages/Home/CatalogRow.tsx` y `src/navigation/spatialNav.ts` para el contrato exacto.
- Al abrir un resultado, preservar el comportamiento desktop: `writeDetailMediaMeta(item)` y navegar a `/detail//?fromSearch=1&q=`.

---

## Cambios requeridos

1. **Crear `src/pages/BigPicture/BigPictureSearch.tsx`**
   - Componente TV-native de search para Big Picture.
   - Input pill grande con estado local (debounce) + lectura/escritura del query en la URL (`/big-picture/search?q=...`) vía `useSearchParams`.
   - Usa `useMediaSearch` para `mode: "full"`.
   - Renderiza `bp-row`/`bp-card` con soporte de navegación espacial y long-press (`useLongPressAction`) si procede.
   - Maneja loading (skeleton TV-native), corrección fuzzy (con botón "Buscar literalmente") y estado vacío.

2. **Añadir CSS a `src/pages/BigPicture/BigPicture.css`**
   - Clases nuevas bajo el prefijo `bp-search` (p.ej. `.bp-search`, `.bp-search__bar`, `.bp-search__input`, `.bp-search__skeleton`, `.bp-search__empty`), coherentes con los tokens existentes (colores `#050607`, `#0b0c0e`, `#f8f8f9`, `#a3a7ae`; radios 18/22; focus ring 3px).

3. **Enrutar en `src/pages/BigPicture/index.tsx`**
   - Detectar la sub-ruta (`useLocation`): `/big-picture` → Home; `/big-picture/search` → `` (dentro del mismo `.big-picture__scroll`).
   - Mantener backdrop, rail, modal Party y confirm de salida.
   - Para search probablemente NO se quiera el `BigPictureBackdrop` con hero rotando (o sí, atenuado); decidir y documentar. Recomendado: backdrop atenuado fijo.

4. **Ajustar `src/pages/BigPicture/BigPictureRail.tsx`**
   - Cambiar el item `search` de `route: "/search"` a `route: "/big-picture/search"` para no salir del modo inmersivo.

5. **(Verificar) `src/App.tsx`**
   - `isBigPicture` ya usa `startsWith("/big-picture")`, así que `/big-picture/search` entra en `BigPicturePage` sin cambios. Confirmar.

---

## Restricciones / convenciones

- TypeScript estricto. Imports relativos con extensión `.ts`/`.tsx` cuando el archivo lo haga (mirar vecinos).
- **NO añadir comentarios** al código salvo que ya exista ese estilo en el archivo (el repo usa JSDoc en español en algunos módulos; respetar).
- Usar los hooks/utilidades existentes; no introducir librerías nuevas.
- No tocar `package.json` ni dependencias.
- No commitear.

## Verificación obligatoria

Ejecutar y dejar en verde:

```
npm run typecheck
npm run lint
npm run build
```

(Si algún script no existe, mirar `package.json` y usar el equivalente. No inventar.)

## Criterios de aceptación

- Entrar a Big Picture y pulsar "Buscar" en el rail permanece en el modo inmersivo (URL `/big-picture/search`) y muestra la Search TV-native.
- La Search de Big Picture replica el lenguaje `bp-*` (rail visible, cards con scale+ring al foco, tipografía/colores TV).
- Los resultados abren el detalle correctamente (`/detail/...?fromSearch=1&q=...`).
- Navegación con teclado/flechas y mando funciona (focus visible, filas navegables).
- `typecheck`, `lint` y `build` pasan.

## Entregable

- Diff de los archivos tocados + salida de `typecheck`/`lint`/`build`.
- Si algo del diseño queda ambiguo, elegir la opción más coherente con `BigPicture.css`/`BigPictureRail.css` y anotarlo brevemente en la respuesta (no en el código).