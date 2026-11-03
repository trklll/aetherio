# Aetherio

<!-- impeccable:product-schema 1 -->

## Platform

web

La interfaz React se ejecuta dentro de una aplicación de escritorio Windows con Tauri y WebView2. Big Picture es un modo de la misma aplicación, no una plataforma nueva. Esta clasificación describe el lenguaje de interfaz; no promete una aplicación web pública ni versiones nativas móviles.

## Users

Personas que descubren y reproducen películas, series y anime, gestionan su biblioteca y continúan lo que estaban viendo. Usan escritorio o Big Picture, con ratón, teclado y mando. Existen perfiles locales y modo local sin cuenta.

## Product Purpose

Reducir el trabajo entre descubrir un título y verlo; conservar preferencias y progreso, dar control sobre las recomendaciones y permitir elegir y ver contenido en grupo.

## Operating Context

Aplicación existente con React 19, TypeScript, Vite, Tauri 2, reproductor mpv, proveedores/addons, navegación espacial, integraciones AniList/Trakt y salas Party. El README declara Windows 10 o superior. El código de interfaz y el servidor Party están disponibles en este repositorio; el directorio `aetherio-backend/src` estaba vacío al preparar el plan de noviembre de 2026.

## Capabilities and Constraints

- Evolucionar la aplicación y conservar su diseño, proveedores, datos y modo Big Picture: confirmado por el usuario el 1 de noviembre de 2026.
- Alcance solicitado: continuidad de reproducción y pistas; controles «No me interesa», «Ya la vi» y «Menos como esto»; estados comprensibles de biblioteca/progreso/sincronización; orden y relaciones de anime, doblaje y protección contra spoilers; shortlist compartida y votación en Party.
- No incluir explicaciones del motivo de las recomendaciones. No añadir red social, servicios de pago ni rediseño general.
- Reutilizar primero las piezas existentes. Recordar preferencias y ocultar vistos ya tienen implementación parcial; no presentarlas como capacidades totalmente ausentes.
- Los estados locales, AniList, Trakt y la futura sincronización completa de Aetherio deben distinguirse. No afirmar sincronización de cuenta sin confirmación real del servidor.
- El usuario autoriza fijar reglas y valores iniciales en el plan para un ejecutor literal. Solo los bloqueos externos reales quedan pendientes.

## Evidence on Hand

`README.md`, `package.json`, `src/App.tsx`, `src/config/playbackPreferences.ts`, `src/utils/continueWatching.ts`, `src/utils/localProfiles.ts`, `src/services/watchedVisibility.ts`, `src/integrations/aniList.ts`, `src/trakt/index.ts`, `src/party/` y `party-server/`. El diseño vigente reside en componentes, estilos y recursos; la falta de DESIGN.md no autoriza reemplazarlo.

## Product Principles

1. Una decisión explícita del usuario prevalece sobre automatismos; todas las señales de personalización son reversibles.
2. Conservar el contexto ante un fallo; ofrecer una acción de recuperación concreta sin empezar de nuevo.
3. Distinguir datos comprobados, desconocidos, pendientes y fallidos; no inventar orden narrativo, doblaje ni éxitos de sincronización.
4. Mantener aislamiento entre cuentas y perfiles, compatibilidad de datos y navegación equivalente en escritorio y Big Picture.
