/** Helpers para simular la respuesta SSE de POST /assistant/ask en tests. */

export const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** Respuesta 200 cuyo body entrega los chunks dados, uno por read(). */
export function streamResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  const queue = chunks.map((c) => encoder.encode(c));
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader: () => ({
        read: async () =>
          queue.length > 0 ? { done: false, value: queue.shift() } : { done: true, value: undefined },
      }),
    },
  };
}

export const httpResponse = (status: number) => ({ ok: false, status, body: null });
