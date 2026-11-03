# PROGRESS — Apple spinner clone→verify→integrate

Estado actual: integración y verificación completadas; el build completo está bloqueado por un error de TypeScript ajeno a estos cambios.
Para reproducir la comparación visual, leer ANALYSIS.md → los scripts corren así:
- `python spec.py` → regenera ref-spec.png (640×640 reconstrucción)
- Servir: `python -m http.server 4173` desde measure/spinner/ (matar stale primero)
- `python shot.py` → render.png del clon (viewport 320 dpr2, ?frozen=1)
- `python diff.py` → métricas numpy + diff.png
- Agentes adversarios → hallazgos → aplicar → re-diff → presentación al usuario

Checklist fases:
- [x] Fase 1: medidas → ANALYSIS.md (inferencias declaradas; original solo existió en chat)
- [x] Fase 2: clone/index.html (rojo referencia + blanco aetherio; frozen param; reduced-motion)
- [x] Fase 3: loop propio (mean|d| 0.37→0.30 tras F1/F3; ink 1.016→0.981; 8/8 sectores >0.98)
      Agentes adversarios: ag-2 (funcional) 8/9 PASS + F-overflow(minor) aplicado;
      ag-1 (pixel) F1 major (raid de phase W 30.5→30 + overflow clip) + F3 aplicado;
      re-diff limpio; rampa α implícita max|dev| 0.0087; colores exactos; agujero 0 ink.
- [x] Fase 4: presentación visual en presentation.png.
- [x] Fases 5-6: integración en src y verificación del spinner compartido.

Integración realizada:
- `src/components/ui/AppleSpinner.tsx`: spinner reutilizable de ocho pétalos, configurable por tamaño y color; decorativo (`aria-hidden`) para conservar el texto/estado accesible del contexto.
- `src/index.css`: geometría y animación compartidas; `prefers-reduced-motion` desactiva la rotación.
- Reemplazados los 18 usos de indicadores de carga actuales en `src`, incluidos arranque, autenticación, detalle/episodio, addons, ajustes, biblioteca y player. Los iconos de refresco quedan estáticos cuando no hay una operación activa.
- Eliminados los estilos/animaciones de spinner circular reemplazados. Se excluyeron los proyectos vendorizados independientes.
- Captura integrada: `measure/spinner/app-splash.png`.

Verificación:
- `npm exec -- vitest run src/components/ui/AppleSpinner.test.tsx`: 2/2 pruebas pasan.
- `npm exec -- vite build`: pasa.
- `git diff --check`: pasa.
- `npm run build`: bloqueado por `TS2305` en `src/pages/BigPicture/sportsOnboardingLogic.test.ts:9`; importa `previousSportsOnboardingStep`, que no está exportada por `sportsOnboardingLogic`. Ese archivo no forma parte de esta tarea y no se modificó.
- La búsqueda en `src` no encuentra usos activos de los spinners anteriores. El soporte genérico `.gsap-spin` sigue en `src/utils/motion.ts`, sin callers activos; los spinners de vendor quedan intactos.
