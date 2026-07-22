/**
 * BuilderPage — the whole embed, in one component.
 *
 * One provider tells the workspace where the backend lives and how to prove who
 * is asking; one component is the workspace itself. Drop this into any React
 * route and you have the builder beside a live preview.
 *
 * PRE-RELEASE: `@speculos-harness/react` is published spec-first. The types and
 * signatures here are frozen to the decided public API so you can integrate
 * against them today, but the components throw `not yet implemented` until the
 * v0.1 code drop. Watch or star the repo to follow.
 */

import { HarnessProvider, Builder } from '@speculos-harness/react';
import '@speculos-harness/react/styles.css';

import { NorthwindLogo } from './NorthwindLogo';

/**
 * Your app's session token. In a real app this comes from your auth library;
 * here it is a stand-in so the header factory below has something to call.
 */
async function getToken(): Promise<string> {
  // TODO: replace with your real token source (cookie, context, auth SDK…).
  return 'your-session-token-here';
}

/**
 * A few UI labels overridden so the workspace speaks Northwind's language.
 * Pass a full string bag, or a `t()` function, to translate every label.
 */
const strings = {
  'composer.placeholder': 'Describe the view you need — e.g. "arrears by building, worst first"',
  'empty.title': 'Build a tool for Northwind',
};

export function BuilderPage({ projectId }: { projectId: string }) {
  return (
    <HarnessProvider
      // Where the agent router is mounted (see ../backend/main.py).
      baseUrl="/api/builder"
      // The runtime namespace: window.app.* + app-* bridge messages. MUST match
      // the server's `namespace="app"` and the generated apps.
      namespace="app"
      // Client auth: attach identity to every request the workspace makes —
      // chat SSE, bundle, project/snapshot reads, and preview bridge fetches.
      auth={{
        getHeaders: async () => ({ Authorization: `Bearer ${await getToken()}` }),
        canEdit: true, // false => a read-only viewer (full-width preview, no chat)
      }}
      // Brand name + logo slot. The logo is a slot, never hardcoded.
      brand={{ name: 'Northwind', Logo: <NorthwindLogo /> }}
      // Label overrides; omit to use the built-in English defaults.
      strings={strings}
      // Omit `connectors` for file/package tools only. The with-connectors
      // example adds the Postgres + MCP client halves here.
    >
      <Builder
        projectId={projectId}
        layout="preview-left" // "preview-left" | "chat-left" — pane order is a prop
        filePanel="explorer"  // "explorer" | "hidden" — read-only tree + diffs + version timeline
        // Seed the first turn from a ?prompt= deep link, so a link like
        // /build?prompt=arrears+dashboard opens the workspace mid-thought.
        onFirstPrompt={() => new URLSearchParams(window.location.search).get('prompt') ?? undefined}
      />
    </HarnessProvider>
  );
}
