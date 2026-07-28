/**
 * BuilderPage - the whole embed, in one component.
 *
 * One provider tells the workspace where the backend lives and how to prove who
 * is asking; one component is the workspace itself. Drop this into any React
 * route and you have the builder beside a live preview.
 *
 * The only part your own app would do differently is the top of this file: a real
 * product already knows which project it is opening and already has a session
 * token. The example has neither, so it opens (or creates) a project through the
 * router's `/projects` endpoints and reads an optional token from the environment.
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { HarnessProvider, Builder } from '@speculosai/spec_harness';
import '@speculosai/spec_harness/styles.css';
import { PROTOCOL_HEADER, PROTOCOL_VERSION } from '@speculosai/spec_harness/protocol';
import type { Project } from '@speculosai/spec_harness/protocol';

import { NorthwindLogo } from './NorthwindLogo';

/**
 * Where the agent router is mounted (see ../backend/main.py). It is a relative
 * path on purpose: the Vite dev server proxies this prefix to the agent, so the
 * page and the API share an origin and no CORS preflight is ever needed.
 */
const BASE_URL = '/api/builder';

/**
 * The runtime namespace: `window.app.*` and `app-*` bridge messages. It MUST match
 * the server's `namespace="app"`. Disagree and the preview still loads, the app
 * still renders, and every data call silently returns nothing.
 */
const NAMESPACE = 'app';

/** The starter template a newly created project is seeded from. */
const TEMPLATE = 'react-ts';

/**
 * Your app's session token, and the header factory the workspace calls on every
 * request it makes - chat SSE, bundle, project and snapshot reads, and the
 * preview's data fetches.
 *
 * The example reads `VITE_HARNESS_TOKEN` and sends nothing when it is unset,
 * which is the right pairing for the backend's single-user default (every request
 * resolves to one local editing user). Point it at your auth library - a cookie,
 * a context, an SDK call - the moment you put a real `AuthProvider` on the server.
 */
async function getHeaders(): Promise<Record<string, string>> {
  const token = import.meta.env.VITE_HARNESS_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * A few UI labels overridden so the workspace speaks Northwind's language.
 * Pass a full string bag, or a `t()` function, to translate every label.
 */
const strings = {
  'composer.placeholder': 'Describe the view you need - e.g. "arrears by building, worst first"',
  'empty.title': 'Build a tool for Northwind',
};

/* ------------------------------------------------------------------------- *
 * Opening a project
 *
 * The workspace itself never creates projects - it edits one you name. These few
 * calls are the lifecycle around it, and they are plain `fetch`: the same headers
 * the provider attaches, against the same mounted router.
 * ------------------------------------------------------------------------- */

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      // Every request states the protocol it speaks; the response carries it back.
      [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(await getHeaders()),
    },
    // Bearer mode: nothing rides on cookies. See spec/security.md for the
    // cookie-mode recipe and what it requires cross-origin.
    credentials: 'omit',
  });
}

/** Read the router's own error message out of a failed response. */
async function failureOf(response: Response): Promise<Error> {
  const body: unknown = await response.json().catch(() => null);
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const detail = raw.error ?? raw.detail ?? raw.message;
  const message = typeof detail === 'string' && detail ? detail : `HTTP ${response.status}`;
  return new Error(message);
}

/** Fetch one project, or `null` when the id is unknown. */
async function loadProject(id: string): Promise<Project | null> {
  const response = await call(`/projects/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await failureOf(response);
  return (await response.json()) as Project;
}

/** The caller's projects, newest write first. Scoped server-side to their `Principal`. */
async function listProjects(): Promise<Project[]> {
  const response = await call('/projects');
  if (!response.ok) throw await failureOf(response);
  const body: unknown = await response.json();
  const projects = Array.isArray(body) ? (body as Project[]) : [];
  return projects
    .slice()
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}

/** Create a project seeded from the starter template. The server assigns the id. */
async function createProject(): Promise<Project> {
  const response = await call('/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Northwind workspace', template: TEMPLATE }),
  });
  if (!response.ok) throw await failureOf(response);
  return (await response.json()) as Project;
}

/**
 * Open the project the URL asked for, the most recent one, or a brand new one -
 * in that order.
 *
 * The id in `?project=` is a *request*, not a promise: ids are assigned by the
 * store, so a link to a project that no longer exists opens a fresh workspace
 * rather than a dead one.
 */
async function resolveProject(requested?: string): Promise<Project> {
  if (requested) {
    const existing = await loadProject(requested);
    if (existing) return existing;
  }
  if (!requested) {
    // Reopening the page should land you back where you were, not pile up an
    // empty project per reload.
    const [newest] = await listProjects();
    if (newest) return newest;
  }
  return createProject();
}

/** Put the resolved id in the URL, so a reload and a shared link open the same workspace. */
function rememberProject(id: string): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get('project') === id) return;
  url.searchParams.set('project', id);
  window.history.replaceState(null, '', url);
}

/** Seed the first turn from a `?prompt=` deep link, e.g. `/?prompt=arrears+dashboard`. */
function firstPrompt(): string | undefined {
  return new URLSearchParams(window.location.search).get('prompt') ?? undefined;
}

/* ------------------------------------------------------------------------- *
 * The page
 * ------------------------------------------------------------------------- */

/** Centered copy for the two states that are not the workspace. */
function Notice(props: { title: string; body?: string; children?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 24,
        textAlign: 'center',
        color: '#344054',
      }}
    >
      <strong style={{ fontSize: 15 }}>{props.title}</strong>
      {props.body ? <span style={{ color: '#667085', maxWidth: 460 }}>{props.body}</span> : null}
      {props.children}
    </div>
  );
}

export function BuilderPage({ projectId }: { projectId?: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // StrictMode runs mount effects twice in development. Without a guard the second
  // run would create a second project - the one side effect here that is not idempotent.
  const opened = useRef<string | null>(null);
  const openKey = `${projectId ?? ''}#${attempt}`;

  useEffect(() => {
    if (opened.current === openKey) return;
    opened.current = openKey;
    let cancelled = false;

    void (async () => {
      try {
        const resolved = await resolveProject(projectId);
        if (cancelled) return;
        rememberProject(resolved.id);
        setProject(resolved);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openKey, projectId]);

  if (error) {
    return (
      <Notice
        title="The builder could not be reached"
        body={`${error}. The agent should be answering at ${BASE_URL} - check that the backend and the bundler are running.`}
      >
        <button
          type="button"
          onClick={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
          style={{ marginTop: 8, padding: '6px 14px', borderRadius: 8, cursor: 'pointer' }}
        >
          Try again
        </button>
      </Notice>
    );
  }

  if (!project) return <Notice title="Opening the Northwind workspace…" />;

  return (
    <HarnessProvider
      // Where the agent router is mounted (see ../backend/main.py).
      baseUrl={BASE_URL}
      // The runtime namespace: window.app.* + app-* bridge messages. MUST match
      // the server's `namespace="app"` and the generated apps.
      namespace={NAMESPACE}
      // Client auth: attach identity to every request the workspace makes -
      // chat SSE, bundle, project/snapshot reads, and preview bridge fetches.
      auth={{
        getHeaders,
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
        projectId={project.id}
        layout="preview-left" // "preview-left" | "chat-left" - pane order is a prop
        filePanel="explorer"  // "explorer" | "hidden" - read-only tree + diffs + version timeline
        // Seed the first turn from a ?prompt= deep link, so a link like
        // /build?prompt=arrears+dashboard opens the workspace mid-thought.
        onFirstPrompt={firstPrompt}
      />
    </HarnessProvider>
  );
}
