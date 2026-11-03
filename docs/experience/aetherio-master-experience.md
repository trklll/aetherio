# Plan maestro ejecutable — Aetherio: descubrir, continuar y elegir juntos

**Fecha:** 1 de noviembre de 2026. **Tipo de entrega:** planificación; no implementación.
**Base observada:** `429efda9ff20e102235875bd5bcd44aa8a786eeb` MÁS los cambios locales presentes al redactar este documento. El commit por sí solo no reproduce el árbol observado.
**Estado:** listo para ejecutar por etapas; S07 depende de recuperar el código real del backend de cuentas. No declarar completado el conjunto mientras esa dependencia siga pendiente.

## 1. Encargo cerrado

Implementar las cinco áreas solicitadas en la aplicación Windows existente, tanto escritorio como Big Picture:

1. Preferencias y continuidad entre descubrimiento, fuentes y reproducción; carga comprensible y recuperación sin empezar de cero.
2. «No me interesa», «Ya la vi» y «Menos como esto», con gestión y deshacer.
3. Estados verificables de guardado local, biblioteca, progreso, AniList, Trakt y sincronización de cuenta Aetherio.
4. Anime: relaciones entre entregas, orden de visionado verificable, información honesta de audio y protección contra spoilers.
5. Party: crear sala antes de elegir, propuestas, shortlist y votación, enlazadas al reproductor actual.

**Exclusión explícita:** no construir «Por qué te recomendamos esto», motivos, explicaciones de afinidad, encuestas de razones ni texto explicativo del algoritmo. Una confirmación de acción, un fallo de carga o un estado de sincronización NO son explicaciones de recomendación y sí se incluyen.

**Confirmaciones del usuario:** conservar diseño, proveedores y datos actuales; incluir Big Picture; fijar las reglas de este documento; no incorporar servicios de pago. No introducir una red social, recomendaciones con LLM, nuevo motor de reproducción, nueva autenticación, nuevos proveedores ni plataformas adicionales.

## 2. Instrucciones obligatorias para el modelo ejecutor

1. Ejecuta una etapa Sxx por sesión. Lee este documento, `PRODUCT.md`, el registro de ejecución y los archivos que esa etapa enumera. No implementes etapas posteriores «por si acaso».
2. El código existente manda sobre nombres o supuestos de este plan. Si una pieza equivalente existe, extiéndela. Si cambia un contrato descrito aquí, registra la divergencia; no inventes silenciosamente otra arquitectura.
3. El árbol ya contiene mucho trabajo ajeno. Antes de editar, registra `git status --short`; conserva modificaciones y archivos no seguidos. No uses reset, checkout de archivos, clean, borrados amplios ni stash automático. No cambies de rama con trabajo ajeno.
4. Este plan autoriza implementación cuando el usuario lo ordene, no despliegues, publicaciones, commits o push automáticos. Trabaja en el árbol actual; prepara una lista de archivos propios al cerrar. Si se autoriza después, crea un commit/PR por etapa con esos archivos, nunca `git add .`.
5. Primero escribe los tests del comportamiento pedido; después implementa y ejecuta las verificaciones de la etapa. No cambies expectativas para esconder un defecto.
6. No alteres umbrales actuales de completado, PINs, credenciales, ranking técnico de fuentes, actualizaciones o IPTV salvo las conexiones explícitas de este documento.
7. No uses `src/types/media.ts` ni supuestos `HistoryService`/`LibraryService` como autoridad de persistencia: hay archivos vacíos o nombres heredados. Los datos activos de esta tarea están en `utils/continueWatching.ts`, `utils/library.ts` y las integraciones citadas abajo. `MediaItem` está en `src/types/ui.ts`.
8. No introduzcas dependencias de runtime. Reutiliza React, TanStack Query, Zustand cuando ya corresponda, WebCrypto, Vitest y Playwright. Una dependencia nueva requiere una enmienda aprobada; no instalarla por iniciativa propia.
9. Un comando no ejecutado se registra «NO EJECUTADO», nunca «OK». Un test omitido o una prueba nativa simulada no equivalen a una prueba con mpv real.
10. Si falta un secreto, el backend o una capacidad externa, marca la etapa `BLOQUEADA`, conserva el avance verificado y continúa solo con etapas cuyo grafo no dependa de ella. No despliegues mocks como solución definitiva.
11. Para cada escritura asíncrona captura cuenta, perfil y generación al iniciarla. Si cambian, cancela o descarta el resultado. No recalcules el perfil destino usando el perfil activo al terminar.
12. Al cerrar, actualiza el registro con archivos propios, comandos, códigos de salida, pruebas de aceptación, limitaciones y siguiente etapa habilitada. No marques `HECHO` sin cumplir todos sus criterios.

### Prompt de arranque: copiar y pegar

```text
Lee PRODUCT.md, docs/experience/aetherio-master-experience.md y
docs/experience/aetherio-master-experience-status.md. Ejecuta solo la primera etapa
PENDIENTE cuyas dependencias estén HECHAS. Si S00 no se ha realizado,
empieza por S00. Sigue literalmente los contratos C1–C8 y la sección de
esa etapa. Conserva todo el trabajo local que no sea tuyo. No implementes
etapas posteriores, no publiques ni despliegues. No añadas explicaciones
del motivo de las recomendaciones. Escribe y ejecuta las pruebas pedidas.
Actualiza el registro con evidencia y termina indicando la siguiente etapa.
Si la etapa está realmente bloqueada, documenta exactamente el bloqueo y
no la declares hecha.
```

Para dirigir una etapa concreta, sustituir «primera etapa PENDIENTE» por su identificador. Si faltan dependencias, detener esa etapa con su lista exacta, no saltárselas.

## 3. Lo que se comprobó y se debe reutilizar

| Área | Base comprobada | Consecuencia |
|---|---|---|
| Preferencias | `src/config/playbackPreferences.ts`, normalización y tests; idiomas primario/secundario, subtítulos, caché del último enlace | Completar selección duradera; no inventar un segundo panel global. Conservar los valores actuales al migrar. |
| Progreso y pistas | `src/utils/continueWatching.ts`: progreso, historial, selección de audio y subtítulos, marca manual S0E0; `Player/index.tsx` ya restaura selecciones | Separar selección semántica de identificadores temporales. No duplicar el historial. |
| Recuperación | `SourceResolver.tsx`, `SourcePanel.tsx`, `useStreams.ts`, `useScrapedStreams.ts`, `liveRecovery.ts`, `useLivePlayback.ts` | Añadir recuperación VOD sin sustituir el controlador de directos. |
| Vistos | `src/services/watchedVisibility.ts` y tests; las series pueden reaparecer cuando hay episodios nuevos | Reutilizar esta política en todos los contextos; no considerar terminada una serie por un solo episodio. |
| Recomendaciones | `useCatalogs.ts`, `useRelatedRecommendation.ts`, `Detail/relatedMedia.ts`, Home y Big Picture | Filtrado reactivo del resultado, no contaminación de cachés compartidas por preferencias de una persona. |
| Perfiles | `utils/localProfiles.ts`: espacios de cuenta, modo local y claves por perfil | Incorporar nuevas claves a adopción/borrado; invalidar tareas y cachés al cambiar identidad. |
| Biblioteca | `utils/library.ts`, `pages/Library/libraryLogic.ts`, `BigPictureLibrary.tsx` | «Mi lista», «Ya vistos» y señales de recomendación son conceptos distintos. |
| Sincronización | `integrations/aniList.ts`, `trakt/index.ts`, credenciales seguras en `auth/` | Estado por servicio. Una sincronización parcial o una cola pendiente no son éxito total. |
| Backend de cuenta | Cliente en `auth/authClient.ts`; `aetherio-backend/src` está vacío en el árbol observado | No hay evidencia suficiente para implementar aquí el servidor de sincronización ni afirmar que no existe fuera. S07 tiene un bloqueo real. |
| Anime | `services/anilist.ts`, `animeResolve.ts`, `jikanClient.ts`, Detail y colecciones | Reutilizar mappings y cliente con rate limit; no unir temporadas por parecido del título. |
| Party | `PartyContext.tsx`, `protocol.ts`, `HomePartyModal.tsx`, `PartyPanel.tsx`, `crypto.ts`, `party-server/src/index.ts` | Extender el mismo relay, cifrado, lobby y ciclo de reconexión. |
| Herramientas | React 19/TS/Vite/Tauri 2; Vitest; Playwright puerto 1420; `party-server` usa Wrangler | No existe un script raíz genérico `npm test`; usar los comandos escritos abajo. |

El remoto es `origin` (`trklll/aetherio`), con rama predeterminada `main`; Git y GitHub CLI estaban disponibles. Esto no autoriza acciones remotas. El plan histórico `plans/aetherio-close-and-platform.md` no es el estado vigente ni permiso para retomar sus migraciones.

### Autoridad visual y UX

- **Modo: Operate.** Evolución de superficies existentes, no rediseño. Mantener tipografía actual, tokens, materiales, pósteres, márgenes `--app-gutter-*`, jerarquía y navegación espacial. No cambiar fuentes ni retocar todo `index.css`.
- Las nuevas acciones van en menús existentes; la recuperación en el overlay/panel del player; sincronización en ajustes/biblioteca; anime dentro de Detail; shortlist dentro del modal/panel Party. No crear páginas nuevas para resolver algo local.
- La captura previa `.impeccable/review/iptv-settings-desktop.png` ilustra parte del sistema, no prueba actual de estas superficies. Antes de cada etapa UI, capturar sus superficies actuales con fixtures y comparar sus estilos vigentes. No reutilizar esa captura como aprobación de otra pantalla.
- Estados de una acción: disponible, ejecutándose, confirmado, error y deshacer. Nunca toast de éxito antes de persistir. Usar texto más icono, no solo color.
- Ratón: botón accesible «Más opciones de [título]». Teclado: Tab/Enter/Escape y tecla ContextMenu o Shift+F10. Big Picture: mismo menú, accesible por foco; no reasignar X/Y del player ni capturar flechas por encima de `spatialNav`.
- Al cerrar devolver foco al disparador. Si la tarjeta se ocultó, al siguiente título visible, después al anterior y finalmente al encabezado de la fila. Evitar botones anidados dentro de un botón de tarjeta.
- En una etapa UI: leer `impeccable/reference/craft-floor.md` inmediatamente antes de editar UI; una revisión agrupada de capturas y una confirmación como máximo. Detector una vez sobre los archivos cambiados. Sin cambios UI en esta planificación, no se ejecutan detector ni build visual aquí.

