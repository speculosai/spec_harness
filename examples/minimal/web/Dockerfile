# The web service: this example's Vite app, serving the <Builder> embed.
#
# The build context is the repository root (see the compose files). The example
# depends on the workspace packages, which are not published yet, so the image
# installs them from this checkout through the root npm workspace.
#
# It runs the dev server rather than a static build, because that is what an
# example is for: edit BuilderPage.tsx and the page reloads. For production you
# would `npm run build` and serve `dist/` from your own web server or CDN.

FROM node:20-alpine

WORKDIR /repo

# The workspace manifests and the committed lockfile first, so editing the
# example does not reinstall the tree and every build resolves the same pinned
# versions. The packages ship TypeScript sources, so Vite consumes them directly
# - there is no separate build step to keep in sync.
COPY package.json package-lock.json ./
COPY packages ./packages
COPY examples/minimal/web ./examples/minimal/web

RUN npm install --ignore-scripts --no-audit --no-fund

WORKDIR /repo/examples/minimal/web

# vite.config.ts binds 0.0.0.0:5173 so the port is reachable from the host, and
# proxies /api/builder to HARNESS_BASE_URL (the agent service on the compose
# network) so the page and the API share an origin in the browser.
EXPOSE 5173

CMD ["npm", "run", "dev"]
