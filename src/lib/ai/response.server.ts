import "server-only";

export const AI_REQUEST_TIMEOUT_MS = 240_000;
export const AI_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

// fetchAiResponse bounds the complete provider exchange, including decoded body bytes and cancellation.
export async function fetchAiResponse(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  // cancelBody releases a stalled response stream when either deadline or caller aborts.
  const cancelBody = () => { void reader?.cancel().catch(() => undefined); };

  try {
    signal.throwIfAborted();
    const response = await fetch(url, { ...init, signal });
    reader = response.body?.getReader();
    signal.addEventListener("abort", cancelBody, { once: true });
    if (signal.aborted) cancelBody();
    signal.throwIfAborted();
    if (!reader) return response;

    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > AI_RESPONSE_MAX_BYTES) {
        controller.abort();
        throw new Error("AI response exceeds the allowed size.");
      }
      chunks.push(chunk.value);
    }
    return new Response(Buffer.concat(chunks, size), {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText
    });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancelBody);
    reader?.releaseLock();
  }
}
