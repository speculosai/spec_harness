# @speculosai/spec_harness

The frontend of Speculos Harness in one package: the React workspace, the sandboxed preview host, the wire-protocol types, and the reference MCP connector. The package ships TypeScript sources, so a bundler (Vite, Next, Bun, esbuild) consumes it directly.

```bash
npm install @speculosai/spec_harness
```

```tsx
import { HarnessProvider, Builder } from '@speculosai/spec_harness'
import '@speculosai/spec_harness/styles.css'

<HarnessProvider baseUrl="/api/builder" namespace="app" auth={{ getHeaders }}>
  <Builder projectId={project.id} layout="preview-left" filePanel="explorer" />
</HarnessProvider>
```

## Entry points

| Import | What it is |
|---|---|
| `@speculosai/spec_harness` | The workspace: `HarnessProvider`, `Builder`, the panes (`ChatPane`, `PreviewPane`, `FileExplorer`, `VersionTimeline`), and the hooks (`useHarnessChat`, `useHarnessPreview`, `useHarnessFiles`). |
| `@speculosai/spec_harness/protocol` | The wire-protocol types and constants (`PROTOCOL_VERSION`, `SANDBOX_ATTRIBUTES`, the adapter interfaces). Zero runtime dependencies. |
| `@speculosai/spec_harness/preview` | The framework-agnostic sandboxed iframe host: `buildSrcDoc`, `createBridge`, `makeShim`. Use it directly if you are not on React. |
| `@speculosai/spec_harness/connectors-mcp` | The browser half of the MCP connector: the runtime bridge handler and the in-iframe shim. |
| `@speculosai/spec_harness/sandbox-browser` | Placeholder for the roadmap in-browser build path. `/capabilities` advertises server bundling today. |
| `@speculosai/spec_harness/styles.css` | The default stylesheet, built on CSS custom properties so your tokens restyle the workspace. |

## The other pieces

- **Backend** - the agent kit is a Python package (`speculos-harness` on PyPI); it mounts a FastAPI router.
- **Build service** - the `speculosai/harness-bundler` container turns the project's files into browser-ready code.

See the [repository](https://github.com/speculosai/spec_harness) for the quickstart, the protocol spec, and the embedding guide.

## License

Apache-2.0.
