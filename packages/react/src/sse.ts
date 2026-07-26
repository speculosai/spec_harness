/**
 * The server-sent-event reader for `POST {base}/chat`.
 *
 * The chat response is a hand-rolled SSE stream (`event: <name>\n` + `data: <json>\n\n`),
 * not the Vercel AI SDK data-stream protocol, and it arrives on a POST - which is why
 * this reads a `fetch` body rather than using `EventSource`, a transport that cannot
 * POST at all.
 *
 * Framing is separate from meaning on purpose: this module knows about blocks and
 * fields, and nothing about the seven event names.
 */

/** One decoded event: its `event:` name and its parsed `data:` object. */
export interface SseEvent {
  /** The SSE event name. */
  event: string;
  /** The parsed JSON payload; `{}` when the payload was empty. */
  data: Record<string, unknown>;
}

/**
 * Parse one `\n\n`-delimited block. Returns `null` for a comment-only block, a block
 * with no `event:` line, or a payload that is not JSON - a malformed frame is skipped
 * rather than allowed to tear down the turn.
 */
export function parseSseBlock(block: string): SseEvent | null {
  let event = '';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    // `:` opens a comment, which is how a server keeps a proxy from timing the
    // stream out. It carries no payload.
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    // Per SSE, exactly one leading space after the colon is part of the framing.
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (!event) return null;
  try {
    const parsed: unknown = JSON.parse(dataLines.join('\n') || '{}');
    return {
      event,
      data: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {},
    };
  } catch {
    return null;
  }
}

/**
 * Read a response body as a sequence of SSE events.
 *
 * A chunk boundary can fall anywhere, including mid-event and mid-multibyte-character,
 * so the tail of the buffer is carried forward and the decoder streams. The final
 * partial block is emitted at EOF: the stream truly ends on reader EOF, and `done` is
 * only advisory.
 */
export async function* readSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // Normalize on the accumulated buffer, not on the chunk: a CRLF can straddle a
      // chunk boundary, and a half-normalized buffer never grows the `\n\n` that
      // separates two events - the whole turn would then arrive as one dead frame.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        if (!block.trim()) continue;
        const parsed = parseSseBlock(block);
        if (parsed) yield parsed;
      }
    }
    // Flush any half-decoded multi-byte character, then emit the last block: a
    // server that ends without a trailing blank line still delivers its final event.
    buffer = (buffer + decoder.decode()).replace(/\r\n/g, '\n');
    if (buffer.trim()) {
      const parsed = parseSseBlock(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    // An abort mid-turn must not leave the body locked to a reader nobody holds.
    reader.releaseLock();
  }
}