## 4. Contratos cerrados — no reinterpretar durante la implementación

### C1. Identidad, perfiles y persistencia

Crear `src/domain/mediaIdentity.ts`. Exportar `MediaRef`, `EpisodeRef`, `mediaRefKey(ref)`, `episodeRefKey(ref)` y `sameMedia(a,b,aliases)`.

```ts
type MediaRef = {
  kind: 'movie' | 'series' | 'anime';
  namespace: 'tmdb' | 'imdb' | 'mal' | 'anilist' | 'addon' | 'legacy';
  id: string;
  addonId?: string; // obligatorio si namespace === 'addon'
};
type EpisodeRef = { media: MediaRef; season?: number; episode?: number };
```

- `tv`/`show` se normalizan a `series` en el adaptador. No transformar un `anime` en serie ni una película de anime en serie por tener un id MAL. Preservar el tipo reproducible original al regresar a rutas.
- Los prefijos identifican namespace; un número sin prefijo solo se interpreta con una procedencia explícita. Id de addon siempre incluye su addon; si no se conoce, usar `namespace:'legacy'` e `id:JSON.stringify([originalType, originalId])`, no suponer TMDB. No crear alias de una identidad legacy hasta comprobar su procedencia.
- Clave estable: JSON de la tupla `[kind, namespace, addonId ?? '', id]`; episodio añade temporada y episodio, con `null` para ausentes. No concatenar separadores ambiguos.
- Alias solo a partir de mappings existentes comprobados. No usar nombre/año como prueba de identidad. El mismo show TMDB no basta para fusionar dos entregas MAL/AniList; las correspondencias de anime requieren mapping de entrega/temporada.
- No cambiar claves antiguas de progreso ni biblioteca en masa. Un adaptador lee ambos contratos y conserva `type/id` originales para los escritores vigentes. Nuevas señales usan la nueva identidad. Un mapping ambiguo deja registros separados.
- Cada almacén nuevo usa `getScopedStorageKey`; adicionalmente captura `accountScope/profileId` en su contexto de operación. Registro central de claves de la experiencia en `src/domain/experienceStorage.ts`; integrar esas claves con adopción, cambio y borrado de perfiles sin tocar los secretos.
- Nuevos JSON: `{version:1, ...}`; lectura valida forma/rangos; migración idempotente y aditiva. Una versión futura desconocida se conserva intacta y se muestra como no compatible: no se sobrescribe con defaults.
- Escritura: persistir primero y emitir evento de datos cambiados después. En error conservar el estado anterior, emitir un evento de fallo de guardado independiente, devolver resultado tipado y mostrar «No se pudo guardar en este dispositivo». No decir «Guardado» si solo cambió memoria. Los exports legacy conservan su retorno y delegan en el mismo escritor; añadir variantes `tryAddToLibrary`, `tryRemoveFromLibrary`, `tryMarkMediaAsWatched`, `tryUpdateContinueWatchingSelection` y `trySaveContinueWatchingProgress` para los consumidores nuevos. No ejecutar dos escrituras para obtener el resultado.
- Una operación que afecte varias claves de almacenamiento (por ejemplo marca vista y salida de Continue Watching) lleva journal local versionado con valores previos y siguientes, persistido antes de las claves. Al completar, marcar committed y retirarlo. Al arrancar, recuperar un journal no committed antes de leer datos; si no se puede recuperar, conservarlo, no anunciar éxito ni encolar sync y mostrar error de guardado. No prometer transacciones atómicas de `localStorage`.
- Cachear datos públicos de catálogo sin personalización. Filtrar después para el perfil actual. Cachés de señales/mappings privados/selecciones incluyen ámbito y revisión; invalidarlas al cambiar perfil/cuenta.
- No migrar automáticamente datos de modo local a una cuenta ni entre cuentas. La adopción existente requiere acción explícita y solo copia al perfil elegido.

### C2. Preferencias de reproducción y recuperación

**Prioridad, de mayor a menor:** selección manual de esta sesión → selección guardada del mismo episodio → selección guardada de esta entrega/serie → preferencia global del perfil → pista por defecto del archivo. Los ids numéricos de mpv o una URL de subtítulo son válidos únicamente para el stream del que proceden.

Crear `src/domain/playbackSelection.ts` con una preferencia semántica: idioma normalizado, título normalizado, flags forced/SDH si existen y `subtitleMode:'auto'|'off'|'language'`. Guardar la preferencia por entrega y episodio en `aetherio-title-playback-selections-v1`; el `selectedAudio`/`selectedSubtitle` legado continúa funcionando en el mismo stream. No subir URLs a la nube.

- Elegir manualmente una pista o «Desactivados» guarda episodio y entrega; no modifica el idioma global. Si falta la pista al cambiar fuente, buscar semánticamente; si no existe, conservar la intención y usar fallback sin borrar la elección. Anunciar una vez «Esta fuente no incluye el audio elegido».
- «Desactivados» es una decisión explícita: no cargar ni reactivar subtítulos automáticamente. Forced tampoco la anula. «Sin preferencia» no significa «Desactivados».
- No volver a aplicar selección automática después de una selección manual tardía. Desechar respuestas tardías de pistas, subtítulos, proveedores y archivos de una generación anterior.
- Conservar idioma primario/secundario, `original`, normalizadores y valores actuales. El nuevo ajuste `automaticSourceRecovery` es `false` por defecto, incluso en perfiles existentes; no convertir «manual» en «first».
- Carga: `searching-sources → resolving-source → opening → buffering → ready`; también `recovering`, `needs-source`, `failed` y `cancelled`. Mostrar la fase real, proveedor en curso y «Cancelar» o «Elegir otra fuente» según fase. Nunca porcentajes ficticios. Cancelar invalida generación, aborta solicitudes abortables y no vuelve al Home.
- `useStreams`/`useScrapedStreams` exponen estado por proveedor: pending, success(count), empty, timeout, error, cancelled. Resultado parcial usable no espera al proveedor más lento. Sin proveedores habilitados es distinto de cero resultados y de todos fallidos.
- Recuperación VOD captura `query`, episodio, tiempo confirmado antes del error, play/pausa, velocidad y preferencias semánticas. Nunca registra la fuente fallida como último enlace exitoso ni escribe progreso cero al abrir otra.
- Un error transitorio permite **un** reintento automático de la misma fuente, tras 1 s. Un 401/403, formato no reproducible, archivo local ausente o error permanente no se reintenta automáticamente. Un stall VOD solo es candidato si antes estaba reproduciendo, no estaba pausado/buscando y transcurren 20 s sin avance, con buffering confirmado.
- Después, con `automaticSourceRecovery=false`, ofrecer «Reintentar», «Elegir otra fuente», «Volver a la ficha». Con `true`, probar como máximo dos fuentes alternativas distintas por incidente, orden técnico actual, excluyendo las ya fallidas. Tras 30 s de reproducción estable se cierra el incidente, no antes.
- Cada apertura VOD tiene watchdog de 30 s; P2P de 60 s. Durante un buffer P2P que sí progresa, no declararlo stall solo por falta de fotograma inicial. El fallo siempre acaba con acciones visibles, no con un spinner perpetuo.
- Reanudar en el segundo confirmado, limitado al rango válido de la duración conocida; preservar pausa y velocidad después de loaded/seek. Si la duración de otra edición difiere más de `max(120 s, 2% de la duración anterior)`, o no se puede comprobar, no hacer seek automático: pedir «Continuar desde mm:ss» o «Empezar desde el principio». No marcar completado al limitar el seek.
- Reanudar desde cero solo por una elección explícita o porque no había progreso. Un evento ended de la fuente anterior no puede cerrar la nueva ni marcarla vista.
- **Excepciones:** no aplicar este controlador a `live`/IPTV, replays deportivos ni archivos locales con resolución propia. Mantener `liveRecovery.ts`. En Party solo el anfitrión puede cambiar la fuente; un invitado solo reintenta la oferta del anfitrión. El grupo conserva el lobby/buffering actual.
- Los eventos nativos deben llevar un identificador de apertura/generación que permita ignorar el `end-file` anterior. Reutilizar el soporte existente de mpv; si no existe, añadirlo de forma aditiva al comando y evento, con pruebas Rust. No atribuir eventos sin id al intento nuevo.

### C3. Control de recomendaciones, sin explicaciones

Crear `src/domain/recommendationFeedback.ts`, `src/services/recommendationPolicy.ts`, `src/hooks/useRecommendationPolicy.ts`. Persistir en `aetherio-recommendation-feedback-v1`, por perfil.

Registro por título: `MediaRef`, snapshot mínimo `{name, poster?, genreKeys:string[]}`, decisiones independientes `notInterested:boolean` y `lessLikeThis:boolean`, revisión y fecha. No guardar `reason`, texto libre ni explicación. Borrar una señal no borra la otra.

| Acción | Efecto exacto | No debe hacer |
|---|---|---|
| No me interesa | Ocultar ese título y alias comprobados en descubrimiento Home, hero, «Descubrir» de biblioteca, recomendaciones Detail y Up Next | No borrar biblioteca, progreso, resultados de búsqueda explícita ni contenido de Party |
| Menos como esto | Excluir el título semilla en esas recomendaciones y reducir posición de candidatos con géneros comunes según fórmula inferior | No vetar géneros enteros, franquicias ni títulos sin evidencia; no tocar el orden técnico de fuentes |
| Ya la vi | Invocar el historial/mark actual y refrescar la política `watchedVisibility`; para serie/anime decir «Marcar como vista hasta hoy» en la confirmación | No inventar episodios, no marcar toda una franquicia, no borrar episodios reanudables previos |

