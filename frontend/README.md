# DryRoute Frontend

Static Vite, TypeScript, and MapLibre SPA. During development, Vite proxies `/api` to the backend on port 8000 and `/tiles` to the tile service on port 8081.

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm build
pnpm test
```

`pnpm-workspace.yaml` contains pnpm's local esbuild permission only. It does not define or coordinate additional workspace packages.
