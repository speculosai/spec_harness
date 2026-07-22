# Security model

Speculos Harness runs code an AI wrote, from input it does not control, next to a
user's real data. That sentence is the whole threat model. This document states
what the system defends against, how, and — honestly — what residual risk
remains. Several invariants here are non-negotiable, and the reference
implementations carry a startup self-check that refuses to run when one is
violated.

The CTO question is "you're running AI-written code — where, and what can it
touch?" The answer has three parts: the generated code is isolated, the model's
untrusted inputs are contained but not fully neutralized, and the credentials
never leave the server.

## Threat 1 — untrusted generated code

The generated app is written by a model and must be assumed hostile or, more
often, buggy in a way that behaves hostilely. It is contained by the **null-origin
sandbox** described in [preview-bridge.md](./preview-bridge.md).

- The app runs in a `srcdoc` iframe with a **null origin** — no access to the host
  page's cookies, storage, or DOM.
- The `sandbox` attribute is fixed and load-bearing:
  `allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-top-navigation-by-user-activation`.
- **`allow-same-origin` MUST NOT be added** — it would hand the frame the host's
  origin and defeat the isolation entirely. This is the single most important
  invariant in the system. A startup self-check aborts if the configured sandbox
  string contains it.
- **Ungated `allow-top-navigation` MUST NOT be added** — only the
  user-activation-gated token is permitted, so generated code cannot redirect the
  host page without a genuine user gesture.
- Before injection, the bundled code is escaped so it cannot break out of its
  script context into the surrounding document.

Because the frame is null-origin, it cannot fetch anything directly. That is the
mechanism, not a side effect: it forces every data request through the parent
bridge, where the host controls it.

## Threat 2 — untrusted model inputs (prompt injection)

This is the residual risk the system contains but does not eliminate, and it is
documented rather than hidden.

On every turn the agent consumes input it does not control: results from MCP
tools, rows returned from a user's database, and the contents of an uploaded CSV.
At the same time the agent holds `write_file` and `install_package`. A poisoned
row or a malicious tool response can, in principle, steer the agent into
installing an attacker-named npm package — whose code would then run inside a
preview that has live connector access through the bridge — or into writing app
code that exfiltrates data.

**No model-side mitigation is treated as sufficient on its own.** The backstops
are deterministic and layered:

- **`--ignore-scripts`, always.** A package the agent installs can never run
  install-time scripts on the build host (see [bundle.md](./bundle.md)). This
  blocks the most direct install-time code-execution path.
- **A curated dependency allowlist** is offered for hosted deployments: restrict
  which packages `install_package` may add, so a coerced install of an
  attacker-chosen package simply fails. This is the productized backstop for
  exactly this threat.
- **A deterministic write validator** seam lets a host reject classes of bad
  output (for example, baking a fetched dataset into source) with zero extra model
  calls. It is opt-in and off by default.
- **Connector output is documented as untrusted model input**, so integrators
  reason about it correctly rather than trusting a database row because it came
  from "their own" database.

The honest statement: prompt injection through connector and tool content is a
real, residual risk. The design narrows the blast radius (the sandbox holds no
credentials; installs can't run scripts; an allowlist can cap what's installable)
rather than claiming the model can be trusted not to be manipulated.

## Threat 3 — credentials

Credentials for data sources live **server-side, only.** A connector holds its
own DSN, token, or API key; the generated app never sees it. When the app needs
data it posts a request over the bridge to the parent, which forwards it to
`POST {base}/connectors/{kind}`, which runs the query with the server-held
credential and returns only the resulting rows.

A concrete example: an app for **Northwind Property Group** can run raw SQL against
their live arrears database and render "$1.4M outstanding across 812 units" — and
the database password never enters the sandbox, the generated code, or the
browser. Connectors resolve per request against the caller's `Principal` scope, so
two tenants pointed at the same connector list only ever see their own data.

## The bundler as an attack surface

