export async function readBoundedUpstreamText(response: Response, maximumBytes: number, label: string) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) throw new Error("Upstream response bound is invalid.");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new Error(`${label} response exceeds the allowed size.`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new Error(`${label} response exceeds the allowed size.`);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function readBoundedUpstreamJson<T>(response: Response, maximumBytes: number, label: string): Promise<T> {
  const text = await readBoundedUpstreamText(response, maximumBytes, label);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} returned malformed JSON.`);
  }
}
