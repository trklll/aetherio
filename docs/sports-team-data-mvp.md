# Datos de equipos: MVP local gratuito

## Fuentes y alcance

- **FotMob**: clasificación, puntos, puestos, plantilla, fotos de jugadores, última alineación publicada, partidos, goleadores y palmarés disponible.
- **Wikidata**: complemento opcional para el club (identidad, estadio y web oficial). La capa de datos también lee el año de fundación registrado, pero no se publica automáticamente sin contraste: durante la comprobación apareció un año dudoso para Alianza. No decide resultados ni totales de títulos; sus datos pueden contener errores y llevan procedencia explícita.
- **Registro editorial**: el palmarés verificado de Manchester United conserva prioridad sobre el historial parcial del proveedor.
- **ESPN eliminado de esta integración**. No hay fallback oculto, claves, suscripciones ni trials.

Se conserva el frontend del MVP. En Perú se muestran acumulada, Clausura y Apertura por separado. La cabecera toma la acumulada, no confunde sus puntos con los de una fase.

## Transporte

`src/services/sportsDataHttp.ts` admite exclusivamente HTTPS y rutas de lectura de FotMob/Wikidata. Tauri reutiliza `provider_http_request`; no requiere modificar ni recompilar Rust por esta integración. El navegador en desarrollo utiliza `/api/sports-data/fotmob`, `/api/sports-data/fotmob-stats` y `/api/sports-data/wikidata` en Vite. Son destinos fijos, no un proxy a URLs suministradas por el usuario. No se reenvían cookies ni Authorization del navegador.

FotMob tiene caché en memoria de cinco minutos; Wikidata, 24 horas. Las consultas simultáneas se deduplican, las cachés están acotadas y los errores no se almacenan. «Reintentar datos» fuerza una consulta nueva sin reintentos automáticos ni cambio de proveedor. Wikidata nunca bloquea los datos deportivos.

Los cuatro equipos comprobados tienen IDs explícitos: Manchester City `8456`, Manchester United `10260`, Alianza Lima `6398`, Atlético Grau `920789`. El resto usa búsqueda exacta única y comprueba de nuevo la identidad del resultado. No se elige por similitud el primer club, equipo femenino, jugador o equipo de e-sports encontrado.

## Límites conocidos

- Endpoints no oficiales: pueden cambiar, bloquear peticiones o dejar de estar disponibles.
- El palmarés del proveedor es **parcial**. En Alianza no representa todos los campeonatos históricos. No se suma como si fuese el total del club.
- Algunas plantillas devuelven ceros de relleno para goles. Solo se presentan goles con evidencia en las estadísticas de goleadores, filtradas por jugador y equipo. Un dato ausente se mantiene desconocido, no cero.
- Una última alineación publicada no confirma los titulares del próximo partido.
- No hay fuente de fútbol para equipos de baloncesto; se informa de falta de cobertura sin enviar consultas equivocadas.
- FotMob no es una fuente de libre redistribución: sus [condiciones](https://www.fotmob.com/tos.txt) exigen consentimiento para extracción/reutilización. El usuario solicitó esta prueba local conociendo esa limitación. Este MVP no acredita permiso de publicación o explotación comercial.

## Verificación

Pruebas deterministas (datos sintéticos con la estructura observada):

```powershell
npx vitest run src/services/sportsTeamOverview.test.ts src/services/sportsDataHttp.test.ts src/services/sportsTeamFacts.test.ts src/pages/BigPicture/sportsTeams.test.ts
npx playwright test e2e/sports-team-page.spec.ts e2e/sports-my-teams.spec.ts --workers=2
npx tsc -p tsconfig.release.json --noEmit
```

Prueba explícita contra los cuatro equipos reales, sin respuestas deportivas simuladas:

```powershell
$env:AETHERIO_SPORTS_LIVE = "1"
npx playwright test e2e/sports-team-page.spec.ts --grep "MVP con datos reales" --workers=1
```

La prueba en vivo requiere conexión y depende del proveedor. Recorre clasificación, once titular, plantilla con fotografías y títulos. Las capturas se guardan en `.impeccable/review/sports-team-page/live-*.png`. No se ejecuta en CI de forma predeterminada para evitar convertir disponibilidad externa en un fallo del código.

### Comprobación en Tauri real (6 de noviembre de 2026)

La primera comprobación de navegador no detectó un fallo del transporte nativo: FotMob/CloudFront devolvía **403 Request blocked** al cliente sin `User-Agent`. Se reprodujo dentro de la instancia real de Aetherio. La misma petición nativa con `User-Agent: Aetherio/0.9.4 (local sports MVP)` devolvió **200 JSON**. Esta identificación de la aplicación no suplanta un navegador ni resuelve desafíos, utiliza cookies de navegador o introduce proxies de evasión.

La cabecera queda en el transporte deportivo de escritorio. No requiere modificar Rust. El test de regresión falló con 403 antes del cambio y pasó después; los 18 tests de los tres servicios y TypeScript también pasaron.

Para repetir la comprobación nativa, salir por completo de Aetherio y arrancar desde PowerShell:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=9232"
npm run tauri dev
```

Con el perfil ya abierto y la página de equipo visible, desde otra terminal:

```powershell
node scripts/check-sports-tauri.mjs http://127.0.0.1:9232
```

El script conecta al WebView2 existente, exige el puente Tauri y la ventana `main`, no simula IPC ni datos y no modifica perfiles o favoritos. Recorre los cuatro clubes, verifica clasificación, once titular, más de 20 filas de plantilla, una foto cargada, partidos y palmarés con sus advertencias. Restaura la página y pestaña originales sin cerrar la aplicación. Los cuatro clubes pasaron en la instancia real; el informe es `tauri-verification.json` y las capturas son `tauri-club-*.png`, en el directorio de revisión de la página.

El puerto es únicamente de diagnóstico local: cerrar esa sesión de desarrollo y arrancar normalmente al terminar para no dejarlo habilitado. Esta verificación no concede derechos de redistribución ni garantiza disponibilidad futura del proveedor.
