# Aviso de continuidad del reproductor

Adaptación solicitada, no clon independiente: conservar `.bp-skip-button`, fuente y escala de Aetherio.

Referencia entregada (862 × 314): botón principal aprox. x184/y74, 442 × 114; cancelar aprox. x675/y68, 126 × 126; separación aprox. 49 px. Play sólido, texto oscuro, progreso blanco sobre base gris; X blanca en círculo separado. Estas medidas son aproximaciones de la imagen del mensaje, no extracción de un archivo original.

Aplicación: alto y radio del botón Saltar de Aetherio (`clamp(52px,5.4vh,72px)`, radio 0.3 del alto), cancelar del mismo alto, separación 14 px. Posición inferior derecha, por encima de controles. Un único slot para continuidad o salto: nunca ambos.

Fuente de comportamiento consultada: tapframe/NuvioTV, `PlayerNextEpisodeRules.kt`, `PostPlayOverlay.kt`, `PlayerScreen.kt` (GitHub, 2026-11-02). Nuvio separa umbral, presentación, foco y reproducción. Aetherio saltaba directamente en su efecto de umbral. Para episodios, el umbral presenta el aviso con 12 s cancelables si autoplay está habilitado. Para películas, mantiene el comportamiento existente: abre directamente la recomendación a pantalla completa.

Cancelar dura todo el medio actual, incluso si cambian fuentes. Pausa/buffering/overlays frenan la cuenta. Cambio de episodio reinicia el aviso; retroceder fuera del umbral desmonta la cuenta sin provocar navegación.
