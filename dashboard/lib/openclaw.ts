const OPENCLAW_BASE_URL =
  process.env.OPENCLAW_BASE_URL || "http://localhost:3420";

export async function* sendMessage(
  sessionKey: string,
  message: string
): AsyncGenerator<string> {
  const response = await fetch(`${OPENCLAW_BASE_URL}/api/v1/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionKey,
      message,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenClaw API error: ${response.status} ${response.statusText}`
    );
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events from buffer
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") return;

        try {
          const parsed = JSON.parse(data);
          if (parsed.content) {
            yield parsed.content;
          }
        } catch {
          // Non-JSON data line, yield raw
          if (data.trim()) yield data;
        }
      }
    }
  }

  // Process remaining buffer
  if (buffer.startsWith("data: ")) {
    const data = buffer.slice(6);
    if (data !== "[DONE]" && data.trim()) {
      try {
        const parsed = JSON.parse(data);
        if (parsed.content) yield parsed.content;
      } catch {
        yield data;
      }
    }
  }
}
