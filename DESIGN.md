---
name: Aetherio
description: Sistema visual existente de la aplicación de escritorio, documentado sin rediseñarlo.
colors:
  primary: "#ffffff"
  inverse-text: "#1c1c1e"
  page-fallback: "#1f1f1f"
  atv-bg: "#0d0d0d"
  atv-surface: "#1c1c1e"
  atv-elevated: "#2c2c2e"
  atv-border: "rgba(255,255,255,0.12)"
  atv-secondary: "rgba(255,255,255,0.60)"
  atv-hover: "rgba(255,255,255,0.08)"
  atv-selected: "rgba(255,255,255,0.15)"
  glass-fill: "rgba(255,255,255,0.16)"
  glass-pill-fill: "rgba(255,255,255,0.12)"
  glass-dark-fill: "rgba(0,0,0,0.65)"
typography:
  body:
    fontFamily: "Inter, system-ui, sans-serif"
  navigation:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
rounded:
  md: "6px"
  lg: "8px"
  card: "10px"
  lg2: "16px"
  pill: "999px"
spacing:
  safe-top: "24px"
  safe-x: "32px"
  block-bottom: "48px"
  shell-nav-height: "88px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.inverse-text}"
    rounded: "{rounded.pill}"
  nav-pill:
    backgroundColor: "{colors.glass-pill-fill}"
    textColor: "{colors.primary}"
    rounded: "{rounded.pill}"
    padding: "6px 8px"
  nav-item-selected:
    backgroundColor: "{colors.atv-selected}"
    textColor: "{colors.primary}"
    typography: "{typography.navigation}"
    rounded: "{rounded.pill}"
  surface:
    backgroundColor: "{colors.atv-surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.card}"
---

# Design System: Aetherio

## Overview

**Creative North Star: "Aetherio"**

Este documento describe las decisiones ya presentes en el shell y los materiales compartidos; no introduce una identidad nueva. La navegación flota sobre el fondo de perfil y la fotografía del contenido aporta el color. Inter, las superficies neutras y los controles redondeados mantienen continuidad entre páginas.

La incorporación de Canales conserva ese sistema. Su parrilla y sus colores de emisora son decisiones de esa superficie, no nuevos tokens globales. La estrategia concreta de cada página vive en `.impeccable/surfaces/`.

**Key Characteristics:**
- Tipografía Inter compartida.
- Fondos de perfil y contenido conservados por el shell.
- Cristal existente para controles superpuestos; superficies tonales para contenido denso.
- Navegación y acciones en forma de píldora.

Evidencia: `src/index.css`, `tailwind.config.js`, `src/components/layout/TopNav.tsx`, `FloatingActionButton.tsx`, `AppShell.tsx`, `stageweb.jpg` y las capturas de Canales. Es una documentación acotada del sistema compartido, no una auditoría de todas las pantallas.

## Colors

Paleta neutra oscura, texto blanco y transparencias de blanco para jerarquía y estados. Los valores canónicos están en el frontmatter y proceden del CSS/configuración existentes.

### Primary
- **Blanco de acción:** texto principal, selección clara y acciones primarias.

### Neutral
- **Fondo base:** respaldo de página; el fondo de perfil puede aportar la composición visible.
- **Superficie y superficie elevada:** capas de contenido, no un material nuevo de cristal.
- **Texto secundario:** información de apoyo sobre fondos suficientemente oscuros.
- **Velo de selección y velo de hover:** estados de interacción existentes.

**The Reuse Rule.** Reutilizar los colores y materiales existentes antes de añadir variantes. Los colores propios del contenido no se convierten automáticamente en acentos de aplicación.

## Typography

Inter es la familia global, también para campos y botones; se mantienen optical sizing, suavizado y renderizado de texto establecidos en `src/index.css`. La navegación compartida usa el rol del frontmatter y aumenta el peso en la opción activa.

Las páginas establecen su jerarquía de títulos según su contenido. Esta documentación no convierte la escala particular de Canales en una escala obligatoria para toda la aplicación. En parrillas y horarios se emplean cifras tabulares.