- La búsqueda explícita, listas guardadas, ficha abierta por enlace y «Seguir viendo» siguen accesibles. Una recomendación que quedó oculta no hace desaparecer el contenido de esas superficies.
- «Ya la vi» utiliza el comportamiento S0E0 existente; guardar fecha efectiva. Las series con episodios nuevos siguen la regla de `watchedVisibility.ts`, no `any(entry.completed)`. Para ids no TMDB, ampliar el adaptador con dato de emisión verificable; si no se conoce, conservar la regla conservadora existente y no inventar «al día».
- Deshacer inmediato conserva una inversa de la escritura concreta. No restaurar una copia completa del historial: podría borrar progreso nuevo. Solo deshacer si la revisión del registro afectado no cambió; si cambió, no sobrescribir y avisar «El estado cambió; revísalo en Ya vistos».
- Registrar operaciones remotas Trakt/AniList únicamente donde ya esté soportado y con semántica equivalente. Una marca S0E0 sin correspondencia de episodios **no** significa exportar toda la serie como completada. No borrar actividad importada por deshacer una marca local.
- Fórmula de «Menos»: normalizar géneros con ids TMDB cuando existan (`tmdb:genre:ID`), ids AniList/MAL o nombres en su namespace, nunca cruzar traducciones por intuición. Para N candidatos, `base=(N-index)/N`, `penalty=min(0.60, sum(0.30*Jaccard(candidateGenres, seedGenres)))`; score=base−penalty. Vacíos → Jaccard 0. Estabilidad de empate: índice original. Una semilla activa cuenta una vez, aunque se pulse varias veces.
- Filtrar primero las exclusiones duras y deduplicar; luego penalizar. Mantener el orden de filas que eligió el usuario. «Menos» solo reordena dentro de filas; un hero solo sustituye ítems, no cambia composición.
- No rellenar con títulos excluidos cuando faltan candidatos. Si una fila queda vacía, omitirla conservando foco; si todas quedan vacías, «No hay sugerencias con tus preferencias actuales» + «Gestionar preferencias». Up Next se omite si no hay candidato permitido; no usar el fallback actual que devuelve uno visto.
- Gestión dentro de Ajustes → «Recomendaciones»: pestañas «Ocultados» y «Menos como esto», restaurar por título, «Restablecer estas preferencias» con confirmación. No borra «Ya vistos», biblioteca, orden de filas o progreso. Vista de vistos se gestiona en biblioteca.
- Acciones con label inequívoco, confirmación breve «Preferencia guardada»/«Marcada como vista» y botón «Deshacer» durante 8 s; accesibles después en ajustes/biblioteca. No añadir etiquetas «Porque viste…» ni tooltip de afinidad.

### C4. Guardado y sincronización que no mienten

Crear `src/domain/syncState.ts`, `src/services/syncCoordinator.ts`, `src/hooks/useSyncStatus.ts`. Un estado por ámbito y destino (`local`, `anilist`, `trakt`, `aetherio`), no un booleano global.

```ts
type SyncPhase = 'local-only' | 'not-connected' | 'idle' | 'pending' |
  'syncing' | 'synced' | 'partial' | 'offline' | 'auth-required' |
  'conflict' | 'error' | 'unavailable';
type SyncStatus = {
  phase: SyncPhase; pendingCount: number;
  lastAttemptAt: number | null; lastSuccessAt: number | null;
  errorCode?: string; // código estable; no tokens, URLs ni respuesta cruda
};
```

- Guardado local es independiente de éxito remoto. Biblioteca y player pueden funcionar offline. Si guardar localmente falla, mostrar error aunque la red esté bien.
- `lastSuccessAt` avanza exclusivamente con ACK real y completo de ese destino y lote. Capturar importaciones fallidas actualmente absorbidas por `.catch(() => [])` como `partial`; no borrar caché con un array vacío procedente de error.
- No conectado: «Conecta AniList/Trakt». Modo local: «Guardado en este dispositivo». Offline con cola: «Guardado aquí · pendiente de sincronizar». Auth expirada: «Vuelve a conectar». Backend no disponible: «Sincronización de cuenta no disponible». Nunca «Todo sincronizado» agrupando servicios desconectados.
- Guardar `lastSuccessAt` por servicio; texto relativo y fecha exacta accesible con hora local. Sin fecha: «Aún no se ha sincronizado». Un error no borra la última fecha buena.
- Reutilizar colas existentes Trakt. Añadir cola AniList durable para progresos exportables, coalescida por entrega, sin truncar silenciosamente operaciones. Evitar crear una segunda cola para la misma operación de integración.
- Programación: debounce 1.2 s tras cambio local, un intento concurrente por servicio/ámbito, retry transitorio a 2/10/30 s (máximo tres automáticos), después esperar acción, conectividad recuperada o cambio nuevo. 401/403 → auth-required sin loop; 429 respeta Retry-After hasta 60 s. Cerrar la app no pierde pendientes.
- Un cambio mientras hay un lote en vuelo queda para el siguiente lote; ACK de la versión vieja no elimina la nueva. Pull no dispara automáticamente otro push de lo importado. Cada integración conserva su ámbito de datos y credenciales.
- La conexión AniList/Trakt se asocia a un perfil mediante confirmación explícita. Si la conexión legada no tiene asociación, no iniciar nuevos exports desde otros perfiles; mostrar «Elige el perfil para esta conexión». No publicar tokens de cuenta ni copiarlos a un almacén de perfil.
- Indicador discreto en biblioteca y sección «Sincronización» en ambos ajustes. En esa sección: destinos, estado, fecha y acción pertinente. Sin banner permanente sobre el vídeo; error de guardado local sí requiere aviso no invasivo.

### C5. Contrato de nube Aetherio — servidor real obligatorio

**BLOQUEO B01:** recuperar el repositorio/código/configuración del backend que atiende `authClient.ts`, conocer cómo valida la sesión y qué almacenamiento usa. Directorio vacío no es permiso para reconstruir autenticación ni instalar una nube paralela. S07 no se puede terminar con este árbol solamente. No tocar producción para descubrir su contrato.

El implementador de S07 debe integrar el contrato siguiente con las sesiones y almacenamiento de ese servidor. Si su API real ya cumple semántica equivalente, documentar un mapeo exacto y adaptar nombres; no mantener dos APIs de sync.

- `GET /v1/sync/capabilities` autenticado: `{version:1, available:true}`. 404/501 → cliente `unavailable`, sin retry continuo ni falso éxito.
- `GET /v1/sync/profiles`: perfiles de la cuenta. `POST /v1/sync/profiles` con `{opId,localProfileId,name}`: devuelve `remoteProfileId` de forma idempotente. PIN, avatar local y secretos no viajan. Elegir explícitamente «Vincular perfil existente» o «Crear perfil en la nube», nunca por coincidencia de nombre.
- `GET /v1/sync/profiles/:id/changes?cursor=...&limit=200`: `{changes,nextCursor,hasMore,serverTime}`. Orden/cursor asignados por servidor y monotónicos. Cursor expirado → 410, sin borrar lo local. `GET /v1/sync/profiles/:id/snapshot?cursor=...&limit=200` devuelve `{records,nextCursor,hasMore,watermark}` sobre un snapshot consistente; al terminar, empezar changes desde watermark, incluyendo escrituras concurrentes posteriores. Snapshot no es permiso para borrar registros locales pendientes.
- `POST /v1/sync/profiles/:id/operations`: `{deviceId, operations:[...]}`, máximo 100 operaciones Y 256 KiB por request. Record: `{opId,kind,key,baseRevision,value,deleted}`. Respuesta individual `accepted` con nueva revisión, `conflict` con registro vigente o `rejected` con código. Una respuesta HTTP 200 no implica aceptar todas.
- `kind` permitido: `library`, `progress`, `history`, `playback-choice`, `home-preference`, `feedback`, `anime-preference`. Cada preferencia global se representa por campo; una marca vista y el progreso de episodio son registros separados. `key` es identidad estable o nombre de campo, nunca URL ni secreto.
- Cada perfil tiene dueño de cuenta comprobado en servidor para TODA operación. `deviceId` no autoriza acceso. Validación de tipos, tamaño y versión en ambos lados; renderizar texto como texto. Rechazar identificadores/valores no permitidos, acceso cruzado y cuerpos demasiado grandes.
- CAS por registro: `baseRevision:0` crea una clave inexistente; en otro caso solo aceptar la revisión vigente. Duplicar `opId` devuelve el mismo resultado sin duplicar efectos; el servidor conserva su recibo durante la vida del perfil en v1. Resolver/rebasar un conflicto requiere opId nuevo. Tombstones son registros versionados, no borrado físico inmediato; no se purgan en v1. Esto evita resurrección al volver un dispositivo viejo. No usar el reloj cliente para elegir ganador.
- Merge automático únicamente entre claves distintas. Conflicto en la misma clave: conservar ambas versiones y mostrar en ajustes título/campo, valor de este dispositivo y valor remoto; elegir «Usar este dispositivo» (reenvío con base vigente) o «Usar nube» (descartar pendiente concreto). No aplicar un cambio remoto al episodio que está reproduciéndose: diferir hasta guardar/salir; nunca hacer seek remoto espontáneo.
- Subir biblioteca, historial/progreso, preferencias semánticas, feedback y preferencias anime. NO subir tokens, API keys, contraseñas, PIN/hash PIN, servidores IPTV, cabeceras, últimas URLs, archivos locales, cookies, huellas Party ni métricas de reproducción. No replicar cachés públicos de catálogos.
- Bootstrap por lotes y reiniciable; no usar los límites de visualización de 80 elementos de Continue Watching como límite de historial sincronizable. Máximo un lote en vuelo por perfil, persistir cursor y pendientes antes de continuar; coalescer actualizaciones no enviadas por clave sin descartar resets/borrados explícitos.
- Desconexión de cuenta pausa la cola de esa cuenta y limpia datos de memoria, no borra datos de otra identidad. En modo local no intentar sync de cuenta. Sync completo es opt-in por perfil; ninguna carga previa a la acción «Activar sincronización».

### C6. Anime: relaciones y orden sin inventar continuidad

Crear `src/domain/animeRelations.ts`, `src/services/animeRelationsService.ts`, `src/hooks/useAnimeRelations.ts`. Consultar AniList público a través del cliente existente; fallback a `jikanRequest('/anime/:malId/relations')`. No crear peticiones directas paralelas a Jikan saltando `jikanClient.ts`.

