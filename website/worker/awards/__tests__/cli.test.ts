import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { spawnSync, spawn } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const BACKFILL = join(ROOT, "scripts/backfill-awards.mjs");
const CAPTURE = join(ROOT, "scripts/capture-awards.mjs");
const MOCK_SERVER = join(ROOT, "mock-server.test.mjs");
const TMP_DIR = join(ROOT, ".tmp-cli-test");

interface CapturedRequest {
  method: string;
  url: string;
  auth?: string;
  body?: unknown;
}

let mockProc: ReturnType<typeof spawn>;
let baseUrl: string;
let requests: CapturedRequest[] = [];
let responder = JSON.stringify({ results: [{ ceremony: "oscar", edition: 97, ok: true, recordsImported: 12 }] });
let responderStatus = 200;

function startMock() {
  return new Promise<void>(resolveStart => {
    const env: Record<string, string> = { RESPONDER: responder, RESPONDER_STATUS: String(responderStatus) };
    mockProc = spawn("node", [MOCK_SERVER], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    mockProc.stdout?.on("data", chunk => {
      for (const text of chunk.toString().split(/\r?\n/).map((value: string) => value.trim()).filter(Boolean)) {
        if (text.startsWith("MOCK ")) {
          baseUrl = text.slice(5).trim();
          resolveStart();
        } else if (text.startsWith("REQ ")) {
          try { requests.push(JSON.parse(text.slice(4))); } catch { /* ignore */ }
        }
      }
    });
    mockProc.stderr?.on("data", () => {
      // ignore
    });
  });
}

function setResponder(status: number, body: unknown) {
  responderStatus = status;
  responder = JSON.stringify(body);
  if (mockProc?.stdin?.writable) {
    mockProc.stdin.write(`${status}\t${responder}\n`);
  }
}

function runCli(script: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("node", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    cwd: ROOT,
    timeout: 15000,
  });
  return result;
}

async function flushRequests() {
  await new Promise(resolve => setTimeout(resolve, 100));
}

