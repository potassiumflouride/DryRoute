import maplibregl from "maplibre-gl";
import type { RainZone } from "@dryroute/shared-types";
import { addToMapWhenReady } from "./mapReady";

const STORAGE_KEY = "dryroute-devmode";
const SOURCE_ID = "devmode-rainzone";
const LAYER_ID = "devmode-rainzone-layer";

// Dev-only fixture: a fake rain zone covering the middle and east of
// Singapore, used to exercise the rain-avoidance waypoint flow without
// depending on live weather. Not tied to real radar data.
export const FAKE_RAIN_ZONE: RainZone = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [103.8, 1.3],
            [103.99, 1.3],
            [103.99, 1.41],
            [103.8, 1.41],
            [103.8, 1.3],
          ],
        ],
      },
    },
  ],
};

export interface DevModeController {
  isOn: () => boolean;
  reattach: () => void;
}

export function initDevMode(map: maplibregl.Map): DevModeController {
  const toggle = document.querySelector<HTMLButtonElement>(".devmode-toggle");

  let on = getInitialDevMode();

  const addZoneLayer = () => {
    if (map.getSource(SOURCE_ID)) return;

    addToMapWhenReady(() => {
      if (map.getSource(SOURCE_ID)) return;
      map.addSource(SOURCE_ID, { type: "geojson", data: FAKE_RAIN_ZONE });
      map.addLayer({
        id: LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": getComputedStyle(document.documentElement).getPropertyValue("--rain").trim(),
          "fill-opacity": 0.35,
        },
      });
    });
  };

  const removeZoneLayer = () => {
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  };

  const applyState = () => {
    document.documentElement.dataset.devmode = on ? "1" : "0";
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
    toggle?.classList.toggle("is-active", on);
    toggle?.setAttribute("aria-pressed", String(on));
    if (on) {
      addZoneLayer();
    } else {
      removeZoneLayer();
    }
  };

  if (toggle) {
    toggle.hidden = !import.meta.env.DEV;
    toggle.addEventListener("click", () => {
      on = !on;
      applyState();
    });
  }

  applyState();

  return {
    isOn: () => on,
    reattach: () => {
      if (on) addZoneLayer();
    },
  };
}

function getInitialDevMode(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "1";
}