La adaptación TV de Canales conserva esa identidad con una escala local de lectura a distancia (21px/16px para título/hora de programa a 1080p, creciente hasta 4K), filas con desplazamiento propio y foco neutro diferenciado de la selección. Reutiliza el blanco de selección `#f5f5f7` ya presente en la guía. Sus valores y navegación quedan acotados al brief de Canales, no a los tokens globales.

## Layout

La API de alineación es `--app-gutter-x`, `--app-gutter-y`, `--app-page-x` y `--app-page-y`, no márgenes laterales sueltos. Sus valores derivan de las áreas seguras y de la holgura del rail de Big Picture. El shell reserva `--app-shell-nav-height` y mantiene el scroll de las páginas.

Big Picture es un modo de la misma aplicación: la presencia de su rail ajusta los insets existentes. No reproducir su sidebar ni su escala dentro de una página de escritorio.

Los ajustes estrechos de Canales permanecen acotados a su ruta; no definen un nuevo layout global ni alteran otras pantallas.

## Elevation & Depth

Los materiales compartidos son `liquid-glass`, `liquid-glass-pill`, `liquid-glass-dark` y `liquid-glass-arrow`. Consumen `--lg-filter-xl/lg/md/sm`, que ya resuelven la refracción SVG y su fallback de desenfoque. Las utilidades `backdrop-blur-glass*` existentes son otra entrada al mismo sistema.

El recorte se obtiene de `--lg-clip` y de las clases de radio soportadas. Conservarlo: un border-radius aislado no recorta correctamente la refracción en Chromium.

**The Existing Material Rule.** No crear otro blur, backdrop-filter ni material para una página nueva si el sistema ya ofrece el nivel necesario.

Sombras observadas: la píldora de navegación usa una sombra baja y difusa; los botones flotantes añaden sombra descendente y un reflejo interior. Los valores completos están en el sidecar y sus componentes de origen.

## Shapes

Píldoras para navegación, filtros y acciones; radios de tarjeta y superficie para contenido. Los nombres y valores del frontmatter proceden de `tailwind.config.js`. Los controles flotantes conservan su radio compacto. Los radios locales de una parrilla no sustituyen esta escala.

## Components

### Buttons
Las acciones primarias son claras y redondeadas. Los botones flotantes existentes encapsulan el cristal, el icono, el título accesible y su animación. Reutilizarlos cuando coincida su función; no copiar su material con otro filtro.

### Chips
La selección tonal de navegación/filtros es un velo blanco; el estado debe ser perceptible sin cambiar la familia tipográfica. Hover y foco no deben sustituir la selección persistente.

### Cards / Containers
Las miniaturas y superficies conservan los radios de su componente de origen. Una tabla o guía densa no necesita convertir cada región en un contenedor de cristal.

### Inputs / Fields
Los campos integrados en navegación son transparentes sobre el material del control padre. Mantener nombre accesible, texto legible y un estado de foco visible. Los campos con texto seleccionable deben permitir selección pese al user-select global.

### Navigation
La píldora compartida conserva perfil, destinos, búsqueda y estado activo. Su contracción por scroll ya está implementada. Las adaptaciones de una ruta no deben cambiar silenciosamente las otras.

## Do's and Don'ts

### Do:
- **Do** reutilizar Inter, los componentes y los materiales existentes.
- **Do** alinear páginas mediante los tokens de gutter e inset de la aplicación.
- **Do** distinguir hover, foco y selección, y respetar reducción de movimiento en interacciones nuevas.
- **Do** mantener las decisiones propias de una superficie en su brief.

### Don't:
- **Don't** crear nuevos materiales de blur para resolver una necesidad ya cubierta.
- **Don't** introducir otra familia tipográfica en una página añadida.
- **Don't** convertir un defecto de una pantalla en una regla del sistema.
- **Don't** presentar contenido sintético como programación o reproducción real.
