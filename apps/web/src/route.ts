import maplibregl from "maplibre-gl";
import * as turf from "@turf/turf";
import type { GeocodeResult, Route } from "@dryroute/shared-types";
import { FAKE_RAIN_ZONE } from "./devmode";
import { addToMapWhenReady } from "./mapReady";

const ROUTE_SOURCE_ID = "route";
const ROUTE_LAYER_ID = "route-layer";

interface LngLat {
  lat: number;
  lon: number;
}

export interface RouteController {
  setOrigin: (result: GeocodeResult) => void;
  setDestination: (result: GeocodeResult) => void;
  reattach: () => void;
}

export function initRoute(map: maplibregl.Map, isDevMode: () => boolean): RouteController {
  const navigateButton = document.querySelector<HTMLButtonElement>(".navigate-button");
  const toast = document.querySelector<HTMLDivElement>(".route-toast");
  const toastMessage = document.querySelector<HTMLSpanElement>(".route-toast__message");
  const toastCancel = document.querySelector<HTMLButtonElement>(".route-toast__cancel");
  const waypointBox = document.querySelector<HTMLDivElement>(".search--waypoint");
  const waypointInput = document.querySelector<HTMLInputElement>(".search--waypoint .search__input");
  const waypointClear = document.querySelector<HTMLButtonElement>(".search__waypoint-clear");

  const noop: RouteController = { setOrigin: () => {}, setDestination: () => {}, reattach: () => {} };
  if (!navigateButton || !toast || !toastMessage || !toastCancel || !waypointBox || !waypointInput || !waypointClear)
    return noop;

  let origin: LngLat | null = null;
  let destination: LngLat | null = null;
  let waypoint: LngLat | null = null;
  let waypointMarker: maplibregl.Marker | null = null;
  let awaitingWaypointClick = false;
  let lastRouteAtRisk = false;
  let lastRouteFeature: GeoJSON.Feature<GeoJSON.LineString> | null = null;

  const updateNavigateEnabled = () => {
    navigateButton.disabled = !origin || !destination;
  };

  const routeColor = () => getComputedStyle(document.documentElement).getPropertyValue("--rain").trim();

  const fitToRoute = (feature: GeoJSON.Feature<GeoJSON.LineString>) => {
    const [minX, minY, maxX, maxY] = turf.bbox(feature);
    map.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      { padding: { top: 160, bottom: 220, left: 40, right: 40 }, duration: 800 },
    );
  };

  const toGeoJson = (route: Route): GeoJSON.Feature<GeoJSON.LineString> => {
    const coordinates = route.legs.flatMap((leg, i) =>
      i === 0 ? leg.geometry.coordinates : leg.geometry.coordinates.slice(1),
    );
    return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } };
  };

  const drawRoute = (feature: GeoJSON.Feature<GeoJSON.LineString>, atRisk: boolean) => {
    lastRouteAtRisk = atRisk;
    lastRouteFeature = feature;
    const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(feature);
      map.setPaintProperty(ROUTE_LAYER_ID, "line-dasharray", atRisk ? [2, 1.5] : [1]);
      return;
    }

    addToMapWhenReady(() => {
      if (map.getSource(ROUTE_SOURCE_ID)) return;
      map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: feature });
      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": routeColor(),
          "line-width": 4,
          "line-dasharray": atRisk ? [2, 1.5] : [1],
        },
      });
    });
  };

  const clearRoute = () => {
    if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
    if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);
    lastRouteAtRisk = false;
    lastRouteFeature = null;
  };

  const formatWaypoint = (point: LngLat) => `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`;

  const showWaypointBox = (point: LngLat) => {
    waypointInput.value = formatWaypoint(point);
    waypointBox.hidden = false;
  };

  const hideWaypointBox = () => {
    waypointBox.hidden = true;
    waypointInput.value = "";
  };

  const placeWaypointMarker = (point: LngLat) => {
    if (waypointMarker) waypointMarker.remove();
    waypointMarker = new maplibregl.Marker({
      color: getComputedStyle(document.documentElement).getPropertyValue("--mist").trim(),
      draggable: true,
    })
      .setLngLat([point.lon, point.lat])
      .addTo(map);
    waypointMarker.on("dragend", () => {
      if (!waypointMarker) return;
      const { lat, lng } = waypointMarker.getLngLat();
      waypoint = { lat, lon: lng };
      showWaypointBox(waypoint);
      void navigate({ fit: false });
    });
  };

  const setWaypoint = (point: LngLat) => {
    waypoint = point;
    placeWaypointMarker(point);
    showWaypointBox(point);
  };

  const clearWaypoint = () => {
    waypoint = null;
    if (waypointMarker) {
      waypointMarker.remove();
      waypointMarker = null;
    }
    hideWaypointBox();
  };

  const hideToast = () => {
    toast.hidden = true;
    toast.classList.remove("is-blocked");
  };

  const exitWaypointMode = () => {
    awaitingWaypointClick = false;
    map.getCanvas().style.cursor = "";
    document.removeEventListener("keydown", onEscape);
  };

  const onEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") cancelWaypointMode();
  };

  const cancelWaypointMode = () => {
    exitWaypointMode();
    hideToast();
  };

  const showToast = (message: string, blocked: boolean) => {
    toastMessage.textContent = message;
    toast.hidden = false;
    toast.classList.toggle("is-blocked", blocked);
  };

  const intersectsRainZone = (feature: GeoJSON.Feature<GeoJSON.LineString>): boolean => {
    return turf.lineIntersect(feature, FAKE_RAIN_ZONE).features.length > 0;
  };

  const enterWaypointMode = (stillCrossing: boolean) => {
    awaitingWaypointClick = true;
    map.getCanvas().style.cursor = "crosshair";
    showToast(
      stillCrossing
        ? "Still crosses the rain - tap the map for a different waypoint"
        : "Route crosses the rain - tap the map to drop a waypoint",
      true,
    );
    document.addEventListener("keydown", onEscape);
    map.once("click", onMapClick);
  };

  const onMapClick = (event: maplibregl.MapMouseEvent) => {
    if (!awaitingWaypointClick) return;
    exitWaypointMode();
    setWaypoint({ lat: event.lngLat.lat, lon: event.lngLat.lng });
    void navigate({ fit: false });
  };

  const navigate = async (opts: { fit?: boolean } = {}) => {
    if (!origin || !destination) return;
    const fit = opts.fit ?? true;

    const params = new URLSearchParams({
      origin_lat: String(origin.lat),
      origin_lon: String(origin.lon),
      dest_lat: String(destination.lat),
      dest_lon: String(destination.lon),
    });
    if (waypoint) {
      params.set("waypoint_lat", String(waypoint.lat));
      params.set("waypoint_lon", String(waypoint.lon));
    }

    try {
      const response = await fetch(`/api/route?${params.toString()}`);
      if (!response.ok) throw new Error(`Route fetch failed: ${response.status}`);
      const route = (await response.json()) as Route;
      const feature = toGeoJson(route);
      if (fit) fitToRoute(feature);

      if (isDevMode() && intersectsRainZone(feature)) {
        drawRoute(feature, true);
        enterWaypointMode(waypoint !== null);
      } else {
        drawRoute(feature, false);
        hideToast();
      }
    } catch {
      showToast("Couldn't fetch a route - try again", false);
    }
  };

  navigateButton.addEventListener("click", () => {
    clearWaypoint();
    void navigate();
  });

  toastCancel.addEventListener("click", cancelWaypointMode);

  waypointClear.addEventListener("click", () => {
    clearWaypoint();
    cancelWaypointMode();
    void navigate();
  });

  return {
    setOrigin: (result: GeocodeResult) => {
      origin = { lat: result.lat, lon: result.lon };
      clearWaypoint();
      clearRoute();
      cancelWaypointMode();
      updateNavigateEnabled();
    },
    setDestination: (result: GeocodeResult) => {
      destination = { lat: result.lat, lon: result.lon };
      clearWaypoint();
      clearRoute();
      cancelWaypointMode();
      updateNavigateEnabled();
    },
    reattach: () => {
      if (lastRouteFeature) drawRoute(lastRouteFeature, lastRouteAtRisk);
    },
  };
}
