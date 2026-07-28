import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const signaturePath = process.argv[2];
if (!signaturePath) {
  console.error("Usage: node scripts/verify-updater-signature.mjs <installer.sig>");
  process.exit(2);
}

const config = JSON.parse(readFileSync(resolve("src-tauri/tauri.conf.json"), "utf8"));
const configuredPublicKey = String(config?.plugins?.updater?.pubkey ?? "").trim();
const signature = readFileSync(resolve(signaturePath), "utf8").trim();

const configuredKeyId = readKeyIdFromPublicKey(configuredPublicKey);
const signatureKeyId = readKeyIdFromSignature(signature);

if (configuredKeyId !== signatureKeyId) {
  console.error(
    `Updater key mismatch: app expects ${configuredKeyId}, release was signed by ${signatureKeyId}.`,
  );
  process.exit(1);
}

console.log(`Updater signature key verified: ${configuredKeyId}`);

function readKeyIdFromPublicKey(encodedPublicKey) {
  const publicKeyText = decodeBase64Text(encodedPublicKey, "configured public key");
  const lines = publicKeyText.split(/\r?\n/);
  if (lines.length < 2 || !lines[0].startsWith("untrusted comment: minisign public key:")) {
    throw new Error("Configured updater public key is not a valid minisign public key.");
  }
  return readKeyIdFromPacket(lines[1], "configured public key packet");
}

function readKeyIdFromSignature(encodedSignature) {
  const signatureText = decodeBase64Text(encodedSignature, "updater signature");
  const lines = signatureText.split(/\r?\n/);
  if (lines.length < 4 || !lines[0].startsWith("untrusted comment:")) {
    throw new Error("Updater signature is not a valid Tauri minisign signature.");
  }
  return readKeyIdFromPacket(lines[1], "signature packet");
}

function readKeyIdFromPacket(encodedPacket, label) {
  const packet = Buffer.from(encodedPacket.trim(), "base64");
  if (packet.length < 10) throw new Error(`${label} is too short.`);
  return Buffer.from(packet.subarray(2, 10)).reverse().toString("hex").toUpperCase();
}

function decodeBase64Text(value, label) {
  if (!value) throw new Error(`${label} is empty.`);
  return Buffer.from(value, "base64").toString("utf8");
}
