import type maplibregl from "maplibre-gl";
import { addToMapWhenReady } from "./mapReady";

// Mirrors backend/src/dryroute_api/scoring/__init__.py's _DEV_FAKE_RAIN_POLYGON - a box
// over central Singapore used when DRYROUTE_DEV_FAKE_RAIN_ENABLED is set, so
// rain-avoidance/rain-crossing behavior can be tested without live weather.
const DEV_FAKE_RAIN_POLYGON: [number, number][] = [
  [103.8, 1.28],
  [103.86, 1.28],
  [103.86, 1.32],
  [103.8, 1.32],
  [103.8, 1.28],
];

const SOURCE_ID = "dev-fake-rain";
const FILL_LAYER_ID = "dev-fake-rain-fill";
const OUTLINE_LAYER_ID = "dev-fake-rain-outline";

// Dev-only: draws the fixed rain box the backend reports when
// DRYROUTE_DEV_FAKE_RAIN_ENABLED is set, so it's visible on the map during
// manual testing. Opt in with ?devFakeRain on the page URL.
export function initDevFakeRain(map: maplibregl.Map): void {
  if (!new URLSearchParams(window.location.search).has("devFakeRain")) return;

  const data: GeoJSON.Feature<GeoJSON.Polygon> = {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [DEV_FAKE_RAIN_POLYGON] },
  };

  addToMapWhenReady(() => {
    if (map.getSource(SOURCE_ID)) return;
    map.addSource(SOURCE_ID, { type: "geojson", data });
    map.addLayer({
      id: FILL_LAYER_ID,
      type: "fill",
      source: SOURCE_ID,
      paint: { "fill-color": "#f87171", "fill-opacity": 0.15 },
    });
    map.addLayer({
      id: OUTLINE_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      paint: { "line-color": "#f87171", "line-width": 2, "line-dasharray": [2, 1.5] },
    });
  });
}
