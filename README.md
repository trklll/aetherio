# Aetherio

Aetherio es una aplicación multimedia de escritorio para Windows. Gestiona tu biblioteca de series, películas y animes con un reproductor integrado, seguimiento de progreso y sincronización en la nube.

## Dependencias

- Windows 10 o superior
- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (incluido en Windows 11)

## Instalación

1. Descarga el instalador desde [Releases](https://github.com/trklll/aetherio/releases)
2. Ejecuta el instalador
3. Abre Aetherio desde el menú Inicio o el acceso directo del escritorio

## Actualizaciones

Aetherio verifica automáticamente nuevas versiones. Cuando haya una actualización disponible, aparecerá un aviso para instalarla.

## Fuentes y Provider Hub

La app no instala add-ons, repositorios de extensiones ni sitios de scraping
predeterminados locales. Las fuentes automáticas se obtienen de **Provider Hub**;
las instalaciones personales se conservan y tienen prioridad si comparten un ID.
Un directorio vacío del Hub deja cero add-ons automáticos. Sin conexión se puede
usar el último directorio válido del Hub, pero no se reactivan defaults antiguos.

AnimeAV1 es un scraper independiente de `animeav1.com`, publicado como script
del Hub, no un filtro de AnimES. Tiene identidad, logo oficial y activación
propios en escritorio y Big Picture. Las fuentes españolas del marketplace
Seanime conservan sus variantes; las adicionales solo ofrecen resultados
identificados como RAW/softsubs, sin doblajes extranjeros. Las pistas de
subtítulos seleccionables no son subtítulos pegados a la imagen.

Al actualizar, una migración retira únicamente entradas heredadas marcadas como
integradas, también de perfiles inactivos. Conserva add-ons personales, repositorios
añadidos por usuarios y URLs personales configuradas. Antes de modificar las listas
guarda sus valores originales en `aetherio-hub-only-backup-v1` del almacenamiento
local de la instalación. No es un restablecimiento de perfiles ni de la biblioteca.
