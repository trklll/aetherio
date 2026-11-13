import { invokeCommand, isTauriRuntime } from "../runtime/platform.ts";

interface ProviderHttpResponse {
  status: number;
  statusText?: string;
  bodyBase64: string;
}

export interface AddonStreamRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface AddonStreamPayload {
  json: any;
  status: number;
}

function decodeBase64Text(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
}

function assertSuccessfulStatus(status: number, statusText?: string) {
  if (status < 200 || status >= 300) {
    throw new Error(`HTTP ${status}${statusText ? ` ${statusText}` : ""}`);
  }
}

export async function fetchAddonStreamPayload(
  url: string,
  options: AddonStreamRequestOptions = {},
): Promise<AddonStreamPayload> {
  throwIfAborted(options.signal);

  if (isTauriRuntime()) {
    const response = await invokeCommand<ProviderHttpResponse>("provider_http_request", {
      request: {
        url,
        method: "GET",
        headers: { Accept: "application/json" },
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      },
    });
    throwIfAborted(options.signal);
    assertSuccessfulStatus(response.status, response.statusText);
    return { json: JSON.parse(decodeBase64Text(response.bodyBase64)), status: response.status };
  }

  const response = await fetch(url, {
    signal: options.signal,
    headers: { Accept: "application/json" },
  });
  assertSuccessfulStatus(response.status, response.statusText);
  return { json: await response.json(), status: response.status };
}