- Nodo: entrega concreta, ids comprobados, tipo de formato (TV/movie/OVA/ONA/special/unknown), título, fecha parcial de estreno y `MediaRef`. Relación: PREQUEL, SEQUEL, SIDE_STORY, ALTERNATIVE, SUMMARY, SPIN_OFF u OTHER; conservar relación original y procedencia.
- Mostrar «Orden de estreno» como orden predeterminado: comparar año, después mes y después día; dentro del mismo año/mes, el campo desconocido va después de los conocidos, sin convertirlo en 1. Igualdad completa → id estable. Año desconocido al final bajo «Fecha sin confirmar». Mostrar solo la precisión que entrega la fuente. No llamarlo «orden cronológico» ni «orden obligatorio».
- Mostrar «Continuidad principal» solo para componentes PREQUEL/SEQUEL acíclicos. Orden topológico estable por estreno; ramas como ramas, no una cadena falsa. Ciclo/inconsistencia → «No se pudo confirmar un orden único» y volver al orden de estreno. SIDE_STORY/OVA no significa opcional ni relleno.
- No generar cronología narrativa, episodios filler ni orden editorial usando un LLM o títulos. Una relación editorial no prueba que una fuente tenga el vídeo.
- Root + expansión lazy: máximo 40 nodos, 80 aristas, profundidad 2 y 12 requests por expansión del usuario; máximo dos consultas concurrentes fuera de la serialización Jikan. Si se llega al límite mostrar «Hay más entregas; abre una para continuar», no afirmar franquicia completa.
- Caché pública 24 h de datos válidos, negativa 10 min. Ante error permitir caché anterior marcada «Datos guardados», botón «Reintentar», y continuar usando ficha/reproducción. No bloquear el CTA principal de Detail esperando relaciones.
- La acción de un nodo abre la ficha actual con tipo/id reproducibles; sin mapping seguro, mantener ficha MAL/AniList si está soportada, o desactivar «Reproducir» con «Fuente de reproducción por comprobar». No mandar un id MAL como TMDB ni cambiar episodios/temporadas por aproximación.
- Integrar sección «Orden y entregas» en Detail y la versión compartida de Big Picture, sin duplicar la red de componentes en dos implementaciones.

### C7. Anime: spoilers y audio con alcance real

Crear `src/config/animePreferences.ts`, `src/domain/spoilerPolicy.ts`, `src/domain/audioAvailability.ts`. Nuevo valor por perfil `spoilerProtectionEnabled=true`; no altera historial existente ni requiere cuenta.

- Para anime no visto: sustituir título de episodio por «Episodio N», no montar sinopsis ni imagen de ese episodio y no asignar su URL al DOM/CSS. El lector de pantalla, title y aria-label reciben la misma versión segura. No basta blur.
- Episodio visto se determina por marca exacta o progreso de integración con mapping de entrega/episodio comprobado. La marca S0E0 se interpreta con su fecha: no revela episodios estrenados después ni episodios cuya fecha sea desconocida.
- En Detail de anime sin completar, sinopsis general, galerías, comentarios y tráileres quedan colapsados bajo «Mostrar información con posibles spoilers»; no cargar imágenes/tráilers de esas secciones mientras estén cerradas. No ocultar título de la obra, año, formato, número de episodios ni relaciones de entrega.
- En Up Next, EpisodeGrid, EpisodePanel y continuar viendo, aplicar la misma política para nombres, stills y descripciones. Si una imagen segura no existe, usar póster general; no una captura de otro episodio.
- «Mostrar este episodio» revela solo en la sesión y entrega actuales, sin marcar visto ni apagar preferencia global; limpiar al cambiar perfil. Ajustes contiene el switch general. La política no promete filtrar spoilers dentro del vídeo o del chat de otras personas.
- Audio: separar `unknown`, `provider-reported`, `verified-track`, `not-found-in-checked-sources`; incluir episodio, fuente/provider, idiomas y `checkedAt`. No inferir doblaje a partir de región del catálogo, idioma de sinopsis, voz de personaje, subtítulo español o texto genérico «MULTI».
- En ficha, sin fuentes comprobadas: «Audio por comprobar». Metadata explícita fiable: «Español según el proveedor». Pista real de mpv con idioma: «Español detectado en esta fuente». Negativo limitado: «No se detectó español en las fuentes consultadas», nunca «No existe doblaje».
- Caducidad 30 min para disponibilidad de fuentes; cache key incluye episodio y configuración de proveedores. Un cambio de addons invalida la conclusión. No hacer scraping masivo por tarjeta de Home. Verificar bajo demanda al abrir fuentes o reproducción; no realizar aperturas de vídeo extra solo para pintar un badge.
- Integrar preferencia de audio con C2; doblaje conocido no cambia la preferencia elegida por el usuario. No añadir un filtro global «solo doblado» que descarte desconocidos.

### C8. Party: shortlist, votos y transición a reproducción

Extender el servidor y contexto actuales. Nuevas salas de elección: `mode:'choose'`, media inicial null, lobby esperando. Salas actuales creadas con contenido siguen funcionando sin entrar en elección.

**Negociación:** cliente anuncia `selectionVersion:1` en `hello`; servidor anuncia capacidad. Un servidor antiguo permite ver juntos como antes, pero no muestra botones funcionales de elección. Sala `choose` rechaza clientes sin capacidad con «Actualiza Aetherio para entrar en esta sala de elección». No romper mensajes antiguos en salas normales.

**Modelo y límites:**

- Fase `selecting | preparing | watching`; revisión global entera monotónica y `roundId` UUID. Hasta 20 candidatos aceptados, 20 propuestas pendientes y 20 miembros simultáneos en salas choose. Título máximo 200 caracteres; id/proveedor máximo 512; payload cifrado máximo 8 KiB. Presupuesto combinado de candidate/proposal payloads serializados: 48 KiB; snapshot/frame total máximo 64 KiB. Verificar tamaño final antes de aceptar la mutación, no solo cada campo. No emitir snapshots con journal, tokens o caché de opIds. Solo movie/series/anime; fuera directos, replay deportivo, archivo local y URLs de stream.
- Cada participante puede **proponer**; el anfitrión añade directamente, acepta/rechaza propuestas y elimina candidatos. Rechazar duplicados por identidad comprobada; no por título. La aceptación la hace el anfitrión después de descifrar; servidor no necesita conocer títulos cifrados. Invitados ven «Propuesta enviada» y su estado, no una inclusión ficticia.
- Un voto vigente por miembro y ronda, para un candidato. Pulsar otro mueve voto; pulsar el elegido lo retira. No voto ponderado ni votación negativa. Eliminar candidato elimina sus votos y avisa. Al aceptar propuestas usar `candidateId` aleatorio estable; timestamp/secuencia de creación del servidor desempata orden visual.
- Ranking: votos descendente, secuencia ascendente. Con empate de máximos, anfitrión elige entre empatados. Con cero votos puede elegir cualquiera. Sin empate solo se confirma el más votado. No autoplay ni cuenta atrás que decida por el grupo.
- No crear ranking con preferencias privadas ni enviar biblioteca/feedback personal al grupo. Solo el título propuesto; cualquier participante puede salir. Nombres autodeclarados no prueban personas únicas: una identidad por miembro conectado, no promesa de «un humano, un voto».

**Protocolo nuevo:** un envelope `selection` con `{opId,roundId,baseRevision,kind,payload}`. Kinds: `propose`, `add`, `accept-proposal`, `reject-proposal`, `remove`, `vote`, `commit`, `reopen`; resultados `selection-snapshot`/`selection-ack`/`selection-error`. Definir estas uniones en `src/party/selectionProtocol.ts` y validadores/reducer puros en `party-server/src/selectionState.ts`; conectarlos desde los dos protocolos existentes.

- `propose`: proposalId y payload de título; `accept-proposal`: proposalId, candidateId y payload; `reject/remove`: id objetivo; `vote`: candidateId o null; `commit`: candidateId; `reopen`: solicitar nueva ronda generada por servidor. Añadir `add` para incorporación directa del anfitrión, con candidateId/payload, evitando una propuesta artificial. El servidor comprueba fase, revisión, capacidad, límites, rol y pertenencia a esa sala antes de mutar. Idempotencia por opId; no confiar en `isOwner` enviado por cliente.
- Revisión obsoleta devuelve `selection-error:revision-conflict` junto con snapshot vigente, sin mutación. El cliente actualiza estado; para vote/propose/add reintenta la intención una sola vez con opId nuevo si sigue siendo válida. Commit/remove/reopen requieren nueva confirmación tras un conflicto; no repetir una decisión destructiva silenciosamente. Cancelar intento pendiente al cambiar round/conexión.
- Propuestas y candidate payload son JSON válido en sala abierta y sobres de `encryptRoomJson` en sala protegida. Datos permitidos: identidad/tipo reproducible, nombre, año y poster opcional; no stream, cabeceras, descripción, biblioteca ni progreso. Poster únicamente HTTPS público saneado con política existente de imágenes: sin credenciales, localhost/red privada, esquemas de ejecución ni fetch servidor de una URL aportada por participante. Los ids de candidato/propuesta, voto, contadores, rol, fase y revisión quedan visibles al relay para validación y reconexión. **Privacidad declarada:** el relay no lee títulos en sala protegida, pero conoce tamaño de lista, actividad y distribución de votos. No afirmar ocultación de esos metadatos. El cliente valida lo descifrado; un sobre malformado no ejecuta navegación ni abre URLs.
- Usar E2EE actual, IV aleatorio por mensaje; no poner contraseña o clave en invitación, almacenamiento del relay ni logs. No sustituir E2EE con HTTPS solamente ni inventar cifrado propio.
- Servidor autoritativo para revisión, roles, aceptación, votos y ACK; persistir snapshot, proposals, votos y ronda en Durable Object Storage. En la conexión vigente, los clientes adoptan snapshots con revisión mayor, incluido un roundId nuevo anunciado por servidor; eventos individuales del round anterior se descartan. Al reconectar, el primer snapshot es autoritativo aunque repita revisión; un resultado de conexión anterior se ignora por generación. Los snapshots son estados, no eventos transport/play, y no pasan por el filtro temporal de control que descartaría un snapshot legítimo viejo. No prometer integridad criptográfica del recuento frente a un relay malicioso: v1 confía en su validación de votos/roles.
- Validar operaciones solo tras `hello`. `memberId` estable se recupera con token aleatorio de reconexión de 32 bytes emitido por servidor; guardar hash en servidor y token solo en memoria del cliente. Entregar/presentar el token por mensaje WebSocket después de negociar capacidad, nunca query string ni invitación; WSS obligatorio salvo loopback local de tests. El `clientId` autodeclarado NO basta para recuperar miembro, votos o rol. No transportar ese token a otra sala/servidor ni loguearlo. Sin token válido, miembro nuevo sin heredar voto. Un token recuperado invalida la asociación del socket anterior para impedir dos votos simultáneos del mismo miembro.
- Desconexión: reservar miembro y voto 60 s; al vencer retirar voto y recalcular. Transferir anfitrión siguiendo la política actual, conservando shortlist y ronda; el token no recupera el rol si ya fue transferido. Tras reconexión recibir snapshot autoritativo, no reproducir una cola de votos offline. Durante desconexión, acciones de voto/elección deshabilitadas con «Reconectando».
- Límite de operaciones selection: 20 por miembro/10 s, además del límite de controles existente; exceso devuelve error recuperable sin mutación. Es protección básica, no defensa Sybil completa.
- `commit` aceptado cambia a preparing y congela la ronda. El anfitrión abre la ficha/flujo existente del título. Para series/anime elige episodio ahí: no inferir episodio 1 ni compartir el progreso privado de otro miembro. Solo al elegir medio concreto se envía `media` actual, con lobby esperando; al estar listo el anfitrión usa «Empezar» existente y se pasa a watching. Seleccionar candidato no reproduce de inmediato.
- Si resolver fuentes falla, conservar shortlist, votos y ronda; anfitrión puede reintentar o «Volver a elegir», que crea round nuevo, conserva candidatos y limpia votos. No borrar la sala ni expulsar invitados.
- Incorporar shortlist al snapshot de bienvenida, reconexión, hibernación y migración de sala. Migración entre servidores requiere crear sala compatible y ACK del snapshot antes de invitar a abandonar la anterior; si no soporta elección, deshabilitar migrar mientras se elige, con mensaje, en vez de perder datos. Sala cerrada limpia datos; no guardar historial social.
- Home/Big Picture: entrada Party ofrece «Crear sala para elegir»/«Unirse». Detail: «Proponer a la sala» si ya hay sala de elección; si no, «Elegir juntos» crea sala con propuesta del título. Modal compartido con tabs «Opciones» y «Chat»; lista y votos primero. Player PartyPanel conserva acceso y muestra título elegido/fase sin duplicar controles de transporte.
- Ajustar `PartyPendingJoinHandler`, autoentrada de `HomePartyModal`, navegación y restauración Big Picture: una sala en selecting no lleva al player; preparing con media concreta sí abre la ruta del modo actual, conservando lobby. Cerrar modal no abandona sala; botón «Salir de la sala» sí.

