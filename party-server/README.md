# Aetherio Party — servidor de salas

Relay mínimo para el modo Party: retransmite eventos de control (play/pausa/seek),
cambios de contenido y chat. **No maneja video ni streams**: cada app resuelve su
propio stream con sus addons.

## Desplegar

```bash
cd party-server
npm install
npx wrangler login
npm run deploy
```

Anota la URL pública, p. ej. `https://aetherio-party.<tu-cuenta>.workers.dev`, y
ponla en la app como variable de entorno:

```bash
VITE_PARTY_SERVER_URL=https://aetherio-party.<tu-cuenta>.workers.dev
# O varios (anti-DoS: la app elige el primero sano y permite migrar):
VITE_PARTY_SERVER_URLS=https://party.tu-dominio.dev,https://aetherio-party.otro.workers.dev
```

Sin esas variables la app usa `https://party.aetherio.workers.dev` por defecto.

## API

- `POST /party/create` `{ media?, name? }` → `{ code }` (código de 6 caracteres).
- `GET /party/:CODE/socket?name=...` → WebSocket con el protocolo de
  `src/party/protocol.ts` (mensajes `hello/control/media/stream/presence/chat/ping`).
  `stream` comparte el puntero exacto (URL https o magnet) para que todos vean
  la misma fuente; el saneo (nada local/privado, sin credenciales) lo hace el
  cliente y el servidor aplica topes de forma y tamaño. `presence` avisa si
  alguien está en buffering para pausar al grupo.
- `GET /health` → `{ ok: true }`.

## Notas

- El dueño es el primer miembro; si se va, el dueño migra al miembro más
  antiguo. La sala muere cuando queda vacía.
- Endurecer más tarde: validar el token de cuenta Aetherio en `hello`
  (hoy el nombre es autodeclarado) y rate-limit de chat en el DO.

## Modelo de amenazas (operador malicioso)

El servidor es una app abierta que cualquiera puede desplegar, así que se
asume operador curioso o malicioso:

- **Contenido**: en salas con contraseña, chat, contenido, stream, controles y
  presencia viajan cifrados (AES-GCM, clave PBKDF2 de contraseña+código que el
  servidor nunca ve). Sin la contraseña no se puede leer ni forjar nada.
- **Anti-downgrade**: si diste contraseña y el servidor dice que la sala no es
  cifrada, el cliente aborta en vez de hablar en claro. Al crear se exige que
  el servidor confirme el código pedido.
- **Anti-replay**: todo evento lleva sello `at` del servidor y el cliente solo
  acepta sellos frescos (±120s/30s) y estrictamente crecientes por peer.
- **Miembros fantasma**: cada miembro genera identidad efímera ECDSA por sala;
  el panel muestra su fingerprint para comparar fuera de banda (estilo Signal).
  Sin la contraseña, un fantasma no puede emitir nada válido en salas cifradas.
- **URLs maliciosas**: solo se aplica la oferta de stream del anfitrión (se
  ignoran las de no-owners); en cifradas además solo vale el sobre cifrado.
- **Griefing**: rate-limit (>8 controles/10s = mute 60s + aviso).
- **Límites**: sin forward secrecy; sin defensa contra inyección de miembros
  falsos más allá de la verificación manual; la contraseña debe ser fuerte
  (mínimo 4 caracteres, mejor 4+ palabras) porque un operador con los sobres
  puede intentar adivinarla offline.
