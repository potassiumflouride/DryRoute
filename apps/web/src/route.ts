import maplibregl from "maplibre-gl";
import * as turf from "@turf/turf";
import type { GeocodeResult, Route } from "@dryroute/shared-types";
import { FAKE_RAIN_ZONE } from "./devmode";
import { addToMapWhenReady } from "./mapReady";

const ROUTE_SOURCE_ID = "route";
const ROUTE_LAYER_ID = "route-layer";
const ROUTE_HITBOX_LAYER_ID = "route-layer-hitbox";
const WAYPOINT_SOURCE_ID = "route-waypoints";
const WAYPOINT_LAYER_ID = "route-waypoints-layer";
const WAYPOINT_HIT_RADIUS_PX = 12;
const MAX_WAYPOINTS = 8;

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
  const toastDismiss = document.querySelector<HTMLButtonElement>(".route-toast__cancel");
  const routeSummary = document.querySelector<HTMLDivElement>(".route-summary");
  const routeReset = document.querySelector<HTMLButtonElement>(".route-reset");

  const noop: RouteController = { setOrigin: () => {}, setDestination: () => {}, reattach: () => {} };
  if (!navigateButton || !toast || !toastMessage || !toastDismiss || !routeSummary || !routeReset) return noop;

  let origin: LngLat | null = null;
  let destination: LngLat | null = null;
  let waypoints: LngLat[] = [];
  let isDraggingRoute = false;
  let dragMode: { kind: "move"; index: number } | { kind: "insert"; index: number } | null = null;
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

  const dragPreview = (mode: NonNullable<typeof dragMode>, point: LngLat): GeoJSON.Feature<GeoJSON.LineString> => {
    const ordered = [...waypoints];
    if (mode.kind === "move") ordered[mode.index] = point;
    else ordered.splice(mode.index, 0, point);
    const coordinates = [origin, ...ordered, destination]
      .filter((p): p is LngLat => p !== null)
      .map((p) => [p.lon, p.lat] as [number, number]);
    return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } };
  };

  const findNearbyWaypointIndex = (point: maplibregl.Point): number | null => {
    let closestIndex: number | null = null;
    let closestDist = WAYPOINT_HIT_RADIUS_PX;
    waypoints.forEach((wp, i) => {
      const screen = map.project([wp.lon, wp.lat]);
      const dist = Math.hypot(screen.x - point.x, screen.y - point.y);
      if (dist <= closestDist) {
        closestDist = dist;
        closestIndex = i;
      }
    });
    return closestIndex;
  };

  const computeInsertIndex = (dropPoint: LngLat): number => {
    if (!lastRouteFeature) return waypoints.length;
    const line = lastRouteFeature;
    const dropDistance = turf.nearestPointOnLine(line, turf.point([dropPoint.lon, dropPoint.lat])).properties.location ?? 0;
    const waypointDistances = waypoints.map(
      (wp) => turf.nearestPointOnLine(line, turf.point([wp.lon, wp.lat])).properties.location ?? 0,
    );
    let index = 0;
    while (index < waypointDistances.length && (waypointDistances[index] ?? 0) < dropDistance) index++;
    return index;
  };

  const setLineData = (feature: GeoJSON.Feature<GeoJSON.LineString>) => {
    const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(feature);
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
      // A wider, invisible line on top of the visible one - makes the route
      // much easier to grab and start a drag from than the 4px visible line.
      map.addLayer({
        id: ROUTE_HITBOX_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#000", "line-width": 24, "line-opacity": 0 },
      });
    });
  };

  const waypointsToGeoJson = (): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
    type: "FeatureCollection",
    features: waypoints.map((wp, i) => ({
      type: "Feature",
      properties: { index: i },
      geometry: { type: "Point", coordinates: [wp.lon, wp.lat] },
    })),
  });

  const drawWaypoints = () => {
    const data = waypointsToGeoJson();
    const source = map.getSource(WAYPOINT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
      return;
    }

    addToMapWhenReady(() => {
      if (map.getSource(WAYPOINT_SOURCE_ID)) return;
      map.addSource(WAYPOINT_SOURCE_ID, { type: "geojson", data });
      map.addLayer({
        id: WAYPOINT_LAYER_ID,
        type: "circle",
        source: WAYPOINT_SOURCE_ID,
        paint: {
          "circle-radius": 6,
          "circle-color": routeColor(),
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });
    });
  };

  const clearRoute = () => {
    if (map.getLayer(WAYPOINT_LAYER_ID)) map.removeLayer(WAYPOINT_LAYER_ID);
    if (map.getSource(WAYPOINT_SOURCE_ID)) map.removeSource(WAYPOINT_SOURCE_ID);
    if (map.getLayer(ROUTE_HITBOX_LAYER_ID)) map.removeLayer(ROUTE_HITBOX_LAYER_ID);
    if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
    if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);
    lastRouteAtRisk = false;
    lastRouteFeature = null;
    hideSummary();
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder === 0 ? `${hours} hr` : `${hours} hr ${remainder} min`;
  };

  const showSummary = (route: Route) => {
    const km = (route.distanceMeters / 1000).toFixed(1);
    routeSummary.textContent = `${km} km · ${formatDuration(route.durationSeconds)}`;
    routeSummary.hidden = false;
    routeReset.hidden = waypoints.length === 0;
  };

  const hideSummary = () => {
    routeSummary.hidden = true;
    routeSummary.textContent = "";
    routeReset.hidden = true;
  };

  const hideToast = () => {
    toast.hidden = true;
    toast.classList.remove("is-blocked");
  };

  const showToast = (message: string, blocked: boolean) => {
    toastMessage.textContent = message;
    toast.hidden = false;
    toast.classList.toggle("is-blocked", blocked);
  };

  const intersectsRainZone = (feature: GeoJSON.Feature<GeoJSON.LineString>): boolean => {
    return turf.lineIntersect(feature, FAKE_RAIN_ZONE).features.length > 0;
  };

  const onRouteDragMove = (event: maplibregl.MapMouseEvent) => {
    if (!dragMode) return;
    setLineData(dragPreview(dragMode, { lat: event.lngLat.lat, lon: event.lngLat.lng }));
  };

  const onRouteDragEnd = (event: maplibregl.MapMouseEvent) => {
    map.off("mousemove", onRouteDragMove);
    isDraggingRoute = false;
    map.dragPan.enable();
    map.getCanvas().style.cursor = "grab";

    if (dragMode) {
      const point = { lat: event.lngLat.lat, lon: event.lngLat.lng };
      if (dragMode.kind === "move") waypoints[dragMode.index] = point;
      else waypoints.splice(dragMode.index, 0, point);
    }
    dragMode = null;
    void navigate({ fit: false });
  };

  const onRouteMouseDown = (event: maplibregl.MapMouseEvent) => {
    event.preventDefault();
    isDraggingRoute = true;
    map.dragPan.disable();
    map.getCanvas().style.cursor = "grabbing";

    const nearbyIndex = findNearbyWaypointIndex(event.point);
    if (nearbyIndex !== null) {
      dragMode = { kind: "move", index: nearbyIndex };
    } else if (waypoints.length >= MAX_WAYPOINTS) {
      dragMode = null;
    } else {
      const dropPoint = { lat: event.lngLat.lat, lon: event.lngLat.lng };
      dragMode = { kind: "insert", index: computeInsertIndex(dropPoint) };
    }

    map.on("mousemove", onRouteDragMove);
    map.once("mouseup", onRouteDragEnd);
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
    if (waypoints.length > 0) {
      params.set("waypoints", waypoints.map((w) => `${w.lat},${w.lon}`).join(";"));
    }

    try {
      const response = await fetch(`/api/route?${params.toString()}`);
      if (!response.ok) throw new Error(`Route fetch failed: ${response.status}`);
      const route = (await response.json()) as Route;
      const feature = toGeoJson(route);
      if (fit) fitToRoute(feature);
      showSummary(route);

      if (isDevMode() && intersectsRainZone(feature)) {
        drawRoute(feature, true);
        showToast("Route crosses the rain - drag the route to move it out of the rain", true);
      } else {
        drawRoute(feature, false);
        hideToast();
      }
      drawWaypoints();
    } catch {
      hideSummary();
      showToast("Couldn't fetch a route - try again", false);
    }
  };

  navigateButton.addEventListener("click", () => {
    waypoints = [];
    void navigate();
  });

  toastDismiss.addEventListener("click", hideToast);

  routeReset.addEventListener("click", () => {
    waypoints = [];
    routeReset.hidden = true;
    void navigate();
  });

  map.on("mouseenter", ROUTE_HITBOX_LAYER_ID, () => {
    if (!isDraggingRoute) map.getCanvas().style.cursor = "grab";
  });
  map.on("mouseleave", ROUTE_HITBOX_LAYER_ID, () => {
    if (!isDraggingRoute) map.getCanvas().style.cursor = "";
  });
  map.on("mousedown", ROUTE_HITBOX_LAYER_ID, onRouteMouseDown);
  map.on("mousedown", WAYPOINT_LAYER_ID, onRouteMouseDown);
  map.on("dblclick", WAYPOINT_LAYER_ID, (event) => {
    event.preventDefault();
    const index = event.features?.[0]?.properties?.index as number | undefined;
    if (index === undefined) return;
    waypoints.splice(index, 1);
    void navigate({ fit: false });
  });

  return {
    setOrigin: (result: GeocodeResult) => {
      origin = { lat: result.lat, lon: result.lon };
      waypoints = [];
      clearRoute();
      hideToast();
      updateNavigateEnabled();
    },
    setDestination: (result: GeocodeResult) => {
      destination = { lat: result.lat, lon: result.lon };
      waypoints = [];
      clearRoute();
      hideToast();
      updateNavigateEnabled();
    },
    reattach: () => {
      if (lastRouteFeature) drawRoute(lastRouteFeature, lastRouteAtRisk);
      drawWaypoints();
    },
  };
}
