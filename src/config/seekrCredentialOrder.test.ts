import { beforeEach, describe, expect, it, vi } from "vitest";

const readMock = vi.hoisted(() => vi.fn());
const writeMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());

vi.mock("../auth/secureCredentialStore", () => ({
  readSecureCredential: readMock,
  writeSecureCredential: writeMock,
  deleteSecureCredential: deleteMock,
}));

import { readSeekrApiKey, saveSeekrApiKey } from "./seekr";

// El orden importa: la clave de compilacion tiene que estar disponible aunque el
// Credential Manager tarde o no responda nunca. Si no, el previsualizado se queda
// apagado sin explicar por que y la API no registra ni una llamada.
describe("orden de resolucion de la clave de Seekr", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    readMock.mockReset();
    writeMock.mockReset();
    deleteMock.mockReset();
    vi.stubEnv("VITE_SEEKR_API_KEY", "clave-de-compilacion-1234");
  });

  it("usa la clave guardada cuando responde", async () => {
    vi.stubEnv("VITE_SEEKR_API_KEY", "");
    readMock.mockResolvedValue("clave-guardada-5678");
    expect(await readSeekrApiKey()).toBe("clave-guardada-5678");
  });

  it("con clave de compilacion no toca el almacen del sistema", async () => {
    readMock.mockReturnValue(new Promise<string | null>(() => undefined));
    expect(await readSeekrApiKey()).toBe("clave-de-compilacion-1234");
    expect(readMock).not.toHaveBeenCalled();
  });

  it("cae a la clave de compilacion si el almacen falla", async () => {
    vi.stubEnv("VITE_SEEKR_API_KEY", "");
    readMock.mockRejectedValue(new Error("Credential Manager no disponible"));
    expect(await readSeekrApiKey()).toBe("");
  });

  it("cae a cadena vacia si el almacen nunca responde", async () => {
    vi.stubEnv("VITE_SEEKR_API_KEY", "");
    vi.useFakeTimers();
    readMock.mockReturnValue(new Promise<string | null>(() => undefined));
    const pending = readSeekrApiKey();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toBe("");
    vi.useRealTimers();
  });

  it("sin clave guardada ni de compilacion devuelve cadena vacia", async () => {
    vi.stubEnv("VITE_SEEKR_API_KEY", "");
    readMock.mockResolvedValue(null);
    expect(await readSeekrApiKey()).toBe("");
  });

  it("guarda en el almacen seguro, no en las preferencias", async () => {
    await saveSeekrApiKey("clave-nueva-9012");
    expect(writeMock).toHaveBeenCalledWith("seekr-api-key", "aetherio-seekr-api-key", "clave-nueva-9012");
  });
});
