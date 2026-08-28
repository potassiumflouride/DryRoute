import maplibregl from "maplibre-gl";
import * as turf from "@turf/turf";
import type { GeocodeResult, Route } from "./types";
import { addToMapWhenReady } from "./mapReady";
import { buildExportPoints, buildGoogleMapsUrl } from "./mapExport";
import { trackEvent } from "./analytics";

const ROUTE_SOURCE_ID = "route";
const ROUTE_CASING_LAYER_ID = "route-layer-casing";
const ROUTE_LAYER_ID = "route-layer";
const ROUTE_RAIN_SOURCE_ID = "route-rain";
const ROUTE_RAIN_LAYER_ID = "route-layer-rain";
const ROUTE_HITBOX_LAYER_ID = "route-layer-hitbox";
const WAYPOINT_SOURCE_ID = "route-waypoints";
const WAYPOINT_LAYER_ID = "route-waypoints-layer";
const WAYPOINT_HIT_RADIUS_PX = 12;
const TOUCH_WAYPOINT_HIT_RADIUS_PX = 28;
const MAX_WAYPOINTS = 8;

interface LngLat {
  lat: number;
  lon: number;
}

const emptyRainCollection = (): GeoJSON.FeatureCollection<GeoJSON.LineString> => ({
  type: "FeatureCollection",
  features: [],
});

export interface RouteController {
  setOrigin: (result: GeocodeResult) => void;
  setDestination: (result: GeocodeResult) => void;
  navigateNow: () => Promise<void>;
  cancelRoute: () => void;
  reattach: () => void;
}

