# Known issue: exported Google/Apple Maps routes can detour from the planned route

## Summary

The Share button (`frontend/src/route.ts`, `exportBtn` handler) opens the
planned route in Google or Apple Maps by calling `buildExportPoints()`
(`frontend/src/mapExport.ts`).
This produces a short list of stop coordinates, since Google's consumer
directions URL (`https://www.google.com/maps/dir/?api=1&...`) has no way to
carry a full polyline, only named stops, and caps out around 10 total stops
in practice.
Google (and Apple Maps) then computes its own road route between whichever
points it is given, using its own roads and its own routing logic.

Because DryRoute's planned route can contain a rain-avoidance detour that the
export step compresses into a handful of points, the route Google Maps
actually drives can differ substantially from the route DryRoute planned -
sometimes taking a real detour that was never part of the plan.

## Evidence

Two real routes were captured live against a running instance of the app and
opened for real in Google Maps (not simulated) to confirm this behavior.

**Case 1 - current location to Changi Airport T1, during active rain.**
DryRoute planned 27.7 km / 38 min, with a loop detour west of Lower Seletar
Reservoir to avoid a rain cell.
The exported 10-point skeleton bracketed the entire loop with only two
anchor points.
Google Maps, given those two points, drove straight down Lentor Ave with no
loop at all - it had no way to know the loop existed.

**Case 2 - Shenton Way to Changi Airport T1.**
DryRoute planned 22.4 km / 25 min.
The captured export URL, opened for real in Google Maps, came back as
34.4 km / 41 min - 54% further and 16 minutes slower.
Two of the exported anchors near the CBD ended up on opposite sides of a
stretch of coast once Google resolved them to real roads, so it backtracked
between them (down to Marina South Pier and back around Katong Park),
adding roughly 12 km that was never in DryRoute's plan.

## Root cause

`buildExportPoints()` allocates its point budget proportional to each leg's
raw *length*, then samples at even intervals along that leg
(`turf.length` + `turf.along`).
A leg's length is uncorrelated with how much it bends, so a short, tightly
curving detour and a long straight stretch of similar length receive a
similar point budget.
The detour's shape gets flattened once too few points bracket it and Google
re-routes between them.

## Attempted fix (implemented, tested, then reverted)

A curvature-aware replacement was implemented and verified against both live
examples above:

- Per-leg curvature weight = `legLengthKm - chordKm` (how far the path
  bulges past a straight line between its endpoints), used to bias the
  point budget toward curvy legs instead of long ones.
- Per-leg simplification via `turf.simplify` (Douglas-Peucker), with the
  simplification tolerance binary-searched per leg so points land on the
  sharpest bends rather than at even intervals.

This fixed Case 1 cleanly: the exported route matched the plan almost
exactly (27.7 km / 33 min vs. the planned 27.7 km / 38 min), and visually
followed the loop.

**It made Case 2 worse.**
Douglas-Peucker allocates points by *local* sharpness, not by how much a
detour matters overall.
A short, sharp kink right at the route's origin (a small dip-and-recover
within the first ~1 km) out-competed a broader, more consequential detour
further along for budget - 4 of the 8 available points landed within that
first kilometre.
Google Maps treats every exported point as a mandatory, strictly-ordered
stop, never a shape hint, and cannot reorder them.
Those 4 tightly clustered points sat in the Marina South / CBD reclaimed-land
area, which has very limited real road connectivity (the only way to
visit them in the required order is via the Marina Coastal Expressway
tunnel loop).
The result: Google Maps came back at 49.5 km / 1h 3min - worse than both the
original plan and the unfixed export.

The fix was reverted (`frontend/src/mapExport.ts` and the associated
`vitest` addition) pending a better approach, since it traded one failure
mode (broad detours get flattened) for another (sharp local kinks get
over-weighted and can force pathological loops in areas of sparse road
connectivity).

## Ideas for a future attempt

- Post-filter simplified points to enforce a minimum real-world spacing
  (e.g. merge or drop points closer than ~300-500 m to their neighbor), so a
  single sharp local kink cannot consume a disproportionate share of the
  point budget.
- Weight curvature by the *chord span* of the deviation as well as its
  depth, so a kink that only covers a very short stretch of the route
  contributes less to the budget than a detour of similar depth spread over
  a longer distance.
- Accept that Google's directions URL fundamentally cannot carry a shape
  hint - only mandatory stops - and consider export paths that don't depend
  on point-to-point re-routing at all (e.g. GPX/KML export for apps that
  support route import, or keeping navigation inside DryRoute's own already-
  correct turn-by-turn).
