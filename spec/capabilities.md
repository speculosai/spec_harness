# Capability negotiation

A single client should be able to talk to more than one kind of server — the
reference Python kit, a browser-bundler configuration, a production backend — and
adapt its UI to what each actually supports. The capabilities endpoint is how it
asks. This is what lets the client hide the `install_package` affordance against a
browser bundler, hide the model picker against a server with no model list, or
turn plan mode off against a server that doesn't offer it, without any per-server
client code.

## Endpoint

- **`GET {base}/capabilities`**
- **Response (200):**

```jsonc
{
  "protocol": 1,
  "namespace": "app",
  "sandbox": {
    "location": "server",
    "supportsInstall": true,
    "jsxRuntime": "automatic"
  },
  "planMode": true,
  "attachments": ["image", "csv"],
  "models": ["openai/gpt-4.1", "anthropic/claude-sonnet-5", "ollama/llama3.3"],
  "connectors": ["postgres", "mcp"]
}
```

## Field meanings

| Field | Type | Meaning |
|---|---|---|
| `protocol` | integer | The wire protocol integer this server speaks. Must match the client's `Harness-Protocol` expectation; a mismatch should fail loudly. |
| `namespace` | string | The runtime namespace bound into the preview bridge and generated code (see [preview-bridge.md](./preview-bridge.md)). Default `"app"`. |
| `sandbox.location` | `"server"` \| `"browser"` | Where bundling happens. `browser` means the in-browser bundler is in use. |
| `sandbox.supportsInstall` | boolean | Whether the bundler can install packages on demand. When `false`, the client hides on-demand installs. |
| `sandbox.jsxRuntime` | `"automatic"` \| `"classic"` | Which JSX transform the bundler emits. |
| `planMode` | boolean | Whether the server supports plan mode. When `false`, the client hides the plan-mode affordance. |
| `attachments` | string[] | Which attachment kinds the server accepts (`"image"`, `"csv"`). The client only offers these. |
| `models` | string[] | The models the in-chat picker may offer. Empty or absent → hide the picker and use the server default. |
| `connectors` | string[] | Which connector kinds are mounted (e.g. `"postgres"`, `"mcp"`). The client's preview shim degrades any unlisted connector to a never-throw stub. |

An optional `routing` flag (advertising per-task dynamic model routing) is a
forward-compatible addition; a client that doesn't know it ignores it, per the
unknown-field rule in the [spec README](./README.md).

## The 404 fallback (normative)

The capabilities endpoint is an enhancement, not a precondition. If it **404s**,
or if a response arrives without a `Harness-Protocol` header, the client MUST
assume **protocol-1 defaults** and continue — it does not error out.

| Capability | Fallback default | Rationale |
|---|---|---|
| Bundling location | `server` | The original, most common deployment. |
| `supportsInstall` | `true` | Server bundlers install by default. |
| `planMode` | on | Plan mode predates the capabilities endpoint. |
| `attachments` | `["image", "csv"]` | Both attachment kinds have always existed. |
| Model routing | off | Routing is opt-in and newer. |
| `models` | none | With no advertised list, hide the picker and use the server default. |

These defaults deliberately describe a plain protocol-1 server, which is exactly
what makes a capabilities-aware client work against a backend that predates the
endpoint. The conformance kit ships a no-capabilities fixture that pins this
fallback so it can never silently change.