## 5. Grafo y estrategia de entrega

```text
S00 → S01 → S02 → S03
          → S04 → S05
          → S06 → S07 [B01 backend] → S08
          → S09 → S10  (S10 también exige S02 y S04)
S00 ─────→ S11 → S12  (S12 también exige S01 y S03)
S03 + S05 + S06 + S08 + S10 + S12 → S13
```

**Orden serial para un solo modelo:** S00, S01, S02, S03, S04, S05, S06, S07, S08, S09, S10, S11, S12, S13. Si B01 bloquea S07/S08, continuar S09–S12 y dejar S13 `BLOQUEADA` para cierre total. Se puede realizar su auditoría parcial, nunca su aprobación final.

Todos los pasos están preparados para el mismo modelo ejecutor; no requieren que el ejecutor decida estrategia o escoja otro modelo. Riesgo alto: S01, S03, S07, S08, S11. Añadir revisión humana de sus contratos antes de publicar. Un error de contrato se enmienda en este plan; no se «resuelve» con creatividad local.

**Paralelismo opcional, no necesario ni autorización de más agentes:** S02/S04/S09 pueden separarse después de S01 solo con propietario único de archivos compartidos; S11 puede avanzar aparte de frontend después de S00. Integraciones en `App.tsx`, ajustes, Detail, Player y protocolo se hacen serialmente. El camino recomendado para el ejecutor literal es serial.

### Verificaciones comunes

En todas las etapas con TypeScript: `npx tsc --noEmit` y sus tests Vitest. En etapas UI añadir su spec Playwright. Desde raíz salvo indicación explícita. No asumir `npm run build` aislado de hooks: ejecuta `anime4k:sync` y `providers:build`; registrar archivos generados, no versionarlos a ciegas.

Los archivos `.test.ts` nuevos enumerados en una etapa son parte de su entrega y deben crearse allí. Las políticas/reducers/colas se prueban con Vitest y fakes en memoria; las interacciones React se prueban con Playwright. No instalar Testing Library, jsdom u otro runner para estos pasos. `npx tsc --noEmit` raíz solo incluye `src/`; no valida por sí solo el Worker Party.

**Rollback común:** retirar únicamente cambios propios de la etapa por un diff revisado o revert de su commit específico si lo hubiera. No usar rollback de todo el repositorio. Migraciones aditivas conservan datos antiguos; no borrar preferencias/colas para ocultar una regresión. Si un almacén nuevo falla, desactivar su consumidor sin destruir su JSON.

## 6. Etapas con contexto, tareas, pruebas y salida

### S00 — Línea base reproducible y fixtures

**Depende de:** nada. **Leer:** secciones 1–5, `PRODUCT.md`, `package.json`, `playwright.config.ts`, tests existentes de perfiles/player/Party.
**Contexto:** este es un árbol con cambios locales extensos; ninguna prueba histórica garantiza su estado. No modificar runtime en esta etapa.
**Archivos propios:** registro de ejecución, `docs/experience/baseline.md`, `e2e/fixtures/experience.ts`, fixtures JSON nuevos en `e2e/fixtures/experience/` y `src/test/fixtures/experience/` si hacen falta.

1. Registrar HEAD, status, versiones Node/npm/Rust/Cargo y comandos disponibles. Guardar solo nombres/estado de archivos y hashes necesarios; no copiar `.env`, tokens o datos reales de perfiles.
2. Ejecutar baseline: `npx tsc --noEmit`; `npx vitest run`; `npx playwright test e2e/big-picture-library.spec.ts e2e/detail-back.spec.ts --project=chromium`. Si fallan, guardar fallo y causa reproducible sin arreglar trabajo ajeno. Fallos que impidan una etapa son bloqueo, no permiso para omitir pruebas nuevas.
3. Crear helper de fixtures basado en los helpers E2E actuales: cuenta/perfil ficticios, modo local, proveedores simulados y APIs interceptadas. No tocar localStorage real del usuario ni hacer requests a cuentas reales. Reloj fijo en tests, ids sintéticos y sin contenido audiovisual protegido.
4. Fixtures mínimos: dos perfiles; película y serie; dos entregas anime y OVA, ids ambiguos; fuentes rápida/lenta/vacía/fallida; pistas español/inglés/sin idioma; historial manual y episodios nuevos; almacenamiento que lanza quota error; dos participantes Party.
5. Capturar baseline de Home, Detail, ajustes y Party en escritorio/Big Picture con esos fixtures. Registrar viewport, ruta, fixture y fecha. Capturas de Sports preexistentes no sustituyen esta evidencia.

**Salida:** baseline reproducible; fallos previos identificados; fixtures sin red de producción; siguiente S01 habilitada si su baseline relevante no está bloqueado. No afirmar que pruebas nativas fueron ejecutadas por usar Playwright.
**Rollback:** borrar únicamente fixtures/docs nuevos propios; no cambiar snapshots previos.

### S01 — Identidades, ámbito y escrituras observables

**Depende de:** S00. **Leer:** C1/C4, `utils/localProfiles.ts`, `continueWatching.ts`, `library.ts`, `types/ui.ts`, `utils/identity.ts`, `utils/tmdbIdentity.ts`, `services/animeResolve.ts`, tests de perfiles.
**Contexto:** los tipos/keys legacy difieren entre biblioteca e historial; no sustituirlos de golpe. Este paso crea adaptadores y resultados de persistencia para todos los siguientes.
**Crear:** `src/domain/mediaIdentity.ts`, `experienceStorage.ts`, `storageResult.ts` y tests. **Extender:** `utils/localProfiles.ts`, `utils/library.ts`, escritores de `utils/continueWatching.ts`, conservando firmas compatibles donde sus callers ignoren el retorno.

1. Implementar C1 con tests de colisiones: movie vs series mismo id, anime entregas diferentes, ids de addons, prefijos desconocidos y aliases comprobados. Invalid identity devuelve error tipado, no una clave compartida vacía.
2. Exponer captura de ámbito y token de generación para tareas asíncronas; suscripción a eventos de cuenta y perfil; invalidación común. No guardar credenciales dentro del contexto serializable.
3. Añadir resultados `{ok:true,revision}` o `{ok:false,code}` en las variantes try de C1 y un único escritor interno. Conservar retorno de funciones legacy; migrar consumidores nuevos a variantes try y reportar fallos al estado local C4. Implementar journal recuperable para escrituras multiclave. El player sigue reproduciendo si el disco falla.
4. Registro de nuevas claves (C2–C7 y cola/status sync). Adopción/borrado procesa cada clave registrada; cuenta/perfil no activo no recibe escrituras tardías. Preservar claves existentes ajenas.
5. No modificar el contrato global de `buildMediaKey` ni realizar rekey destructivo. Añadir adaptadores para usar MediaRef con datos legacy.

**Verificar:** `npx vitest run src/domain/mediaIdentity.test.ts src/domain/experienceStorage.test.ts src/domain/storageResult.test.ts src/utils/localProfiles.pin.test.ts src/utils/localProfiles.pinMigration.test.ts src/utils/continueWatching.test.ts` y `npx tsc --noEmit`. El test de almacenamiento falla entre dos claves, reinicia el escritor y comprueba recuperación del journal sin anuncio de sync parcial.
**Aceptación:** perfiles A/B y cuenta local/remota sin fugas; escritura fallida sin evento de éxito; versión desconocida intacta; migración doble sin duplicados; claves antiguas legibles.
**Rollback:** consumidores vuelven a API previa; conservar JSON nuevo y copias legacy.

### S02 — Recuerdo de pistas consistente

**Depende de:** S01. **Leer:** C1/C2, preferencias y sus tests, `Player/index.tsx`, `Player/utils.ts`, `mediaTitleIdentity.ts`, `useSubtitles.ts`, `useOriginalLanguage.ts`, `continueWatching.ts`.
**Contexto:** ya existe recuerdo parcial; reparar selección entre fuentes/episodios sin sobreescribir preferencias globales ni sincronización de subtítulos.
**Crear:** `domain/playbackSelection.ts`, `hooks/usePlaybackSelection.ts` y tests. **Extender:** preferencias, Player, utilidades de selección y ajustes escritorio/Big Picture únicamente para `automaticSourceRecovery`.

