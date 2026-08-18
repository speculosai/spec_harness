/**
 * The starter workspace: what a brand-new project renders before anything is asked of
 * it. It paints on the first frame - the preview reports an app that shows nothing
 * after a second and a half as broken, and an empty starter is not broken.
 */
export function App() {
  return (
    <main className="min-h-screen bg-stone-50 px-6 py-10">
      <div className="mx-auto max-w-lg rounded-lg border border-stone-200 bg-white p-6">
        <p className="text-xs font-medium uppercase tracking-widest text-indigo-700">Bluebell Goods</p>
        <h1 className="mt-2 text-base font-semibold text-stone-900">This workspace is ready</h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">
          Pick a suggestion in the chat to build your first tool. Whatever gets written lands here,
          running, a second or two later.
        </p>
      </div>
    </main>
  );
}
