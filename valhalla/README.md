# DryRoute Valhalla Service

This directory owns the boundary for an independently deployed, self-hosted Valhalla routing engine.

The DryRoute backend expects a Valhalla-compatible HTTP service and connects to it through `DRYROUTE_VALHALLA_URL`. The service will eventually own its Valhalla configuration, graph-building scripts, deployment definition, and ignored graph data under `valhalla/data/`.

No self-hosted runtime configuration is included in this reorganization; the backend's existing public Valhalla default remains unchanged.
