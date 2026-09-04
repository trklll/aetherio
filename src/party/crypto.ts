// Cifrado de extremo a extremo para salas Party con contraseña.
//
// Modelo: la contraseña se comparte FUERA de la app (DM, boca a boca). El
// servidor nunca la ve: solo guarda un `probe` cifrado para que el invitado
// verifique si acertó. Se cifra chat + contenido + stream (qué ven, qué dicen,
// qué enlace). Controles (play/pausa) y presencia quedan en claro: revelan
// *cuándo* pasa algo, no *qué*.
// Límites honestos: sin secreto perfecto hacia adelante y sin defensa contra
// un operador activamente malicioso que inyecte miembros falsos (los nombres
// ya son autodeclarados). Protege contra curiosos y registros pasivos.

const PBKDF2_ITERATIONS = 600_000;
const PROBE_PLAINTEXT = "aetherio-party-probe-v1";

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto no disponible en este dispositivo.");
  return subtle;
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromBase64(raw: string): Uint8Array {
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Clave AES-GCM-256 derivada de (contraseña + código de sala). */
export async function deriveRoomKey(password: string, code: string): Promise<CryptoKey> {
  const subtle = getSubtle();
  const base = await subtle.importKey("raw", encode(password), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encode(`aetherio-party-v1:${code.toUpperCase()}`),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Cifra un JSON → "iv.ciphertext" (base64). IV aleatorio por mensaje. */
export async function encryptRoomJson(key: CryptoKey, payload: unknown): Promise<string> {
  const subtle = getSubtle();
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const cipher = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, encode(JSON.stringify(payload))));
  return `${toBase64(iv)}.${toBase64(cipher)}`;
}

/** Descifra "iv.ciphertext" → JSON. Lanza si la contraseña es wrong o se manipuló. */
export async function decryptRoomJson<T>(key: CryptoKey, envelope: string): Promise<T> {
  const subtle = getSubtle();
  const dot = envelope.indexOf(".");
  if (dot <= 0) throw new Error("formato inválido");
  const iv = fromBase64(envelope.slice(0, dot));
  const cipher = fromBase64(envelope.slice(dot + 1));
  const plain = await subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return JSON.parse(decode(new Uint8Array(plain))) as T;
}

/** Probe que el anfitrión deja en la sala para verificar contraseñas. */
export function createRoomProbe(key: CryptoKey): Promise<string> {
  return encryptRoomJson(key, { probe: PROBE_PLAINTEXT });
}

export async function verifyRoomProbe(key: CryptoKey, probe: string): Promise<boolean> {
  try {
    const data = await decryptRoomJson<{ probe?: string }>(key, probe);
    return data?.probe === PROBE_PLAINTEXT;
  } catch {
    return false;
  }
}

/** Identidad efímera por sala y miembro (ECDSA P-256). Solo la pública viaja. */
export async function generateRoomIdentity(): Promise<{ spkiB64: string }> {
  const subtle = getSubtle();
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const spki = new Uint8Array(await subtle.exportKey("spki", pair.publicKey));
  return { spkiB64: toBase64(spki) };
}

export interface IdentityFingerprint {
  /** 16 hex legibles: "ab12 cd34 ef56 7890". */
  short: string;
  /** SHA-256 completo en hex. */
  full: string;
}

/** Fingerprint de una pública: lo que se compara fuera de banda (estilo Signal). */
export async function fingerprintIdentity(spkiB64: string): Promise<IdentityFingerprint> {
  const subtle = getSubtle();
  const digest = new Uint8Array(await subtle.digest("SHA-256", fromBase64(spkiB64)));
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  const short = [0, 1, 2, 3].map(i => hex.slice(i * 4, i * 4 + 4)).join(" ");
  return { short, full: hex };
}
