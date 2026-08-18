/**
 * One demo's workspace: the whole embed, in one component.
 *
 * This is the same integration as `examples/minimal/web/BuilderPage.tsx` - one
 * provider saying where the backend is and who is asking, one component that is the
 * workspace - with two differences, and both are because there is no backend here:
 * the base URL points at the in-browser mock, and there is no project lifecycle to run
 * because the mock seeds each demo's project at startup.
 */

import { Builder, HarnessProvider } from '@speculosai/spec_harness';

import type { VerticalDemo } from './mock/types';

/** Props for {@link DemoPage}. */
export interface DemoPageProps {
  /** The demo to open. */
  demo: VerticalDemo;
}

/**
 * No token, no header: the mock backend has no notion of identity. In a real
 * deployment this is where your session token goes, and it is attached to every
 * request the workspace makes - chat SSE, bundle, project reads, bridge fetches.
 */
const auth = { getHeaders: () => ({}), canEdit: true };

export function DemoPage({ demo }: DemoPageProps) {
  return (
    <HarnessProvider
      // Each demo gets its own route namespace under the mocked API. It is a relative
      // path, so the page and its "backend" share an origin by construction.
      baseUrl={`/demo-api/${demo.definition.id}`}
      // The runtime namespace: `window.app.*` and `app-*` bridge messages. It must
      // match what the mock advertises in `/capabilities` and what the stage apps call.
      namespace="app"
      auth={auth}
      // The logo slot carries this demo's mark and the link back to the other two.
      brand={demo.brand}
      strings={demo.strings}
    >
      <Builder
        projectId={demo.definition.projectId}
        layout="chat-left"
        filePanel="explorer"
      />
    </HarnessProvider>
  );
}
