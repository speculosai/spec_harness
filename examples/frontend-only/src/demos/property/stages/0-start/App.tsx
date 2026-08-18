/**
 * The starter workspace: what a brand-new project renders before anything is asked of
 * it.
 *
 * It paints on the first frame and reads nothing - the preview flags an app that shows
 * nothing after a second and a half as broken, and an empty starter is not broken.
 */
export function App() {
  return (
    <main className="min-h-screen bg-stone-50 px-6 py-12 text-stone-900">
      <div className="mx-auto max-w-lg rounded-lg border border-stone-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 8.5 8 3.5l6 5V14H2V8.5Z" fill="none" stroke="#047857" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">
            Northwind Property Group
          </p>
        </div>

        <h1 className="mt-3 text-base font-semibold">This workspace is ready</h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">
          Pick a suggestion in the chat to build your first tool. Whatever gets written lands here,
          running, a second or two later.
        </p>

        <p className="mt-4 border-t border-stone-100 pt-4 text-sm text-stone-500">
          Four buildings, thirty places, one set of records. Nothing is on screen yet because nobody
          has asked a question yet.
        </p>
      </div>
    </main>
  );
}