1. Implementar precedencia, persistencia semántica y migración de lectura de selección existente según C2. Mantener ids de pistas solo dentro de la fuente actual.
2. Guardar elección manual de idioma y subtítulo off a nivel episodio/entrega; aplicar una vez por generación cuando las pistas estén listas. La llegada tardía de subtítulos no pisa una elección manual.
3. Estado de fallback separado de intención guardada. Integrar `original`, idiomas secundarios, SDH/forced y pistas sin idioma sin supuestos de doblaje.
4. Añadir switch «Probar otra fuente automáticamente» desactivado por defecto en ambos ajustes; texto describe límite, sin prometer fuentes infalibles. Es preferencia por perfil, no cuenta global.

**Verificar:** `npx vitest run src/domain/playbackSelection.test.ts src/hooks/usePlaybackSelection.test.ts src/config/playbackPreferences.test.ts src/pages/Player/mediaTitleIdentity.test.ts`; `npx playwright test e2e/playback-selection.spec.ts --project=chromium`; typecheck.
**Aceptación E2E:** español en E1 → español semántico en E2 con otros ids; off sigue off al cambiar fuente/reabrir; perfil B intacto; pista ausente no borra intención; autoplay no reutiliza pista por índice.
**Nativo:** lista manual en Windows con fixture de dos pistas legales y mpv; si no se ejecuta, pendiente nativo explícito.
**Rollback:** conservar selecciones nuevas sin consumirlas; defaults anteriores permanecen.

### S03 — Carga por fases y recuperación VOD

**Depende de:** S02. **Leer:** C2/C4, `useStreams.ts`, `useScrapedStreams.ts`, `SourceResolver.tsx`, `SourcePanel.tsx`, `PlayerLoadingOverlay.tsx`, `useMpvStatus.ts`, Player, eventos mpv en Rust; `liveRecovery.ts` como frontera.
**Crear:** `domain/playbackSession.ts`, `pages/Player/vodRecovery.ts` y sus tests; `e2e/playback-recovery.spec.ts`.

1. Reducer puro de estados/generación; integrar en flujo de resolver/apertura real, sin añadir otro player. Asegurar que loading inicial de hooks no produce «sin resultados» antes de empezar la petición.
2. Exponer estados incrementales por proveedor y cancelación. Error parcial no borra fuentes buenas; callbacks de generación anterior se ignoran. Permitir abrir fuente disponible sin esperar timeout de otra.
3. Conectar eventos reales a labels de C2 y botones de recuperación. Preservar artwork y nombre de la obra; no perder posición al abrir/cerrar panel de fuentes.
4. Controlador de reintento acotado, exclusiones, captura de posición, clamp seguro, diferencia de edición, fin de archivo tardío y presupuesto de intentos. Limpiar todos los timers en cancelación/unmount/cambio de medio.
5. Dar id de generación a eventos nativos si falta y añadir pruebas de eventos stale. Nunca refactorizar IPTV para reutilizar este nuevo controlador.
6. En Party respetar bloqueo de transporte y rol. No disparar un fallback local de invitado.

**Verificar:** `npx vitest run src/domain/playbackSession.test.ts src/pages/Player/vodRecovery.test.ts src/pages/Player/liveRecovery.test.ts src/utils/autoNextSource.test.ts src/pages/Player/playerGamepad.test.ts`; `npx playwright test e2e/playback-recovery.spec.ts e2e/iptv-recovery.spec.ts --project=chromium`; typecheck. Si cambia Rust: `cargo test --manifest-path src-tauri/Cargo.toml --test mpv_events` y `cargo check --manifest-path src-tauri/Cargo.toml`.
**Aceptación:** fallo en 12:34, otra fuente retoma 12:34±2 s y pausa/velocidad; nunca progreso cero; intentos acotados con fake timers; cancelar no reabre; todos fallidos ofrece tres acciones; edición diferente pregunta; IPTV/Party invitado no usan recovery VOD.
**Rollback:** desactivar consumidor VOD y volver al panel de fuentes previo; no borrar progreso.

### S04 — Señales de recomendación y marca vista reversible

**Depende de:** S01. **Leer:** C1/C3/C4, historial/biblioteca, `watchedVisibility.ts` y tests, `trakt/index.ts`, export AniList.
**Crear:** dominio/servicio/hook de C3 con tests. **Extender:** `continueWatching.ts` para operación inversa de marca manual revisada. Sin UI todavía.

1. Implementar ambas señales independientes, validación, lectura por perfil, eventos y revisión. Migración solo aditiva; señal repetida es idempotente.
2. Implementar fórmula, exclusiones por contexto y política vista central; añadir tests por ids alias, ausencia de géneros y vaciado completo.
3. Encapsular «Ya la vi» con inversa por registro, sin snapshot global. Conservar historial/episodios previos y no duplicar escrituras por alias.
4. Encolar únicamente las mutaciones remotas equivalentes; comprobar que deshacer local no borra un visto remoto o progreso posterior.

**Verificar:** `npx vitest run src/domain/recommendationFeedback.test.ts src/services/recommendationPolicy.test.ts src/services/watchedVisibility.test.ts src/utils/continueWatching.test.ts`; typecheck.
**Aceptación:** no interesado no borra lista; menos no suma por doble click; serie con episodio nuevo visible; undo no revierte reproducción nueva; fallo de disco no altera señales ni informa éxito.
**Rollback:** quitar consumidor nuevo; conservar feedback; marcas legacy siguen válidas.

### S05 — Acciones y aplicación coherente en todas las superficies

**Depende de:** S04. **Leer:** C3 y autoridad UX; `Home/CatalogRow.tsx`, `CinematicRow.tsx`, Home, BigPictureHero, BigPictureLibraryDiscover, tarjetas compartidas, `Detail/relatedMedia.ts`, `useRelatedRecommendation.ts`, Up Next, ajustes/biblioteca.
**Crear:** `src/components/media/MediaFeedbackMenu.tsx`, `src/components/settings/RecommendationPreferences.tsx`, `e2e/recommendation-controls.spec.ts`.

1. Buscar consumidores reales de las superficies enumeradas y anotar el mapa en el registro antes de editar. No asumir que todas las tarjetas pasan por CatalogRow.
2. Menú compartido con las tres acciones, confirmación para serie, deshacer 8 s y restaura foco. Los handlers no provocan navegación de tarjeta.
3. Conectar política después de caché/enriquecimiento de catálogo, antes del render; derivación memoizada por revisión. Aplicar también a cinematic hero, related y Up Next. Eliminar fallback a visto/excluido de `useRelatedRecommendation`.
4. En Ajustes montar gestión compartida en escritorio/Big Picture. Biblioteca mantiene vistos y guardados; solo «Descubrir» usa exclusiones. Búsqueda explícita permanece sin veto.
5. No mover filas elegidas, no añadir motivos ni nuevas badges de afinidad. Estado vacío y CTA de gestión exactos de C3.

**Verificar:** unit tests C3; `npx playwright test e2e/recommendation-controls.spec.ts e2e/big-picture-library.spec.ts --project=chromium`; typecheck.
**Aceptación E2E:** ocultar en Home elimina de hero/related/Up Next sin reload; sigue en búsqueda/lista; restaura desde ajustes; switch perfil no hereda; teclado/mando recupera foco tras ocultar último ítem.
**Rollback:** quitar menús y filtro, nunca borrar historial/feedback del usuario.

### S06 — Guardado local y estados reales AniList/Trakt

**Depende de:** S01. **Leer:** C4/C5, integraciones completas, inicialización en `App.tsx`, ambos ajustes y biblioteca.
**Crear:** dominio/coordinador/hook C4, `components/sync/SyncStatusIndicator.tsx`, `SyncSettingsSection.tsx`, tests y `e2e/sync-status.spec.ts`.

1. Añadir resultados tipados import/export de integraciones, ACK por operación y reporte parcial. Sustituir únicamente los catches que fingen éxito/arrays vacíos en estos caminos.
2. Integrar colas existentes y cola durable AniList con deduplicación/coalescencia; no usar estado singleton sin capturar perfil. Cancelar inicializadores viejos al cambiar identidad.
3. Asociar conexiones a perfil con confirmación; preservar credenciales en almacén seguro actual. No exportar desde perfil distinto por una sesión AniList de cuenta compartida.
4. Montar indicador de biblioteca y sección de ajustes con estados/fechas/acciones de C4. Aetherio por ahora es `unavailable`, no `synced` ni una falsa cola exitosa.
5. Local storage que falla da estado local error sin detener vídeo. Red que falla conserva datos y última fecha buena. No repetir reintentos infinitamente al volver una ventana al foco.

**Verificar:** `npx vitest run src/domain/syncState.test.ts src/services/syncCoordinator.test.ts src/integrations/aniList.sync.test.ts src/trakt/syncStatus.test.ts`; `npx playwright test e2e/sync-status.spec.ts --project=chromium`; typecheck.
**Aceptación:** reiniciar con cola mantiene pendientes; uno de cinco imports falla → parcial; error no vacía biblioteca; A/B sin exports cruzados; 401 pide conexión; reloj exacto; ACK viejo no elimina edición nueva.
**Rollback:** conservar colas y fechas; volver a consumidores previos sin vaciar operaciones.

### S07 — Servidor de sincronización Aetherio y contrato verificable

**Depende de:** S06 y B01 resuelto. **Leer:** C5 completo y código/config real recuperado del backend. **No iniciar cambios de servidor si sigue vacío.**
**Entrega:** `docs/experience/account-sync-contract.md`, implementación en el backend REAL, migración de almacenamiento aditiva y tests en su suite existente. Registrar su repo/ruta/commit exactos en el status. No añadir una autenticación alternativa a `party-server`.

1. Confirmar validación de sesión, autorización por cuenta/perfil, almacenamiento y límites. Comparar API existente con C5 y documentar mapeo endpoint/campo. Una incompatibilidad modifica contrato por enmienda explícita antes del cliente S08.
2. Implementar capabilities, perfiles remotos, CAS, idempotencia, cambios paginados, tombstones y bootstrap según C5. Transacción de escritura de valor/revisión/change log/idempotency; no aceptar parcialmente una única operación.
3. Fixtures servidor: dos cuentas, dos dispositivos, mismo perfil; requests duplicados; conflicto; cursor paginado/expirado; borrado y dispositivo antiguo; payload inválido y acceso cruzado.
4. Escribir comandos concretos de la suite y entorno local en el contrato. Ejecutarlos antes de marcar hecha. No inventar un comando para un repo aún desconocido.
5. No desplegar en producción. Si se autoriza staging más tarde, publicar primero servidor compatible, no cliente que asume endpoints existentes.

