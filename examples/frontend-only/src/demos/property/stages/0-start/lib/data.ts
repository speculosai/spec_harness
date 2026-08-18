/**
 * The only way this app reaches data.
 *
 * There is no HTTP here and no imported fixture: `window.app.data` is installed in the
 * preview frame by the connector shim, and each call is a postMessage the parent
 * answers. Neither helper ever throws - a failure arrives as an `error` alongside an
 * empty result, so a bad table name renders an empty state instead of a crash card.
 */

/** The runtime the preview injects. `app` is the namespace this workspace is bound to. */
interface DataBridge {
  query(table: string): Promise<{ rows?: unknown[]; error?: string }>;
  call(name: string, args?: Record<string, unknown>): Promise<{ result?: unknown; error?: string }>;
}

function bridge(): DataBridge {
  return (window as unknown as { app: { data: DataBridge } }).app.data;
}

/** Read a whole table. */
export async function query<T>(table: string): Promise<{ rows: T[]; error?: string }> {
  const answer = await bridge().query(table);
  return { rows: Array.isArray(answer.rows) ? (answer.rows as T[]) : [], error: answer.error };
}

/** Take an action. Re-read the table afterwards to see what it changed. */
export async function call<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ result: T | null; error?: string }> {
  const answer = await bridge().call(name, args);
  return { result: (answer.result ?? null) as T | null, error: answer.error };
}
