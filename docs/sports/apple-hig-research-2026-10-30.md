# Apple Human Interface Guidelines: investigación para Personalizar Sports

Fecha de consulta: **30 de octubre de 2026**. Estado: investigación previa a implementación.

## Conclusión ejecutiva

Personalizar Sports es una tarea de configuración, no una galería de contenido. La dirección apropiada es un editor compacto: listas de selección múltiple, filtros con alcance explícito y acciones de avance que no desaparezcan al recorrer el catálogo. Mantener el tema oscuro de Aetherio, sus escudos y las selecciones existentes; conservar ratón, teclado y mando.

Esto es una **recomendación para Aetherio**, no una composición que Apple imponga literalmente. Las HIG no ordenan que todo asistente tenga un pie fijo, no prohíben las rejillas y no prescriben una altura universal en píxeles CSS para las filas.

## Alcance y método

1. Se partió del [HIG oficial](https://developer.apple.com/design/human-interface-guidelines/) y de sus seis familias: Getting started, Foundations, Patterns, Components, Inputs y Technologies.
2. Se recorrieron los enlaces internos de temas del documento estructurado que sirve Apple (`/tutorials/data/design/human-interface-guidelines.json` y los documentos equivalentes de cada tema), eliminando duplicados y sin salir de ese árbol.
3. Resultado: **173 páginas recuperadas con HTTP 200: 158 artículos y 15 índices**. Se conservaron URL, fecha de acceso, contenido y SHA-256 de la respuesta original en una copia temporal local. Recuperar una página no equivale a haberla analizado en profundidad.
4. Se clasificó el índice completo por pertinencia a esta tarea: **54 artículos con lectura del texto principal en profundidad, 104 artículos cribados y 15 índices revisados**. La cobertura exacta y los enlaces de las 173 páginas se registran en el [inventario de fuentes](apple-hig-inventory-2026-10-30.md).
5. Se contrastó con Apple Design, Design Pathway, Design Resources, What’s new y las transcripciones oficiales de cuatro sesiones WWDC. No se usaron resúmenes de blogs como autoridad.

### Cobertura del árbol HIG

| Familia | Páginas, incluido su índice | Uso en esta investigación |
| --- | ---: | --- |
| Getting started | 10 | Principios y diferencias entre plataformas; macOS y tvOS son los contextos más cercanos. |
| Foundations | 19 | Jerarquía, distribución, tipografía, contraste, materiales, movimiento y accesibilidad. |
| Patterns | 26 | Onboarding, ajustes, búsqueda, entrada de datos, feedback y recuperación. |
| Components | 73 | Listas, colecciones, barras, selección, controles de búsqueda y organización. |
| Inputs | 14 | Teclado, ratón, foco, mando y gestos. |
| Technologies | 30 | Cribado de pertinencia; tecnologías como Apple Pay, HealthKit o CarPlay no justifican cambios en este formulario. |
| Portada HIG | 1 | Punto de partida. |
| **Total** | **173** | No representa todo el archivo histórico de Apple Developer. |

## Qué está confirmado por el producto

- Aetherio es una aplicación multimedia de escritorio para Windows; la interfaz existente utiliza React dentro de Tauri. Véanse `README.md` y `package.json`.
- El asistente guarda un borrador por perfil y conserva las preferencias al volver a personalizar. La investigación no propone cambiar su contrato de persistencia.
- El usuario ha confirmado listas compactas, filtros, acciones persistentes, tema oscuro y soporte de mando; ha pedido investigar las fuentes de Apple antes de cambiar la interfaz.
- La observación de «cinco minutos bajando» procede del usuario; **no es un tiempo medido en esta investigación**.

## Hallazgos y su aplicación

### 1. Simplicidad es eliminar fricción, no vaciar la interfaz

Apple distingue expresamente simplicidad de minimalismo: reducir pasos y mantener una jerarquía clara importa más que esconder funciones. En [Principles of great design, WWDC26, 11:13](https://developer.apple.com/videos/play/wwdc2026/250/?time=673) explica que una interfaz concisa respeta el tiempo de la persona y reduce los pasos para completar la tarea.

**Aplicación propuesta:** avanzar sin revisar cada equipo preseleccionado. Mostrar cuántos hay elegidos y permitir ajustar sólo las excepciones. No convertir seleccionar muchas ligas en la obligación de recorrer cientos de tarjetas.

### 2. Escritorio y TV no deben compartir ciegamente la misma densidad

[Get to know the new design system, WWDC25, 2:06](https://developer.apple.com/videos/play/wwdc2025/356/?time=126) distingue los controles compactos de escritorio de los controles grandes de énfasis. La familiaridad entre plataformas no exige medidas idénticas.

**Aplicación propuesta:** filas horizontales de tamaño contenido para configurar preferencias, con texto legible, superficie completa pulsable y foco inequívoco. Mantener las tarjetas grandes para el contenido audiovisual, fuera de este rediseño. Validar por separado el uso a distancia con mando: «compacto» no debe significar diminuto.

### 3. La jerarquía debe nacer de la organización

Apple recomienda agrupar acciones relacionadas y distinguir la principal, en lugar de añadir fondos, bordes y efectos indiscriminadamente. En [WWDC25, 6:16](https://developer.apple.com/videos/play/wwdc2025/356/?time=376), la estructura precede a la decoración.

**Aplicación propuesta:** encabezado breve, controles de búsqueda/filtro próximos a su lista, selección como contenido y una zona de acciones separada. «Continuar» será la acción principal; «Atrás» y «Saltar» no competirán visualmente con ella.

### 4. La búsqueda debe explicar qué busca y fallar de forma comprensible

[Design intuitive search experiences, WWDC26](https://developer.apple.com/videos/play/wwdc2026/292/) vincula ubicación y texto del campo con el alcance de búsqueda. También recomienda resultados rápidos, filtros pertinentes y un estado explícito cuando no hay resultados.

**Aplicación propuesta:** buscar dentro del paso actual, con etiquetas como «Buscar ligas» o «Buscar equipos», botón de limpiar y resultados locales inmediatos. Si no hay coincidencias, explicar el resultado y ofrecer quitar la búsqueda o los filtros. No añadir búsqueda global ni peticiones remotas para esta tarea.

### 5. Buscar no sustituye a explorar

La sesión anterior advierte que los mecanismos menos descubribles no deben reemplazar los filtros visibles. La búsqueda sirve para llegar directamente a algo conocido; la exploración permite descubrir el catálogo.

**Aplicación propuesta:** mantener una ruta completamente utilizable con mando, sin escribir. Filtros visibles por región/categoría y una vista de seleccionados; la búsqueda es un atajo opcional, nunca un requisito.

### 6. Liquid Glass no es un fondo para cada fila

En [Meet Liquid Glass, WWDC25, 10:31](https://developer.apple.com/videos/play/wwdc2025/219/?time=631), Apple reserva el material principalmente para la capa funcional de navegación y advierte contra apilar cristal sobre cristal o aplicarlo a toda una tabla.

**Aplicación propuesta:** superficie sobria y estable para las opciones; si se usa translucidez, limitarla a la zona persistente de acciones. Sin refracciones decorativas, halos por fila ni blur en cientos de elementos.

### 7. La apariencia nativa no se obtiene automáticamente con CSS

[Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass) describe la adopción automática mediante componentes de SwiftUI, UIKit y AppKit, y pide comprobar elementos personalizados con ajustes de accesibilidad y distintas dimensiones de ventana.

**Aplicación propuesta:** trasladar principios y comportamientos a React/Windows, sin afirmar que `backdrop-filter` reproduce el material nativo ni que las adaptaciones de accesibilidad de Apple se heredan automáticamente. No introducir un SDK nativo de Apple para esta pantalla.

### 8. Hay una advertencia expresa contra los controles críticos al pie de ventanas de escritorio

En [Layout, consideraciones de macOS](https://developer.apple.com/design/human-interface-guidelines/layout#macOS), Apple aconseja **“Avoid placing controls or critical information at the bottom of a window”**, porque una ventana puede quedar parcialmente fuera de pantalla. Por otro lado, [Going full screen](https://developer.apple.com/design/human-interface-guidelines/going-full-screen) indica mantener visibles los controles esenciales para navegar o realizar la tarea.

**Aplicación propuesta:** dar prioridad a una **barra superior persistente** para «Atrás» y «Continuar» en escritorio, no limitar la solución a pegar un botón al borde inferior. En una experiencia de TV a pantalla completa podría justificarse un pie persistente, pero no se presentará como una regla universal de Apple. Esta distinción modifica la primera idea de un footer fijo y es una conclusión práctica del research.

### 9. Foco, hover y elección persistente son estados diferentes

[Focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection) describe la navegación por foco y la activación separada en tvOS. [Color](https://developer.apple.com/design/human-interface-guidelines/color) desaconseja usar únicamente el color para comunicar información esencial; [Pointing devices](https://developer.apple.com/design/human-interface-guidelines/pointing-devices) advierte que ampliar una fila de tabla puede solaparla con las vecinas.

**Aplicación propuesta:** recorrer una lista con mando no marca preferencias. Usar una marca persistente para la elección, un contorno independiente para foco y una respuesta discreta al ratón. El área accionable es la fila completa, sin el zoom expansivo de las actuales tarjetas.

### 10. Compacto no significa letra pequeña ni controles difíciles

[Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) pide controles suficientemente grandes y navegación exclusivamente por teclado; [Typography](https://developer.apple.com/design/human-interface-guidelines/typography) pide adaptar el layout a los tamaños de texto. Las tablas de Apple diferencian expresamente macOS y tvOS: no deben convertirse en una misma cifra de píxeles CSS para Aetherio.

**Aplicación propuesta:** reducir ilustración y espacio redundante antes que el nombre de la liga; permitir nombres largos y texto ampliado; comprobar objetivos cómodos con mando. Mantener la fuente actual o una fuente de sistema apropiada para Windows. No empaquetar SF ni SF Symbols por suponer que sus descargas autorizan cualquier distribución.

### 11. La personalización debe ser rápida, opcional y recuperable

[Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding) recomienda una introducción **“fast, fun, and optional”** y posponer configuración no esencial. [Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles) subraya que recuperarse de lo inesperado no debería costar trabajo o tiempo. [Launching](https://developer.apple.com/design/human-interface-guidelines/launching) propone restaurar detalles del estado anterior.

**Aplicación propuesta:** conservar el borrador, permitir avanzar sin elegir favoritos obligatorios y evitar nuevas pantallas por cada nivel del catálogo. El retroceso cierra primero el contexto temporal y después retrocede dentro de la tarea; no debe borrar preferencias ni expulsar sorpresivamente a Inicio.

### 12. La respuesta debe integrarse en la tarea y en su estructura accesible

[Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback) recomienda integrar el estado en la interfaz; [VoiceOver](https://developer.apple.com/design/human-interface-guidelines/voiceover) pide especificar agrupación, orden y relaciones. [Settings](https://developer.apple.com/design/human-interface-guidelines/settings) recomienda situar opciones contextuales en las pantallas que afectan.

**Aplicación propuesta:** contador de elecciones y resultados, nombres y estados accesibles y filtros junto a la lista. Marcar una preferencia no abre una alerta. Se verificará el árbol accesible y la interacción de Windows; no se afirmará compatibilidad con VoiceOver por analogía.

### 13. Elegir muchas opciones textuales encaja mejor en listas que en colecciones de imágenes

[Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables) recomienda preferir listas o tablas para presentar texto. [Collections](https://developer.apple.com/design/human-interface-guidelines/collections) indica que las colecciones son apropiadas, en general, para contenido basado en imágenes. [Toggles](https://developer.apple.com/design/human-interface-guidelines/toggles) distingue las elecciones múltiples independientes de los controles de selección única.

**Aplicación propuesta:** tratar los escudos como apoyo a nombres y preferencias, no como carteles de contenido. Varias ligas se marcan independientemente; el filtro de región cambia qué se ve, no a qué se está suscrito. Una rejilla sigue siendo válida para contenido visual; Apple no prohíbe el 1:1.

### 14. No arreglar el scroll con más scroll anidado

[Scroll views](https://developer.apple.com/design/human-interface-guidelines/scroll-views) recomienda evitar vistas de desplazamiento anidadas con la misma orientación y revelar el contenido enfocado desplazando sólo lo necesario. [Split views](https://developer.apple.com/design/human-interface-guidelines/split-views) contempla la separación entre filtros y resultados en tvOS. [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) recomienda una sola acción principal al extremo final de la barra.

**Aplicación propuesta:** una sola zona vertical desplazable para las opciones, con controles persistentes fuera de ella y sin desplazamiento vertical adicional de la página. En español/LTR, «Continuar» irá al extremo derecho. Los filtros pueden aprovechar el ancho disponible sin imponer un árbol profundo ni otro asistente.

## Diagnóstico de la implementación existente

Son observaciones de código, no resultados de una prueba de usabilidad:

| Problema | Evidencia local | Consecuencia |
| --- | --- | --- |
| Opciones cuadradas de gran altura | `src/pages/BigPicture/BigPictureSports.css`: `.bp-sports__picks--list .bp-sports__pick` usa `aspect-ratio: 1`, cuatro columnas y emblemas grandes. | Una opción ocupa altura de tarjeta de contenido, aunque sólo cambie una preferencia. |
| Acciones después de todo el catálogo | `src/pages/BigPicture/BigPictureSportsOnboarding.tsx`: `bp-sports__onboard-actions` se renderiza después de todos los grupos. | El camino al siguiente paso crece con la cantidad de opciones. |
| Todos los clubes de ligas elegidas se muestran individualmente | El mismo componente utiliza `followedLeagueClubs.map(...)` y luego `otherClubs.map(...)`. | Elegir más ligas produce una pantalla larga precisamente cuando ya hay menos decisiones pendientes. |
| Resumen exhaustivo por defecto | El resumen enumera cada competición y equipo seguido en listas. | La revisión final vuelve a penalizar las selecciones grandes. |
| Muchas capas de reglas para el mismo control | La hoja Sports contiene varias definiciones sucesivas de picks, encabezados y acciones. | Un cambio de tamaño aislado puede dejar estilos contradictorios o regresiones de foco. |

## Dirección propuesta para el rediseño

Esta es una **decisión de producto derivada de la investigación**, no un mandato literal de Apple:

1. **Estructura estable:** encabezado de paso y acciones superiores persistentes, controles contextuales y zona central de opciones desplazable. El catálogo crece dentro de su zona; no empuja «Continuar» fuera de la ventana. Se prioriza arriba por la advertencia específica de macOS, sin copiar literalmente las métricas de esa plataforma.
2. **Opciones compactas:** escudo pequeño, nombre, contexto breve y marca de selección en una sola fila. Varias columnas sólo cuando haya ancho suficiente y sigan siendo legibles.
3. **Selección explícita:** múltiples equipos/ligas independientes; separar el foco de teclado/mando del estado «seleccionado». No disfrazar una selección múltiple como pestañas de navegación.
4. **Encontrar y explorar:** búsqueda local opcional, filtros visibles y posibilidad de revisar seleccionados sin perder las demás elecciones.
5. **Acciones estables:** «Atrás» y «Continuar» en ubicaciones consistentes; «Saltar» secundario donde ya existe. Las acciones masivas deben aclarar si afectan a los resultados visibles o al catálogo completo.
6. **Resumen por grupos:** cantidades y categorías primero; detalle expandible cuando se quiera revisar. No obligar a leer centenares de nombres para confirmar.
7. **Preservar los datos:** no cambiar identificadores, catálogo, perfiles ni fuentes de reproducción. El borrador y la vuelta a personalizar deben conservar las elecciones.

Las dimensiones concretas, el número de columnas y los puntos de ruptura se fijarán y comprobarán al construir; no se presentan como especificaciones oficiales de Apple.

## Criterios de aceptación antes de dar por terminado el rediseño

- Con todas las ligas/equipos seleccionados, «Continuar» está visible y se puede activar al entrar, a mitad de la lista y al final.
- El último resultado se puede ver y enfocar entero: la zona de acciones no lo tapa.
- Ratón, Tab, flechas, activación con teclado y mando conservan un recorrido comprensible; no es obligatorio escribir.
- Buscar, cambiar región o mostrar seleccionados no altera por sí mismo las selecciones.
- El borrador sobrevive a recarga; volver atrás o personalizar de nuevo no borra preferencias.
- El resumen permite confirmar sin expandir todos los grupos.
- No hay desplazamiento horizontal de página ni texto importante recortado en ventana pequeña o con texto ampliado.
- Foco y selección se distinguen sin depender sólo del color. Se comprueban contraste y preferencias de movimiento/transparencia reducidos.
- Se revisa el peor caso de cantidad de entidades y el coste del renderizado; no se atribuyen mejoras de tiempo sin medirlas.

## Límites y honestidad de la investigación

- El universo recuperado es el **árbol HIG actual enlazado**, no cada página histórica, documento de API, vídeo, foro o descarga de Apple Developer.
- Se diferencia inventariar/cribar de leer en profundidad. No se justifica leer Apple Pay o ResearchKit como si fueran requisitos de un selector de ligas.
- «Lectura completa» en el inventario significa lectura del texto principal extraído: no una evaluación exhaustiva de ilustraciones, ejemplos visuales, tablas de color ni documentación de API enlazada.
- Se consultaron transcripciones de sesiones, no se afirma haber visto todos sus fotogramas ni descargado todos los kits de Figma/Sketch.
- No es una certificación de Apple ni una auditoría integral de accesibilidad.
- La validación con personas y con un mando físico sigue pendiente; una comprobación en navegador no la sustituye.
- Investigación y síntesis asistidas por IA. Las fuentes enlazadas son primarias; las recomendaciones, el diagnóstico y los futuros tamaños son responsabilidad de este trabajo, no afirmaciones atribuidas a Apple.

## Fuentes complementarias oficiales

- [Apple Design](https://developer.apple.com/design/).
- [Design Pathway](https://developer.apple.com/design/get-started/).
- [Apple Design Resources](https://developer.apple.com/design/resources/).
- [What’s new in design](https://developer.apple.com/design/whats-new/): comprobado para no basar el trabajo únicamente en guías antiguas; incluye cambios del 28 de octubre de 2026 en macOS, gestos y dispositivos señaladores.
- [Principles of great design — WWDC26](https://developer.apple.com/videos/play/wwdc2026/250/).
- [Design intuitive search experiences — WWDC26](https://developer.apple.com/videos/play/wwdc2026/292/).
- [Meet Liquid Glass — WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/).
- [Get to know the new design system — WWDC25](https://developer.apple.com/videos/play/wwdc2025/356/).
- [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass).
