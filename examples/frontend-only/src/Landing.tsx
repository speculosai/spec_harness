/**
 * The landing page: three companies, three tools, one click each.
 *
 * Every word of card copy comes from the registry (`card` in each demo's `script.ts`),
 * so the page and the demo can never say different things about the same vertical.
 * The only thing this file authors is the frame around them.
 *
 * It is styled as a technical document rather than a marketing site, on purpose: the
 * reader is a developer deciding whether an embedded builder is worth their time, and
 * the fastest way to lose them is to sell.
 */

import type { CSSProperties } from 'react';

import { demos } from './demos/registry';

/** Where the repository lives, for the two pointers in the footer. */
const REPO = 'https://github.com/speculosai/spec_harness/tree/main';

/**
 * The signature mark: a preview pane beside a chat pane, small enough to read as a
 * glyph. It opens every card, tinted the vertical's accent, and it is the one shape
 * this page repeats.
 */
function WorkspaceGlyph() {
  return (
    <svg className="glyph" viewBox="0 0 64 40" width="64" height="40" aria-hidden="true" focusable="false">
      <rect x="0.75" y="0.75" width="62.5" height="38.5" rx="4" fill="none" stroke="currentColor" strokeOpacity="0.35" />
      <line x1="38" y1="1" x2="38" y2="39" stroke="currentColor" strokeOpacity="0.2" />
      {/* the preview: a heading and three bars */}
      <rect x="6" y="8" width="20" height="3" rx="1.5" fill="currentColor" opacity="0.2" />
      <rect x="6" y="16" width="5" height="16" rx="1" fill="currentColor" opacity="0.8" />
      <rect x="14" y="21" width="5" height="11" rx="1" fill="currentColor" opacity="0.55" />
      <rect x="22" y="25" width="5" height="7" rx="1" fill="currentColor" opacity="0.35" />
      {/* the chat: three runs of text and a choice chip */}
      <rect x="43" y="9" width="15" height="2.5" rx="1.25" fill="currentColor" opacity="0.45" />
      <rect x="43" y="14" width="11" height="2.5" rx="1.25" fill="currentColor" opacity="0.3" />
      <rect x="43" y="19" width="14" height="2.5" rx="1.25" fill="currentColor" opacity="0.45" />
      <rect x="43" y="28" width="14" height="5" rx="2.5" fill="currentColor" opacity="0.85" />
    </svg>
  );
}

export function Landing() {
  return (
    <div className="landing">
      <div className="landing-inner">
        <header className="masthead">
          <p className="wordmark">Speculos Harness</p>
          <p className="eyebrow">examples / frontend-only</p>
          <h1>Three companies, three tools their dashboard could never be</h1>
          <div className="lede">
            <p>
              Three guided demos of the real workspace - the same <code>&lt;HarnessProvider&gt;</code> and{' '}
              <code>&lt;Builder&gt;</code> you would embed in your own product - against a mock backend that
              lives in this page. The agent is a script and the data is made up; the wire protocol, the
              files, and the sandboxed preview are real.
            </p>
            <p>
              No key, no server. Click the chips, watch each tool get built, and press the button at the end
              that changes the data - the one thing a dashboard can&#39;t do.
            </p>
          </div>
        </header>

        <main>
          <h2 className="section-heading">The demos</h2>
          <ul className="cards">
            {demos.map((demo, index) => {
              const { card, definition } = demo;
              return (
                <li key={definition.id} className="card" style={{ '--accent': card.accent } as CSSProperties}>
                  <div className="card-mark">
                    <WorkspaceGlyph />
                  </div>
                  <p className="eyebrow">
                    {String(index + 1).padStart(2, '0')} / {definition.id}
                  </p>
                  <h3>{card.title}</h3>
                  <p className="company">{card.company}</p>

                  <p className="label">Why they build their own</p>
                  <p className="body">{card.why}</p>

                  <p className="label">Why not a dashboard</p>
                  <p className="body">{card.dashboard}</p>

                  <p className="label">What you click through</p>
                  <ol className="steps">
                    {card.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>

                  <a className="open" href={`#/${definition.id}`}>
                    Open the demo
                    <span aria-hidden="true"> &#8594;</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </main>

        <footer className="colophon">
          <h2 className="section-heading">How this works</h2>
          <p className="body">
            A patched <code>fetch</code> answers everything under <code>/demo-api/</code> from memory, and it
            speaks the real protocol: the seven server-sent chat events, <code>write_file</code> tool calls
            built by diffing one prebuilt version of the app against the next, the preview&#39;s postMessage
            data bridge, snapshots and rollback. If the mock were wrong about any of it, the workspace would
            notice - which is the point of running the real client against it.{' '}
            <a href={`${REPO}/examples/frontend-only/README.md`}>examples/frontend-only/README.md</a> explains
            how a demo is written; <a href={`${REPO}/examples/minimal`}>examples/minimal</a> is the same
            workspace with a real agent, a real build service and a real model behind it.
          </p>
        </footer>
      </div>
    </div>
  );
}