**Aceptación:** cuenta B nunca lee/escribe perfil A; replay opId no duplica; CAS realmente detecta conflicto; tombstone no resucita; listado de cambios no pierde un registro en páginas concurrentes; body 256 KiB/100 ops validado; secretos rechazados.
**Bloqueo exacto actual:** falta código real del backend y entorno de pruebas. Status inicial B01; tener `authenticatedRequest` no lo resuelve.
**Rollback:** desactivar capabilities del feature nuevo, mantener datos/migración aditiva y endpoints antiguos. No truncar tablas.

### S08 — Cliente de nube con cola, bootstrap y conflictos

**Depende de:** S07. **Leer:** C1/C4/C5, contrato real de S07, coordinador e integraciones de S06, authClient y credenciales seguras.
**Crear:** `src/services/accountSync.ts`, `src/domain/accountSyncQueue.ts`, tests y `e2e/account-sync.spec.ts`. **Extender:** coordinador/sección de sincronización y escritores de datos ya definidos; no cambiar login.

1. Activación explícita por perfil y binding remoteProfileId; listar perfiles de cuenta y ofrecer vincular/crear. No adivinar vínculo por nombre.
2. Adaptador de transport reutiliza `authenticatedRequest`, timeout/cancelación y código HTTP; preservar compatibilidad de callers existentes si se añade AbortSignal o se exporta error tipado.
3. Serializar allowlist de campos de C5; tests negativos de URLs, tokens, PIN, datos IPTV y archivos locales. Importaciones normalizan pero no vuelven a encolarse como cambios propios.
4. Cola durable por ámbito, lote acotado, ACK por opId/revisión, pull paginado y snapshot inicial reanudable. Distinguir cursor y pendientes; recuperar tras crash entre persistir y ACK.
5. Pantalla de conflictos dentro de sección sync: dos valores, dos acciones exactas; nueva resolución usa revisión vigente. No sobrescribir lo que se está reproduciendo; aplicar después de guardar/salir.
6. Detectar capabilities ausentes/servidor viejo → unavailable, conserva datos; red → offline; auth → auth-required. No publicar como completa una sincronización mockeada.

**Verificar:** `npx vitest run src/services/accountSync.test.ts src/domain/accountSyncQueue.test.ts src/services/syncCoordinator.test.ts`; `npx playwright test e2e/account-sync.spec.ts --project=chromium`; typecheck. Además ejecutar suite de integración cliente/servidor local escrita en S07; mocks de Playwright no la reemplazan.
**Aceptación:** guardar en dispositivo A, importar en B, borrar en A, B offline vuelve sin resucitar; replay idempotente; conflicto mismo campo visible; progreso de otra película se une sin conflicto; cancelar cuenta no escribe perfil nuevo; sin activación no hay upload.
**Rollback:** apagar activación de cuenta sin borrar colas ni datos locales; cliente viejo sigue funcionando en modo local.

### S09 — Relaciones anime y orden verificable

**Depende de:** S01. **Leer:** C6, clientes AniList/Jikan, `animeResolve.ts`, `detailCollections.ts`, estructuras reales Detail/ids y rutas Big Picture.
**Crear:** tipos/servicio/hook C6, `src/components/anime/AnimeWatchOrder.tsx`, tests y `e2e/anime-watch-order.spec.ts`.

1. Adaptar relaciones AniList y Jikan, preservando formato y procedencia; no asumir estructura de response sin fixture validado. Añadir fixtures del contrato público, no llamar API real en tests.
2. Orden de estreno con precisión parcial y grupo desconocido; orden topológico y detección de ciclos/ramas; ids que no mapearon no se mandan al reproductor como TMDB.
3. Carga lazy/caché/límites/reintento; un error no borra resultados válidos ni bloquea reproducir. Registrar si la lista es parcial.
4. Montar bloque en Detail compartido, con estados cargando/sin relaciones/parcial/error. Mantener selección y foco al volver de otra entrega.

**Verificar:** `npx vitest run src/domain/animeRelations.test.ts src/services/animeRelationsService.test.ts`; `npx playwright test e2e/anime-watch-order.spec.ts --project=chromium`; typecheck.
**Aceptación:** temporada→película→OVA; rama y adaptación alternativa sin falsa cadena; fecha sin día no se vuelve 1 de enero; ciclo no congela; duplicados por alias seguro se unen y temporadas ambiguas no.
**Rollback:** retirar bloque nuevo, conservar caché pública sin tocar biblioteca/progreso.

### S10 — Protección de spoilers y disponibilidad de audio

**Depende de:** S09, S02 y S04. **Leer:** C2/C6/C7, EpisodeGrid/EpisodePanel, ContinueWatchingRow, Up Next, DetailSectionPage, Player, tipos de stream y normalización de idioma.
**Crear:** preferencias/políticas C7, `components/anime/AnimeAudioAvailability.tsx`, tests y `e2e/anime-safety-audio.spec.ts`.

1. Policy pura decide visible/revelado/no visto por episodio y entrega, fecha de marca manual y mappings importados. No copiar flags `completed` de otra temporada TMDB a toda la franquicia.
2. Aplicar proyección segura ANTES de render de títulos/imágenes/aria; el dato no revelado no se precarga como imagen o trailer. Mantenerlo fuera de DOM oculto. `session reveal` por perfil/entrega/episodio y switch persistido global anime.
3. Integrar en las cinco superficies enumeradas por C7, modos escritorio y Big Picture; tarjetas de otra obra no se marcan vistas al revelar.
4. Availability limitada a episodio/fuente/config proveedores; solo metadatos de audio explícitos o track real. No deducir doblaje desde subtítulos. Invalidar TTL y presentar texto acotado; sin scraping en Home.
5. Conectar badges seguros a panel de fuentes/Detail y selección C2 sin reordenar preferencias del usuario por marketing del proveedor.

**Verificar:** `npx vitest run src/config/animePreferences.test.ts src/domain/spoilerPolicy.test.ts src/domain/audioAvailability.test.ts src/domain/playbackSelection.test.ts`; `npx playwright test e2e/anime-safety-audio.spec.ts --project=chromium`; typecheck.
**Aceptación:** episodio sin ver no aparece en texto accesible ni src/requests de still; revelado no cambia progreso; S0E0 antiguo no revela episodio futuro; español en subtítulo ≠ doblaje; cambio proveedor invalida; datos vacíos muestran desconocido.
**Rollback:** retirar proyección/badges, conservar preferencia; ningún cambio irreversible de historial.

### S11 — Protocolo y servidor Party de elección

**Depende de:** S00. **Leer:** C8 completo, `protocol.ts`, `PartyContext.tsx`, `crypto.ts`, servidor Durable Object, serialización de sockets, migración y control de roles actual.
**Crear:** `src/party/selectionProtocol.ts`, `party-server/src/selectionState.ts` y tests puros, `party-server/tsconfig.json`, `playwright.party.config.ts`, `e2e/party-selection-server.spec.ts`. **Extender:** protocolo/servidor/contexto en interfaces mínimas y `playwright.config.ts` para aislar tests Party; UI se deja para S12.

1. Types/validación para envelope, snapshots, ACK y errores; capability `selectionVersion` y modo choose. Mantener todas las uniones legacy y defaults de salas con vídeo. Incluir `add` entre kinds permitidos, datos/estados de propuestas rechazadas, conflictos de revisión y presupuestos combinados de C8.
2. Reducer puro servidor de propuesta/aceptación/voto/eliminación/commit/reopen, reglas de empate y revisión de C8. Idempotency cache con al menos 1.000 opIds por sala/ronda; superar el límite rota a snapshot y rechaza replay con revisión vieja, no vuelve a aplicar.
3. Integración DO: validar miembro/rol/fase, persistir mutación antes de ACK/broadcast, hibernación y reconexión. Tests reales con dos sockets; sin simular el reducer como si fuera Durable Object.
4. Implementar memberId/token de reconexión y ventana 60 s sin confiar en clientId; no cambiar la autenticación de cuenta. Revocación al salir/cerrar; token antiguo no reclama owner transferido.
5. Cifrar título/propuesta con helpers actuales y validar descifrado en cliente. Información visible al servidor declarada exactamente como C8; no desactivar E2EE para simplificar votos.
6. Migración de sala transporta snapshot/ronda/candidatos/propuestas/votos con ids de miembro remapeados tras aceptación de peers; si no se puede remapear con prueba de membresía, suspender migración en selecting y conservar sala antigua, no inventar votos. No transferir tokens entre servidores.
7. Config E2E Party levanta Wrangler local y Vite con `VITE_PARTY_SERVER_URL=http://127.0.0.1:8788` y `VITE_PARTY_SERVER_URLS` vacío, sin URLs remotas, health check y reuse desactivado para ambos servidores. Comando del webServer Party: `npm --prefix party-server run dev -- --local --ip 127.0.0.1 --port 8788`. Ejecutar config normal y Party en serie para no disputar 1420. Config normal añade testIgnore para `party-selection*.spec.ts`; config Party solo incluye esos specs, con proyecto llamado chromium. Tests incluyen cliente legacy/sala normal. La suite Vitest del reducer no importa globals de Worker; tests DO reales pertenecen a Playwright/Worker local.
8. Si ya existe tsconfig Worker al ejecutar, conservarlo y extenderlo; si no, crear el citado con target ES2022, module ESNext, moduleResolution Bundler, strict/noEmit/skipLibCheck, lib ES2022, types `@cloudflare/workers-types`, include `src/**/*.ts` y exclude `src/**/*.test.ts`. El paquete de tipos ya está en devDependencies de party-server; no añadir otra dependencia. Resolver errores introducidos y separar en baseline cualquier error anterior del Worker.

