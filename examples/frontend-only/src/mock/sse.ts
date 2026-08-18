/**
 * The server half of the SSE wire: framing, deterministic chunking, and a paced
 * `ReadableStream` player.
 *
 * The framing is the hand-rolled one from `spec/chat-protocol.md` -
 * `event: <name>\n` + `data: <json>\n\n` - not the Vercel AI SDK data-stream protocol,
 * because that is what `@speculosai/spec_harness`'s reader parses. Nothing in here is
 * browser-specific: `ReadableStream`, `TextEncoder` and timers are all available under
 * Node, which is how the conformance check runs this same code.
 */

/** How fast a turn plays. `instant` is for the conformance check, which reads at full speed. */
export type Pacing = 'live' | 'instant';

/** One frame to emit: an event name, its payload, and how long to wait first. */
export interface SseFrame {
  /** The SSE `event:` name - one of the protocol's seven. */
  event: string;
  /** The `data:` payload, JSON-encoded on the way out. */
  data: unknown;
  /** Milliseconds to wait before enqueuing this frame. */
  delayMs?: number;
}

/** Encode one frame. Exported so the conformance check can assert on exact bytes. */
export function encodeSseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Split text into 2-6 word chunks whose concatenation is byte-for-byte the input.
 *
 * Whitespace runs are preserved as their own tokens rather than re-joined, so a
 * paragraph break inside `after` survives the trip. The chunk sizes cycle through a
 * fixed sequence: the result has to be identical on every run, so nothing here draws
 * a random number (the conformance check greps the sources to make sure).
 */
export function chunkWords(text: string): string[] {
  if (!text) return [];
  const runs = text.match(/\s+|\S+/g) ?? [];
  const sizes = [3, 5, 2, 4, 6];
  const chunks: string[] = [];
  let current = '';
  let words = 0;
  let sizeIndex = 0;

  for (const run of runs) {
    current += run;
    if (/\S/.test(run)) words += 1;
    if (words >= sizes[sizeIndex % sizes.length]) {
      chunks.push(current);
      current = '';
      words = 0;
      sizeIndex += 1;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Split a string into fixed-size pieces. Used for tool-argument deltas. */
export function chunkChars(text: string, size: number): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let at = 0; at < text.length; at += size) chunks.push(text.slice(at, at + size));
  return chunks;
}

/** Sleep, unless the caller already gave up. */
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    }
    signal?.addEventListener('abort', finish, { once: true });
  });
}

/** Options for {@link playFrames}. */
export interface PlayOptions {
  /** Aborts the turn: stop emitting, then run `onFinish` anyway. */
  signal?: AbortSignal | null;
  /**
   * Run once, whether the stream ended, was aborted, or was cancelled. This is the
   * mock's version of the reference agent's `finally` guard: the turn is persisted
   * even when the reader walks away mid-sentence.
   */
  onFinish?: () => void;
  /**
   * Run for each frame that actually made it into the stream.
   *
   * The difference between "yielded" and "sent" is the whole reason this exists: a
   * frame is pulled from the generator, then waited on, then enqueued, and an abort
   * can land in the middle. Side effects that the reader must have seen - advancing
   * the project to the next stage on the first tool result - belong here, not in the
   * generator, or a stopped turn moves the backend somewhere the client never went.
   */
  onSent?: (frame: SseFrame) => void;
}

/**
 * Play a sequence of frames into a `ReadableStream<Uint8Array>`, honouring each
 * frame's delay.
 *
 * Frames are pulled lazily, so the generator's own side effects (advancing the project
 * to the next stage on the first tool result, say) happen in stream order rather than
 * all at once up front.
 */
export function playFrames(frames: AsyncIterable<SseFrame>, opts: PlayOptions = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = frames[Symbol.asyncIterator]();
  let finished = false;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    opts.onFinish?.();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      if (opts.signal?.aborted) {
        finish();
        controller.close();
        return;
      }
      const next = await iterator.next();
      if (next.done) {
        finish();
        controller.close();
        return;
      }
      await sleep(next.value.delayMs ?? 0, opts.signal);
      if (opts.signal?.aborted) {
        finish();
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(encodeSseFrame(next.value.event, next.value.data)));
      opts.onSent?.(next.value);
    },
    cancel() {
      finish();
      void iterator.return?.(undefined);
    },
  });
}