beforeEach(async () => {
  requests = [];
  responderStatus = 200;
  responder = JSON.stringify({ results: [{ ceremony: "oscar", edition: 97, ok: true, recordsImported: 12 }] });
  await startMock();
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(async () => {
  await new Promise<void>(resolve => {
    if (mockProc && mockProc.pid) {
      mockProc.once("exit", () => resolve());
      mockProc.kill("SIGTERM");
    } else {
      resolve();
    }
  });
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("backfill-awards.mjs", () => {
  it("importa ediciones manuales y termina 0 cuando todas ok", () => {
    setResponder(200, { results: [{ ceremony: "oscar", edition: 63, ok: false, error: "parser_failed" }] });
    const result = runCli(BACKFILL, [
      "--base-url", baseUrl,
      "--token", "secret", "--retries", "1", "--batch", "50","--scope", "manual",
      "--ceremony", "oscar",
      "--editions", "63",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("oscar 63");
  });

  it("reintenta respuestas HTTP 500 y conserva código 0 al recuperarse", async () => {
    setResponder(500, { error: "temporary" });
    setResponder(200, { results: [{ ceremony: "oscar", edition: 63, ok: true }] });
    const result = runCli(BACKFILL, [
      "--base-url", baseUrl, "--token", "secret", "--retries", "2", "--scope", "manual",
      "--ceremony", "oscar", "--editions", "63",
    ]);
    await flushRequests();
    expect(result.status).toBe(0);
    expect(requests.filter(req => req.url === "/api/internal/awards/import").length).toBe(2);
  });

  it("--scope weekly envía payload sin targets", async () => {
    setResponder(200, { results: [{ ceremony: "oscar", edition: 97, ok: true }], editionsOk: 1 });
    const result = runCli(BACKFILL, [
      "--base-url", baseUrl,
      "--token", "secret", "--retries", "1","--scope", "weekly",
    ]);
    await flushRequests();
    expect(result.status).toBe(0);
    const importReq = requests.find(req => req.url === "/api/internal/awards/import");
    expect(importReq?.body).toMatchObject({ scope: "weekly" });
    expect((importReq?.body as { targets?: unknown }).targets).toBeUndefined();
  });

  it("--scope pending resuelve ediciones desde el coverage", async () => {
    setResponder(200, {
      byCeremony: {
        oscar: { pendingEditions: [63, 64] },
      },
    });
    setResponder(200, {
      byCeremony: {
        oscar: { pendingEditions: [63, 64] },
      },
    });
    setResponder(200, {
      results: [
        { ceremony: "oscar", edition: 63, ok: true },
        { ceremony: "oscar", edition: 64, ok: true },
      ],
    });
    const result = runCli(BACKFILL, [
      "--base-url", baseUrl,
      "--token", "secret", "--retries", "1","--scope", "pending",
    ]);
    await flushRequests();
    expect(result.status).toBe(0);
    expect(requests.some(req => req.url.startsWith("/api/awards/coverage"))).toBe(true);
    const importReq = requests.find(req => req.url === "/api/internal/awards/import");
    expect(importReq?.body).toMatchObject({
      scope: "backfill",
      targets: [{ ceremony: "oscar", edition: 63 }, { ceremony: "oscar", edition: 64 }],
    });
  });

  it("--scope manual sin ceremony/editions termina 2", () => {
    const result = runCli(BACKFILL, [
      "--base-url", baseUrl,
      "--token", "secret", "--retries", "1", "--batch", "50","--scope", "manual",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--ceremony");
  });
});

describe("capture-awards.mjs", () => {
  it("--resend reenvía la captura en disco sin abrir navegador", async () => {
    const captureDir = join(TMP_DIR, "capture-resend");
    mkdirSync(join(captureDir, "oscar"), { recursive: true });
    writeFileSync(join(captureDir, "oscar", "63.html"), "<html><body>captura ficticia suficientemente larga para pasar el check</body></html>", "utf8");
    setResponder(200, { results: [{ ceremony: "oscar", edition: 63, ok: true, recordsImported: 5 }] });
    const result = runCli(CAPTURE, [
      "--base-url", baseUrl,
      "--token", "secret",
      "--resend",
      "--out", captureDir,
      "--ceremony", "oscar",
      "--editions", "63",
    ]);
    await flushRequests();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("reenviada");
    const importReq = requests.find(req => req.url === "/api/internal/awards/import");
    expect(importReq?.body).toMatchObject({
      scope: "manual",
      targets: [{ ceremony: "oscar", edition: 63, tier: "secondary" }],
    });
  });

  it("--resend sin captura en disco termina 1", () => {
    const captureDir = join(TMP_DIR, "capture-empty");
    mkdirSync(captureDir, { recursive: true });
    const result = runCli(CAPTURE, [
      "--base-url", baseUrl,
      "--token", "secret",
      "--resend",
      "--out", captureDir,
      "--ceremony", "oscar",
      "--editions", "99",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no hay captura");
  });

  it("--tier official propaga el tier en el payload", async () => {
    const captureDir = join(TMP_DIR, "capture-tier");
    mkdirSync(join(captureDir, "bafta"), { recursive: true });
    writeFileSync(join(captureDir, "bafta", "44.html"), "<html><body>captura ficticia suficientemente larga para pasar el check</body></html>", "utf8");
    setResponder(200, { results: [{ ceremony: "bafta", edition: 44, ok: true }] });
    const result = runCli(CAPTURE, [
      "--base-url", baseUrl,
      "--token", "secret",
      "--resend",
      "--out", captureDir,
      "--ceremony", "bafta",
      "--editions", "44",
      "--tier", "official",
    ]);
    await flushRequests();
    expect(result.status).toBe(0);
    const importReq = requests.find(req => req.url === "/api/internal/awards/import");
    expect(importReq?.body).toMatchObject({
      targets: [{ ceremony: "bafta", edition: 44, tier: "official" }],
    });
  });

  it("--no-post --resend no requiere token ni envía al importador", () => {
    const captureDir = join(TMP_DIR, "capture-nopost");
    mkdirSync(join(captureDir, "oscar"), { recursive: true });
    writeFileSync(join(captureDir, "oscar", "63.html"), "<html><body>captura ficticia</body></html>", "utf8");
    const result = runCli(CAPTURE, [
      "--base-url", baseUrl,
      "--resend",
      "--no-post",
      "--out", captureDir,
      "--ceremony", "oscar",
      "--editions", "63",
    ]);
    expect(result.status).toBe(0);
    expect(requests.some(req => req.url === "/api/internal/awards/import")).toBe(false);
  });
});
