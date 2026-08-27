# DryRoute Frontend

Installable PWA built with Vite, TypeScript, and MapLibre (manifest and icons configured via `vite-plugin-pwa` in `vite.config.ts`). During development, Vite proxies `/api` to the backend on port 8000 and `/tiles` to the tile service on port 8081.

The app is a map-first mobile UX: a draggable bottom-sheet route planner, a radar overlay with a time scrubber (`src/radar.ts`), route drawing that highlights the segments of a route crossing rain (`src/route.ts`), compass and recenter map controls, and an OpenStreetMap attribution popover (`src/attribution.ts`). The draggable sheet behavior lives in `src/sheetDrag.ts`.

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm build
pnpm test
```

`pnpm-workspace.yaml` contains pnpm's local esbuild permission only. It does not define or coordinate additional workspace packages.

`vite.config.ts` also lists an ngrok tunnel hostname under `allowedHosts` for testing the dev server from a real device; it is dev-only convenience config, not something the app depends on.