The bundler installs and builds real npm packages, potentially on a host with
secrets. Its invariants (full detail in [bundle.md](./bundle.md)) are part of the
security model:

- ships **only** as a **non-root** container with **ephemeral** build directories;
- `--ignore-scripts` enforced on every install;
- `name`/`version` validated against a strict regex before execution;
- the temp build directory stays under the working directory (moving it either
  breaks resolution or invites resolving against an unexpected tree);
- a startup self-check refuses to run if `--ignore-scripts` is dropped or the
  sandbox string is weakened.

## Auth modes and the CORS-x-credentials rule

The client runs in one of two auth modes (full detail in
[chat-protocol.md](./chat-protocol.md)):

- **Bearer mode** (default cross-origin) — `getHeaders()` attaches an
  `Authorization` header; `credentials: 'omit'`. No cookies cross the boundary.
- **Cookie mode** — `credentials: 'include'`; cross-origin this additionally
  requires `SameSite=None; Secure` cookies and a **per-origin CORS allowlist**.

The load-bearing rule: **`Access-Control-Allow-Origin: *` is incompatible with
credentialed requests.** A server configured for cookie mode with a wildcard
origin MUST refuse to start rather than ship an embed that fails silently in the
browser.

The `AuthProvider.resolve(request)` result is typed so access decisions are
in-band: it returns a `Principal`, or `null` (a plain 401), or an
`AuthDenied(status, message)` with status `401` / `402` / `403`. This is what lets
a host express "authenticated but not entitled" (for example, a `402` upgrade
gate) cleanly, without raising an exception around the abstraction.

## Share-token semantics

A share token grants a scoped, typically read-only view of a project. Two things
are true and worth stating plainly:

- **The token is the credential.** Anyone who holds a share link has the access it
  grants. That is appropriate for the intended use — handing someone a read-only
  running app — but it is worth knowing that sharing the link shares the access.
- **A share never leaks edit rights.** The token authorizes exactly the scope it
  was minted for; a read-only viewer stays read-only. When present, the token is
  threaded through **every** runtime RPC (as `?token=`), so a shared, running app
  can fetch its live data under the viewer's granted scope while the sandbox still
  never touches a credential.

The reference `AuthProvider` default leans conservative: public / run-as-creator
sharing is something a host opts into deliberately rather than something enabled
by default.

## Cross-origin embed recipe

Embedding `<Builder>` in a product served from a different origin than the agent
is the headline use case, so here is the secure path end to end:

1. **Prefer bearer mode.** Configure `auth.getHeaders` to return a short-lived
   `Authorization: Bearer <token>` and let the client send `credentials: 'omit'`.
   This avoids third-party-cookie problems entirely.
2. **If you must use cookies**, set `SameSite=None; Secure`, and configure the
   server's CORS to echo the specific embedding origin with
   `Access-Control-Allow-Credentials: true`. Never use `*` with credentials — the
   server will refuse to start, by design.
3. **Thread auth through everything.** The client attaches the configured
   credentials to the chat SSE, the bundle call, project and snapshot reads, and
   every preview bridge-proxy fetch — not just the first request.
4. **Keep the namespace consistent** across the server, the prompt, and the
   generated apps (see [preview-bridge.md](./preview-bridge.md)); a mismatch here
   is a silent-no-data bug, not a security hole, but it is the most common
   integration failure.
5. **Serve the preview head under your CSP.** The default styling loads Tailwind
   from a CDN; a strict-CSP host supplies an inlined stylesheet as `headHtml`
   instead.

## The non-negotiable invariants, in one place

A conforming, secure deployment holds all of these. The reference startup
self-check enforces the ones marked with a check.

- ✅ The sandbox string never contains `allow-same-origin`.
- ✅ The bundler installs with `--ignore-scripts`.
- ✅ Cookie mode never pairs with `Access-Control-Allow-Origin: *`.
- The bundler runs non-root with ephemeral build dirs.
- Credentials stay server-side; the sandbox and generated code never hold one.
- Connector and tool output is treated as untrusted model input.
