# Crunchyroll — tendencias de AniList

## Alcance

Agregar “En tendencia ahora” como primera sección del catálogo, después de la
cabecera existente, en `/platform/crunchyroll` y
`/big-picture/platform/crunchyroll`. Mantener el resto de la plataforma y la
navegación de Aetherio intactas. Toda la interfaz se muestra en español; los
géneros enviados a AniList conservan sus identificadores canónicos en inglés.

## Requisitos de integración

- Usar las cards, dimensiones, animación, desplazamiento horizontal y flechas
  estándar de `CatalogRow`/`CinematicCard`; no recrear las cards del diseño de
  referencia con un carrusel propio. Se conserva la preferencia habitual de
  póster vertical de Aetherio/BTTTR.
- No incluir las marcas/puntos de paginación que aparecen en la referencia; el
  encabezado lleva solo el título.
- No usar formato Top, numeración ni el badge violeta «Airing».
- La fila común recibe el nombre interno `Anime`, para que el detector de filas
  clasificadas no active el formato Top. El encabezado visible sigue siendo
  «En tendencia ahora».
- En PC, el desplazamiento usa los controles estándar de la fila. En Big Picture,
  las pestañas se ven como las de temporadas y LB/RB cambia el género; las
  pestañas no capturan el foco espacial y no se dibujan flechas de género propias.
- Resolver los IDs de AniList a TMDB antes de entregar los elementos a la fila,
  para que la normalización y la ruta de póster estándar de Aetherio/BTTTR puedan
  usarse. El listado sigue siendo descubrimiento de AniList, no una afirmación
  sobre disponibilidad regional en Crunchyroll.

## Comportamiento de origen

La referencia local es `refs_/seanime/seanime-web/src/app/(main)/discover/`.
`DiscoverTrending` solicita hasta 20 títulos ordenados por `TRENDING_DESC` y
vuelve a consultar al seleccionar un género; los filtros no son un filtrado
local del conjunto inicial. Se usa el cliente AniList serializado existente y la
cache de React Query por género.

## Verificación

Comprobar posición, fila no clasificada, controles PC/Big Picture, consultas y
cache por género, navegación a detalles, estados vacío/error y aislamiento de
otras plataformas. Las dimensiones se heredan de la fila estándar y no se evalúan
contra las medidas del carrusel personalizado de la referencia. No afirmar una
puntuación de comparación de píxeles: el arte cambia y la imagen original no está
disponible como archivo local.