export function initRoute(map: maplibregl.Map): RouteController {
  const navigateButton = document.querySelector<HTMLButtonElement>(".navigate-button");
  const toast = document.querySelector<HTMLDivElement>(".route-toast");
  const toastMessage = document.querySelector<HTMLSpanElement>(".route-toast__message");
  const toastDismiss = document.querySelector<HTMLButtonElement>(".route-toast__cancel");
  const routeSheet = document.querySelector<HTMLDivElement>(".route-sheet");
  const routeSheetDestination = document.querySelector<HTMLElement>(".route-sheet__destination");
  const routeSheetStatus = document.querySelector<HTMLParagraphElement>(".route-sheet__status");
  const routeSummary = document.querySelector<HTMLSpanElement>(".route-summary");
  const routeReset = document.querySelector<HTMLButtonElement>(".route-reset");
  const editStartBtn = document.querySelector<HTMLButtonElement>(".edit-start-btn");
  const editConfirmGroup = document.querySelector<HTMLDivElement>(".edit-confirm-group");
  const editSaveBtn = document.querySelector<HTMLButtonElement>(".edit-save-btn");
  const editDiscardBtn = document.querySelector<HTMLButtonElement>(".edit-discard-btn");
  const exportBtn = document.querySelector<HTMLButtonElement>(".route-sheet__export-btn");
  const backBtn = document.querySelector<HTMLButtonElement>(".route-sheet__back-btn");
  const hintBubble = document.querySelector<HTMLDivElement>(".route-hint-bubble");
  const editRainHint = document.querySelector<HTMLParagraphElement>(".edit-rain-hint");
  const editRainHintDismiss = document.querySelector<HTMLButtonElement>(".edit-rain-hint__dismiss");

  const noop: RouteController = {
    setOrigin: () => {},
    setDestination: () => {},
    navigateNow: async () => {},
    cancelRoute: () => {},
    reattach: () => {},
  };
  if (
    !navigateButton ||
    !toast ||
    !toastMessage ||
    !toastDismiss ||
    !routeSheet ||
    !routeSheetDestination ||
    !routeSheetStatus ||
    !routeSummary ||
    !routeReset ||
    !editStartBtn ||
    !editConfirmGroup ||
    !editSaveBtn ||
    !editDiscardBtn ||
    !exportBtn ||
    !backBtn ||
    !hintBubble ||
    !editRainHint ||
    !editRainHintDismiss
  )
    return noop;

  let origin: LngLat | null = null;
  let destination: LngLat | null = null;
  let destinationLabel = "";
  let waypoints: LngLat[] = [];
  let waypointsBeforeEdit: LngLat[] = [];
  let isDraggingRoute = false;
  let dragMode: { kind: "move"; index: number } | { kind: "insert"; index: number } | null = null;
  let lastRouteFeature: GeoJSON.Feature<GeoJSON.LineString> | null = null;
  let lastRainFeatureCollection: GeoJSON.FeatureCollection<GeoJSON.LineString> = emptyRainCollection();
  let lastRoute: Route | null = null;
  let lastRouteAnchors: LngLat[] | null = null;
  let isEditMode = false;
  let hasEditedRoute = false;
  let lastRouteHasRain = false;
  let hasDismissedRainHint = false;

  const isTouchDevice = () => window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;

  const routeColor = () => getComputedStyle(document.documentElement).getPropertyValue("--rain").trim();
  const rainSegmentColor = () => getComputedStyle(document.documentElement).getPropertyValue("--danger").trim();

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

  const toRainGeoJson = (route: Route): GeoJSON.FeatureCollection<GeoJSON.LineString> => ({
    type: "FeatureCollection",
    features: route.legs
      .flatMap((leg) => leg.rainSegments ?? [])
      .map((geometry) => ({ type: "Feature", properties: {}, geometry })),
  });

  const dragPreview = (mode: NonNullable<typeof dragMode>, point: LngLat): GeoJSON.Feature<GeoJSON.LineString> => {
    const ordered = [...waypoints];
    if (mode.kind === "move") ordered[mode.index] = point;
    else ordered.splice(mode.index, 0, point);
    const coordinates = [origin, ...ordered, destination]
      .filter((p): p is LngLat => p !== null)
      .map((p) => [p.lon, p.lat] as [number, number]);
    return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } };
  };

  const findNearbyWaypointIndex = (point: maplibregl.Point, radiusPx: number): number | null => {
    let closestIndex: number | null = null;
    let closestDist = radiusPx;
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

  const setRainData = (collection: GeoJSON.FeatureCollection<GeoJSON.LineString>) => {
    const source = map.getSource(ROUTE_RAIN_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(collection);
  };

  const drawRoute = (
    feature: GeoJSON.Feature<GeoJSON.LineString>,
    rainCollection: GeoJSON.FeatureCollection<GeoJSON.LineString>,
  ) => {
    lastRouteFeature = feature;
    lastRainFeatureCollection = rainCollection;
    editStartBtn.disabled = false;
    exportBtn.disabled = false;
    backBtn.disabled = false;
    const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(feature);
      setRainData(rainCollection);
      return;
    }

    addToMapWhenReady(() => {
      if (map.getSource(ROUTE_SOURCE_ID)) return;
      map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: feature });
      map.addSource(ROUTE_RAIN_SOURCE_ID, { type: "geojson", data: rainCollection });
      // White casing beneath the blue route line keeps it visible over the radar overlay.
      map.addLayer({
        id: ROUTE_CASING_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": 9,
        },
      });
      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": routeColor(),
          "line-width": 5,
        },
      });
      // Red overlay on top of the base route line marks segments crossing rain.
      map.addLayer({
        id: ROUTE_RAIN_LAYER_ID,
        type: "line",
        source: ROUTE_RAIN_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": rainSegmentColor(),
          "line-width": 5,
        },
      });
      // A wider, invisible line on top of the visible ones - makes the route
      // much easier to grab and start a drag from than the visible line width.
      map.addLayer({
        id: ROUTE_HITBOX_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#000", "line-width": 24, "line-opacity": 0 },
      });
      // Always bring the route above whatever else was added to the map (e.g. radar),
      // regardless of add-order/reattach timing.
      map.moveLayer(ROUTE_CASING_LAYER_ID);
      map.moveLayer(ROUTE_LAYER_ID);
      map.moveLayer(ROUTE_RAIN_LAYER_ID);
      map.moveLayer(ROUTE_HITBOX_LAYER_ID);
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
      map.moveLayer(WAYPOINT_LAYER_ID);
    });
  };

  const clearRoute = () => {
    if (map.getLayer(WAYPOINT_LAYER_ID)) map.removeLayer(WAYPOINT_LAYER_ID);
    if (map.getSource(WAYPOINT_SOURCE_ID)) map.removeSource(WAYPOINT_SOURCE_ID);
    if (map.getLayer(ROUTE_HITBOX_LAYER_ID)) map.removeLayer(ROUTE_HITBOX_LAYER_ID);
    if (map.getLayer(ROUTE_RAIN_LAYER_ID)) map.removeLayer(ROUTE_RAIN_LAYER_ID);
    if (map.getSource(ROUTE_RAIN_SOURCE_ID)) map.removeSource(ROUTE_RAIN_SOURCE_ID);
    if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
    if (map.getLayer(ROUTE_CASING_LAYER_ID)) map.removeLayer(ROUTE_CASING_LAYER_ID);
    if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);
    lastRouteFeature = null;
    lastRainFeatureCollection = emptyRainCollection();
    lastRoute = null;
    lastRouteAnchors = null;
    lastRouteHasRain = false;
    hasDismissedRainHint = false;
    hasEditedRoute = false;
    hintBubble.hidden = true;
    editStartBtn.disabled = true;
    exportBtn.disabled = true;
    backBtn.disabled = true;
    if (isEditMode) {
      isEditMode = false;
      applyEditModeState();
    }
    updateEditRainHint();
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
    routeSheetDestination.textContent = destinationLabel;
    routeSummary.textContent = `${km} km · ${formatDuration(route.durationSeconds)}`;
    routeSheet.hidden = false;
    routeReset.hidden = waypoints.length === 0;
  };

  const hideSummary = () => {
    routeSheet.hidden = true;
    routeSheetDestination.textContent = "";
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

  // On touch devices dragging only works once edit mode is on, so the hint
  // must wait for that - on desktop the route can be dragged immediately.
  const updateHintBubble = () => {
    if (hasEditedRoute || waypoints.length > 0) {
      hintBubble.hidden = true;
      return;
    }
    hintBubble.hidden = isTouchDevice() ? !isEditMode : false;
  };

  const dismissHintBubble = () => {
    hasEditedRoute = true;
    updateHintBubble();
  };

  const updateEditRainHint = () => {
    editRainHint.hidden =
      isEditMode ||
      editStartBtn.hidden ||
      editStartBtn.disabled ||
      !lastRouteHasRain ||
      hasDismissedRainHint;
  };

  const dismissEditRainHint = () => {
    hasDismissedRainHint = true;
    updateEditRainHint();
  };

  const onRouteDragMove = (event: maplibregl.MapMouseEvent) => {
    if (!dragMode) return;
    setLineData(dragPreview(dragMode, { lat: event.lngLat.lat, lon: event.lngLat.lng }));
    setRainData(emptyRainCollection());
  };

  const onRouteDragEnd = (event: maplibregl.MapMouseEvent) => {
    map.off("mousemove", onRouteDragMove);
    isDraggingRoute = false;
    map.dragPan.enable();
    map.getCanvas().style.cursor = "grab";

    if (dragMode) {
      const point = { lat: event.lngLat.lat, lon: event.lngLat.lng };
      if (dragMode.kind === "move") {
        waypoints[dragMode.index] = point;
        trackEvent("waypoint_moved", { waypoint_index: dragMode.index });
      } else {
        waypoints.splice(dragMode.index, 0, point);
        trackEvent("waypoint_added", { waypoint_count: waypoints.length });
      }
    }
    dragMode = null;
    void navigate({ fit: false });
  };

  const onRouteMouseDown = (event: maplibregl.MapMouseEvent) => {
    event.preventDefault();
    dismissHintBubble();
    isDraggingRoute = true;
    map.dragPan.disable();
    map.getCanvas().style.cursor = "grabbing";

    const nearbyIndex = findNearbyWaypointIndex(event.point, WAYPOINT_HIT_RADIUS_PX);
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

  const onRouteTouchStart = (event: maplibregl.MapTouchEvent) => {
    if (!isEditMode) return;
    if (event.originalEvent.touches.length > 1) return;
    event.preventDefault();
    dismissHintBubble();
    isDraggingRoute = true;

    const nearbyIndex = findNearbyWaypointIndex(event.point, TOUCH_WAYPOINT_HIT_RADIUS_PX);
    if (nearbyIndex !== null) {
      dragMode = { kind: "move", index: nearbyIndex };
    } else if (waypoints.length >= MAX_WAYPOINTS) {
      dragMode = null;
    } else {
      const dropPoint = { lat: event.lngLat.lat, lon: event.lngLat.lng };
      dragMode = { kind: "insert", index: computeInsertIndex(dropPoint) };
    }

    map.on("touchmove", onRouteTouchMove);
    map.once("touchend", onRouteTouchEnd);
    map.once("touchcancel", onRouteTouchCancel);
  };

  const onRouteTouchMove = (event: maplibregl.MapTouchEvent) => {
    if (!dragMode) return;
    if (event.originalEvent.touches.length > 1) {
      endTouchDrag(null);
      return;
    }
    event.preventDefault();
    setLineData(dragPreview(dragMode, { lat: event.lngLat.lat, lon: event.lngLat.lng }));
    setRainData(emptyRainCollection());
  };

  const onRouteTouchEnd = (event: maplibregl.MapTouchEvent) => {
    endTouchDrag({ lat: event.lngLat.lat, lon: event.lngLat.lng });
  };

  const onRouteTouchCancel = () => {
    endTouchDrag(null);
  };

  const endTouchDrag = (commitPoint: LngLat | null) => {
    map.off("touchmove", onRouteTouchMove);
    map.off("touchend", onRouteTouchEnd);
    map.off("touchcancel", onRouteTouchCancel);
    isDraggingRoute = false;

    if (dragMode && commitPoint) {
      if (dragMode.kind === "move") {
        waypoints[dragMode.index] = commitPoint;
        trackEvent("waypoint_moved", { waypoint_index: dragMode.index });
      } else {
        waypoints.splice(dragMode.index, 0, commitPoint);
        trackEvent("waypoint_added", { waypoint_count: waypoints.length });
      }
      dragMode = null;
      void navigate({ fit: false });
    } else if (dragMode) {
      dragMode = null;
      if (lastRouteFeature) {
        setLineData(lastRouteFeature);
        setRainData(lastRainFeatureCollection);
      }
    }
  };

  const applyEditModeState = () => {
    editConfirmGroup.hidden = !isEditMode;
    editStartBtn.hidden = isEditMode || !isTouchDevice();
    document.body.classList.toggle("is-route-edit-mode", isEditMode);

    if (isEditMode) {
      map.dragPan.disable();
    } else {
      if (dragMode) endTouchDrag(null);
      map.dragPan.enable();
      hideToast();
    }
    updateHintBubble();
    updateEditRainHint();
  };

  const navigate = async (opts: { fit?: boolean; isInitialRequest?: boolean } = {}) => {
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

    routeSheetStatus.textContent = "Finding route…";
    routeSheetStatus.hidden = false;
    routeSheet.hidden = false;

    try {
      const response = await fetch(`/api/route?${params.toString()}`);
      if (!response.ok) throw new Error(`Route fetch failed: ${response.status}`);
      const route = (await response.json()) as Route;
      const feature = toGeoJson(route);
      const rainCollection = toRainGeoJson(route);
      lastRoute = route;
      lastRouteAnchors = [origin, ...waypoints, destination];
      lastRouteHasRain = rainCollection.features.length > 0;
      hasDismissedRainHint = false;
      if (opts.isInitialRequest) {
        trackEvent("route_requested", {
          waypoint_count: waypoints.length,
          has_rain_hint: lastRouteHasRain,
        });
      }
      if (fit) fitToRoute(feature);
      routeSheetStatus.hidden = true;
      showSummary(route);
      updateHintBubble();

      drawRoute(feature, rainCollection);
      updateEditRainHint();
      hideToast();
      drawWaypoints();
    } catch {
      routeSheetStatus.hidden = true;
      hideSummary();
      showToast("Couldn't fetch a route - try again", false);
    }
  };

  editStartBtn.hidden = !isTouchDevice();
  editStartBtn.disabled = true;
  editConfirmGroup.hidden = true;
  exportBtn.disabled = true;
  backBtn.disabled = true;

  editStartBtn.addEventListener("click", () => {
    if (editStartBtn.disabled) return;
    trackEvent("route_edit_start");
    waypointsBeforeEdit = [...waypoints];
    isEditMode = true;
    applyEditModeState();
  });

  editSaveBtn.addEventListener("click", () => {
    if (!isEditMode) return;
    trackEvent("route_edit_saved", {
      waypoint_count_delta: waypoints.length - waypointsBeforeEdit.length,
    });
    isEditMode = false;
    applyEditModeState();
  });

  editDiscardBtn.addEventListener("click", () => {
    if (!isEditMode) return;
    trackEvent("route_edit_discarded");
    isEditMode = false;
    applyEditModeState();
    waypoints = [...waypointsBeforeEdit];
    void navigate({ fit: false });
  });

  exportBtn.addEventListener("click", () => {
    if (!lastRoute || !lastRouteAnchors) return;
    trackEvent("route_exported", { waypoint_count: waypoints.length });
    const points = buildExportPoints(lastRoute, lastRouteAnchors);
    window.open(buildGoogleMapsUrl(points), "_blank", "noopener,noreferrer");
  });

  toastDismiss.addEventListener("click", () => {
    trackEvent("route_toast_dismissed");
    hideToast();
  });
  editRainHintDismiss.addEventListener("click", () => {
    trackEvent("rain_hint_dismissed");
    dismissEditRainHint();
  });

  routeReset.addEventListener("click", () => {
    trackEvent("route_reset");
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
  map.on("touchstart", onRouteTouchStart);
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
    },
    setDestination: (result: GeocodeResult) => {
      destination = { lat: result.lat, lon: result.lon };
      destinationLabel = result.name;
      waypoints = [];
      clearRoute();
      hideToast();
    },
    navigateNow: async () => {
      waypoints = [];
      await navigate({ isInitialRequest: true });
    },
    cancelRoute: () => {
      trackEvent("route_cancelled", { stage: lastRoute ? "after_result" : "before_request" });
      clearRoute();
      hideToast();
    },
    reattach: () => {
      if (lastRouteFeature) drawRoute(lastRouteFeature, lastRainFeatureCollection);
      drawWaypoints();
    },
  };
}
