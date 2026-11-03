# Highfly en Sports

Revisión: 30 de octubre de 2026.

## Instalación local

- El addon `community.sports.fly` se incluye en el registro de complementos como **Sports Streams · Highfly**. Su proveedor conserva el identificador `sports-streams` y se activa primero mediante una migración única de la configuración de Sports. Desactivarlo después sigue siendo una decisión persistente.
- El enlace configurado del usuario vive en `VITE_SPORTS_STREAMS_MANIFEST_URL`, en `.env.local`, que Git ignora. No se copia el enlace personal ni su identificador gratuito a este documento, fixtures o código versionable. Las compilaciones locales incorporan esa configuración: no se deben distribuir como un preset público para otras personas.
- Los complementos ya instalados conservan su URL y estado. La base de Sports también admite el override existente `aetherio-stremio-sports-base-urls["sports-streams"]`.
- Reiniciar el entorno de desarrollo o cargar una compilación nueva incorpora la configuración. No se ha publicado ni instalado un ejecutable Tauri nuevo; un ejecutable anterior no recibe estos cambios por reiniciarse solamente.

## Adaptación al producto

- El manifiesto de este enlace respondió HTTP 200 y anunció **49 catálogos**. Se descubren sus catálogos `sport`, incluidos los de ligas, sin registrarlos como películas o series en Home.
- Se deduplican los partidos antes de resolver sus fuentes. Los registros `leaf:` se presentan como canales lineales; los `recap:` no se anuncian como partidos en directo. Este preset tiene `onlyLive=true`: no se inventa una agenda que el addon no publique.
- El preset incluye `hideTitles=true`. Se consulta `/meta/sport/<id>.json` para recuperar los nombres y el inicio UTC cuando el catálogo manda texto invisible o solo `LIVE`. El estado de directo del catálogo no se pierde al recibir una ficha con la hora de inicio.
- Baloncesto entra en la identidad y personalización de Sports, con NBA, WNBA, EuroLeague y NCAA. No se reutilizan escudos de equipos de fútbol para equipos de baloncesto. La selección anterior del usuario se respeta; para añadir baloncesto se usa **Personalizar**.
- Los canales de Highfly requieren una verificación reciente, igual que IPTV: se ocultan al caducar los 55 s del sondeo. Una fuente sin manifiesto/segmento accesibles no se ofrece como disponible. Esto no garantiza que siga respondiendo después.

## Idioma y reproducción

- Se ordenan las fuentes por narración identificada en español, no por subtítulos ni por la liga. Un idioma explícito distinto de español prevalece sobre una suposición por el nombre.
- A igualdad de preferencia lingüística se prioriza Highfly. Una fuente española de otro proveedor puede preceder a una fuente inglesa de Highfly.
- Los partidos con fuentes identificadas en español aparecen antes en «Ahora mismo». Se conservan alternativas de otros idiomas y las cabeceras HTTP necesarias.
- Una elección manual de fuente prevalece sobre la selección automática. No se cambia silenciosamente el canal ni se atribuye idioma español a fuentes desconocidas.

## Horarios

- Los instantes se almacenan en UTC y se presentan con `America/Lima`, incluyendo el día correcto de Perú y una etiqueta visible «Perú», con independencia de la zona del ordenador.
- Las fechas textuales del addon aceptan meses ingleses y españoles, y rechazan desbordamientos como el 31 de febrero. No se fabrica una hora de inicio para un `LIVE` sin fecha fiable.
- El plan gratuito incrusta UTC en algunos pósteres. No se cambia el plan ni se solicita una función premium: se utiliza el fondo sin ese texto o el arte de respaldo de Aetherio, y se presenta el horario convertido en la interfaz.

## Presupuestos de red

Cuatro trabajos concurrentes por fase; caché compartida de catálogo de 30 s; hasta 64 catálogos, cinco páginas de 100 metadatos por catálogo y 240 entradas únicas enriquecidas. Los catálogos se intercalan antes de recortar para no excluir baloncesto por una lista larga de fútbol. Por carga se resuelven hasta 120 partidos y 120 canales; por entrada se prueban hasta 12 rutas, en orden de idioma, y se conservan hasta cuatro disponibles. Estos límites evitan un sondeo ilimitado y no prometen mostrar todo un catálogo arbitrariamente grande en una sola actualización.

## Evidencia

- `npx vitest run src --exclude 'vendor/**' --exclude 'src/pages/Entity/entityRanking.test.ts'`: **979 pruebas correctas en 110 archivos**.
- `npx tsc --noEmit`: correcto.
- `npx vite build`: correcto; avisos no bloqueantes de Browserslist y tamaño de chunks.
- `npx playwright test e2e/sports-highfly.spec.ts e2e/iptv-recovery.spec.ts e2e/sports-iptv.spec.ts e2e/sports-player.spec.ts --workers=1 --trace off`: **21 pruebas correctas**. Incluye baloncesto desde un catálogo de liga, nombres ocultos, selección española, elección manual inglesa, día/hora de Perú en un equipo UTC y personalización de NBA.
- Una tanda ampliada anterior con Home y onboarding terminó con **40/41**: `Repeticiones vuelve a comprobar las fuentes periódicamente sin pulsar Actualizar` falló dentro de GSAP (`clearProps`, al ejecutar `clock.fastForward`). La repetición aislada confirmó esa misma firma. No se alteraron animaciones ni se eliminó esa prueba para dar la tanda por correcta.
- Prueba HTTP real, acotada a un partido NBA del enlace configurado: **Washington Wizards vs Charlotte Hornets**, inicio recuperado `2026-10-30T23:00:00.000Z`, dos fuentes HLS verificadas en unos 3,7 s. Sus idiomas no estaban identificados. Esto prueba catálogo, ficha, resolución y sondeo de medios puntuales; **no** prueba decodificación nativa, audio español ni disponibilidad de todos los eventos.
- Los E2E simulan el puente Tauri y utilizan un preset de prueba, no el identificador personal. Captura de QA: `artifacts/sports/highfly-peru.png`.
