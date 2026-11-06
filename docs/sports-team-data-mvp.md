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