**Verificar:** `npx vitest run party-server/src/selectionState.test.ts src/party/selectionProtocol.test.ts src/party/invite.test.ts src/party/streamShare.test.ts`; `npx playwright test --config=playwright.party.config.ts e2e/party-selection-server.spec.ts --project=chromium`; `npx tsc --noEmit -p party-server/tsconfig.json` y typecheck raíz. Registrar logs del Worker saneados, sin tokens.
**Aceptación:** un no-owner no confirma; replay no duplica; voto cambia/toggle; propuesta duplicada no añade; empate exige opción válida; reconectar conserva un voto; token falso no roba miembro; hibernación conserva snapshot; 60 s retira voto; viejo entra sala normal pero no choose; payload corrupto no navega. Probar conflicto simultáneo, un solo retry, lista con payload máximo y rechazo antes de superar 64 KiB de snapshot.
**Rollback:** anunciar capability apagada para crear nuevas salas; salas normales intactas. Conservar snapshots de salas abiertas hasta expirar/cerrar, no hacer downgrade que borre estado vivo.

### S12 — Elegir juntos en Home, Detail y Big Picture

**Depende de:** S11, S01 y S03. **Leer:** C8, autoridad UX, HomePartyModal/PartyPendingJoinHandler, PartyPanel, rutas y acciones Detail, navegación Big Picture y lobby actual.
**Crear:** `src/party/PartySelectionPanel.tsx`, `e2e/party-selection.spec.ts`. **Extender:** mismos puntos de entrada/contexto ya existentes; no agregar un segundo proveedor Party ni router paralelo.

1. Crear/unirse desde Home y Big Picture antes de elegir. Mostrar lista vacía con «Propón un título desde una ficha» y acción buscar que regresa a la sala sin perderla. No obligar a abrir un player vacío.
2. Detail añade propuesta/creación; en sala protegida cifra y deduplica al aceptar según C8. Límites, estado pendiente/aceptado/rechazado y errores junto a la acción. Perfil privado no se comparte.
3. Panel Opciones/Chat compartido: candidatos, votos, mi voto y confirmación de anfitrión. Acciones deshabilitadas justificadas para invitados/desconexión/límite; no mostrar resultados optimistas como confirmados antes del ACK.
4. Commit→preparing conserva sala, ranking y votos. Series/anime siguen su flujo de elegir episodio; fuentes fallidas ofrecen volver/reintentar; no arrancan una película distinta ni limpian ronda por cerrar modal.
5. Reparar autoentrada en ambas rutas: selecting no entra al player; preparing con medio concreto respeta modo, lobby y permisos; watching usa sincronización previa. Volver a elegir requiere anfitrión y crea ronda nueva.
6. Foco modal, Escape/B, retorno a tarjeta, listas largas y mando; no interrumpir atajos actuales de reproducción. «Salir de sala» es distinto de cerrar panel.

**Verificar:** `npx playwright test --config=playwright.party.config.ts e2e/party-selection.spec.ts e2e/party-selection-server.spec.ts --project=chromium`; tests puros S11; `npx vitest run src/pages/Player/playerGamepad.test.ts`; typecheck.
**Aceptación:** dos contextos reales proponen/votan/desempatan; invitación abre shortlist; host elige episodio antes de compartirlo; fallo conserva opciones; host sale otro toma rol; sala con contraseña sin texto de título en logs relay; mando completa flujo sin ratón; sala normal sigue igual.
**Rollback:** retirar nuevos accesos de elección, mantener ver juntos y datos de sala del protocolo nuevo hasta expiración.

### S13 — Integración, calidad y entrega final

**Depende de:** S03, S05, S06, S08, S10 y S12. **Leer:** todos los contratos y registro. Si S08 está bloqueada, solo informe parcial; no marcar S13 HECHO.
**Entrega:** `docs/experience/acceptance.md`, actualización del registro, documentación funcional de nuevas preferencias/errores y guía de protocolo Party/contrato de sync donde corresponda.

1. Ejecutar todo el recorrido R1–R10 de sección 7 con fixtures; no solo tests unitarios aislados. Verificar que las features se siguen aplicando tras páginas cacheadas y cambio de perfil, no únicamente tras reload.
2. `npx tsc --noEmit`; `npx tsc --noEmit -p party-server/tsconfig.json`; `npx vitest run`; `npx playwright test --project=chromium`; `npx playwright test --config=playwright.party.config.ts --project=chromium`; `cargo test --manifest-path src-tauri/Cargo.toml --tests`; `cargo check --manifest-path src-tauri/Cargo.toml`; `npm run build`. Tests servidor de S07 aparte en su repo registrado. Fallos previos siguen identificados, no se rebautizan como éxito.
3. Smoke nativo Windows con mpv real: cambiar pistas, fallo de fuente y seek, salir/reabrir, dos perfiles, mando y Party. Usar medios de prueba autorizados. Documentar qué no es verificable en navegador.
4. Inspección UI agrupada con estados loading/empty/error/success/conflict/offline: escritorio 1440×900, ventana 1024×768 y Big Picture 1920×1080. Añadir 390×844 como robustez de layout WebView, no como lanzamiento móvil. Una ronda + un lote de correcciones + una confirmación; no pulido infinito.
5. Accesibilidad: foco visible/orden/restauración; label exacto; estado live no verboso; sin interacción hover-only; reduced motion; sin datos de spoiler en árbol accesible. Usar herramientas ya disponibles, no instalar librerías para reemplazar verificaciones básicas.
6. Ejecutar detector Impeccable una vez sobre archivos UI cambiados y resolver mecánicos; revisión final del diff sin modificar trabajo ajeno. Documentar el sistema vigente solo desde cambios reales; no imponer nuevo DESIGN.md como rediseño colateral.
7. Rendimiento verificable: no requests Jikan/audio por tarjeta; no filtros O(historial×tarjetas) en cada render; construir sets/índices por revisión. Fixture 12.000 entradas y 1.000 candidatos, prueba pura sin red; registrar tiempo de 20 iteraciones y comprobar que no crece una cola de red en Home. Evitar umbrales de tiempo flaky en CI; comparar mediana con baseline de S00 en la misma máquina.
8. Revisar que no existe UI/contrato de «motivo de recomendación», que los flags predeterminados son los de C2/C7 y que la subida cloud sigue opt-in. No publicar automáticamente ni incrementar versión por esta etapa.

**Salida:** matriz completada con evidencia, tests nuevos y regresiones relevantes verdes, pruebas nativas hechas o bloqueo de release explícito, B01 resuelto y nube real probada. Cualquier fallo material pendiente impide anunciar «todo implementado».
**Rollback:** deshabilitar consumidor problemático por feature concreta y conservar datos; no rollback global del repo, backend ni biblioteca.

## 7. Matriz de aceptación transversal

| ID | Recorrido obligatorio | Prueba mínima |
|---|---|---|
| R1 | Perfil A elige audio/sub off; siguiente episodio/fuente y reapertura mantienen intención; B no cambia | Unit selección + E2E + mpv real |
| R2 | Fuente falla a mitad; tiempo/pausa/velocidad siguen; no loop, fuente alternativa y fallback por edición | Reducer fake clock + E2E + mpv real |
| R3 | Ocultar/menos/vista actualizan Home, hero, biblioteca Descubrir, Detail y Up Next; búsqueda/lista accesibles; reset no borra vistos | Policy + E2E ambas modalidades |
| R4 | Serie vista vuelve con episodio nuevo; undo no borra progreso nuevo ni actividad remota | Historial/visibility + integración |
| R5 | Guardado local falla o red cae; estados/fecha/cola no mienten; parcial no borra datos | Tests storage/colas + E2E |
| R6 | Cloud A↔B real; páginas, borrado, replay, conflicto, cambio cuenta y sesión expirada | Servidor local real + cliente; mock solo no basta |
| R7 | Franquicia anime con ramas/OVA/fechas inciertas; mapping ambiguo no abre episodio equivocado | Graph fixtures + rutas E2E |
| R8 | No spoilers en DOM/aria/red de imágenes; reveal temporal; audio desconocido no se vende como doblaje | Policy + aserciones requests/árbol + mpv |
| R9 | Party propone/vota/reconecta/transfiere host; elige serie/episodio; fallo de fuente conserva decisión | Dos browser contexts + Worker local real |
| R10 | Auth/perfil cambian con operaciones en vuelo; ningún resultado cae en ámbito nuevo; navegación/mando no se rompe | Race tests + E2E + smoke Windows |

## 8. Registro, enmiendas y bloqueos

Usar `docs/experience/aetherio-master-experience-status.md`, con estados `PENDIENTE`, `EN_CURSO`, `BLOQUEADA`, `HECHA`. Cada etapa registra: fecha, baseline/commit, archivos propios, contratos consumidos, comandos/códigos, criterios comprobados, pruebas no ejecutadas, incidencias y próxima etapa. Se usa esta carpeta porque `plans/` está ignorada por una regla preexistente de Git; no se modificó esa regla ni el plan histórico.

**Enmiendas:** cuando la realidad contradiga el plan, añadir `Axx` con evidencia, contrato que cambia, efecto sobre dependencias/datos, pruebas nuevas y aprobación necesaria. No borrar requisitos ni marcar un paso omitido como completado. Dividir una etapa exige nuevos ids Sxx-a/b y una salida verificable por cada uno; no reduce su alcance.

**B01, real y actual:** código del backend de cuentas ausente de este árbol. Resolución: aportar repo/ruta y entorno local de ese backend. Afecta S07→S08→S13; no impide preferencias, recomendaciones, integración visible AniList/Trakt, anime ni Party.

**B02, condicional:** entorno nativo mpv o medios de prueba no disponibles. Resolución: ejecutar smoke en Windows con fixture autorizado. No impide tests UI/policies; bloquea afirmar recuperación nativa probada.

**B03, condicional:** un proveedor no informa idioma/relación/mapping. No es permiso para inventar datos ni bloqueo del producto: mostrar desconocido/parcial según C6/C7. Solo es bloqueo si el ejecutor pretende prometer disponibilidad universal, promesa fuera de alcance.

## 9. Definición global de terminado

- Cinco áreas entregadas en escritorio y Big Picture, no demos desconectadas.
- Sin explicación de motivos de recomendación en UI, API ni modelo de señales.
- Datos y trabajo previo conservados; migraciones repetibles e identidades aisladas.
- Guardado, progreso y sync observables, sin éxito inventado ni mocks en producción.
- Anime honesto con sus límites; Party conserva E2EE y no se convierte en red social.
- R1–R10 con evidencia, release gate nativo/backend resuelto y revisión del diff final.
- Usuario recibe archivos tocados, pruebas ejecutadas, límites reales y acciones externas pendientes. Nada se publica sin autorización aparte.
