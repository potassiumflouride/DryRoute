import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { layers, namedFlavor } from "@protomaps/basemaps";
import type { GeocodeResult } from "./types";
import { createLocationSearch } from "./search";
import { MapAttributionControl } from "./attribution";
import { initSheetDrag } from "./sheetDrag";
import { initRadar } from "./radar";
import { initRoute } from "./route";
import { applyTheme, getInitialTheme, type Theme } from "./theme";
import { getCurrentLocation } from "./geolocation";
import "./style.css";

const TILES_SOURCE = "protomaps";
const TILES_URL = "/tiles/dryroute/{z}/{x}/{y}.mvt";

function buildMapStyle(theme: Theme): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sprite: `https://protomaps.github.io/basemaps-assets/sprites/v4/${theme}`,
    sources: {
      [TILES_SOURCE]: {
        type: "vector",
        tiles: [`${window.location.origin}${TILES_URL}`],
        minzoom: 0,
        maxzoom: 15,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: layers(TILES_SOURCE, namedFlavor(theme), { lang: "en" }),
  };
}

const theme = getInitialTheme();
applyTheme(theme);

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.innerHTML = `
    <header class="app-header">
      <img class="app-header__mark" src="/pwa-192x192.png" alt="" />
      <span class="app-header__wordmark">Dry<strong>Route</strong></span>
      <div class="app-header__actions"></div>
    </header>
    <div class="route-hint-bubble" hidden>Drag the route to customise</div>
    <div class="route-toast" hidden>
      <span class="route-toast__dot"></span>
      <span class="route-toast__message"></span>
      <button class="route-toast__cancel" type="button" aria-label="Dismiss">Dismiss</button>
    </div>
    <div class="map-controls">
      <button class="edit-start-btn" type="button" aria-label="Edit route" disabled hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
      </button>
      <div class="edit-confirm-group" hidden>
        <button class="edit-save-btn" type="button" aria-label="Save changes">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
        </button>
        <button class="edit-discard-btn" type="button" aria-label="Discard changes">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="recenter-group">
        <button class="recenter-btn" type="button" aria-label="Recenter on my location">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        </button>
        <p class="recenter-hint" hidden aria-live="polite"></p>
      </div>
    </div>
    <div class="bottom-stack">
      <div class="radar-player" role="group" aria-label="Rain radar playback">
        <button class="radar-scrubber__play" type="button" aria-label="Play radar replay" aria-pressed="false">
          <svg class="icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <svg class="icon-pause" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
        </button>
        <span class="radar-scrubber__badge is-live">
          <span class="radar-scrubber__dot"></span>
          <span class="radar-scrubber__badge-label">Live</span>
        </span>
        <span class="radar-scrubber__time">&ndash;&ndash;:&ndash;&ndash;</span>
        <span class="radar-scrubber__offset">&nbsp;</span>
        <div class="radar-scrubber__track">
          <div class="radar-scrubber__playhead"></div>
          <input
            class="radar-scrubber__range"
            type="range"
            min="0"
            max="11"
            value="11"
            step="1"
            aria-label="Radar frame, last hour"
          />
        </div>
        <p class="radar-player__status" hidden></p>
      </div>
      <div class="location-sheet">
        <div class="location-sheet__handle"></div>
        <div class="search search--destination location-sheet__destination">
          <div class="search__field">
            <span class="search__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            </span>
            <input
              class="search__input"
              type="text"
              placeholder="Where to?"
              autocomplete="off"
            />
            <button class="search__clear" type="button" aria-label="Clear destination" hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        <div class="location-sheet__body">
          <ul class="search__results location-sheet__destination-results" hidden></ul>
          <div class="search search--origin location-sheet__origin" hidden>
            <div class="search__field">
              <span class="search__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
              </span>
              <input
                class="search__input"
                type="text"
                placeholder="Search a location in Singapore"
                autocomplete="off"
              />
              <button class="search__clear" type="button" aria-label="Clear location" hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <ul class="search__results" hidden></ul>
          </div>
          <p class="search-hint" hidden aria-live="polite"></p>
          <div class="location-sheet__navigate-row">
            <button class="cancel-button" type="button" hidden>Cancel</button>
            <button class="navigate-button" type="button" hidden>Navigate</button>
          </div>
        </div>
      </div>
      <div class="route-sheet" hidden>
        <div class="route-sheet__handle"></div>
        <p class="route-sheet__status" hidden></p>
        <div class="route-sheet__summary">
          <div class="route-sheet__info">
            <strong class="route-sheet__destination"></strong>
            <span class="route-summary"></span>
          </div>
        </div>
        <div class="route-sheet__actions">
          <button class="route-sheet__back-btn" type="button" aria-label="Back to edit starting point" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
          <button class="route-reset" type="button" hidden>Reset</button>
          <button class="route-sheet__export-btn" type="button" disabled>Open in Google Maps &#8599;</button>
        </div>
      </div>
    </div>
    <div id="map"></div>
  `;

  const map = new maplibregl.Map({
    container: "map",
    style: buildMapStyle(theme),
    bounds: [
      [103.59, 1.16], // SW
      [104.05, 1.48], // NE
    ],
    fitBoundsOptions: { padding: { top: 24, bottom: 24, right: 24, left: 24 } },
    attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showZoom: false }), "bottom-right");
  map.addControl(new MapAttributionControl(), "bottom-left");
  const geolocate = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: false },
    trackUserLocation: false,
    showUserLocation: true,
    showAccuracyCircle: true,
  });
  map.addControl(geolocate, "top-left");
  initRadar(map);
  const route = initRoute(map);

  let originSet = false;
  let bootstrapInFlight = false;

  const plannerSheet = document.querySelector<HTMLDivElement>(".location-sheet");
  const plannerSheetHandle = document.querySelector<HTMLDivElement>(".location-sheet__handle");
  const sheetDrag =
    plannerSheet && plannerSheetHandle ? initSheetDrag(plannerSheet, plannerSheetHandle) : null;

  const originGroup = document.querySelector<HTMLDivElement>(".location-sheet__origin");
  const originInput = document.querySelector<HTMLInputElement>(".location-sheet__origin .search__input");
  const hint = document.querySelector<HTMLParagraphElement>(".search-hint");
  const navigateButton = document.querySelector<HTMLButtonElement>(".navigate-button");
  const cancelButton = document.querySelector<HTMLButtonElement>(".cancel-button");
  const recenterBtn = document.querySelector<HTMLButtonElement>(".recenter-btn");
  const recenterHint = document.querySelector<HTMLParagraphElement>(".recenter-hint");

  const showPlannerSheet = () => {
    if (plannerSheet) plannerSheet.hidden = false;
    sheetDrag?.expand();
  };
  const hidePlannerSheet = () => {
    if (plannerSheet) plannerSheet.hidden = true;
  };
  const revealOrigin = () => {
    if (originGroup) originGroup.hidden = false;
    if (cancelButton) cancelButton.hidden = false;
  };
  const hideOrigin = () => {
    if (originGroup) originGroup.hidden = true;
    if (cancelButton) cancelButton.hidden = true;
    originSet = false;
    clearHint();
  };
  const setHint = (text: string) => {
    if (!hint) return;
    hint.textContent = text;
    hint.hidden = false;
  };
  const clearHint = () => {
    if (!hint) return;
    hint.hidden = true;
    hint.textContent = "";
  };

  const originSearch = createLocationSearch(map, {
    inputSelector: ".location-sheet__origin .search__input",
    listSelector: ".location-sheet__origin .search__results",
    markerColorVar: "--dry",
    onSelect: (result) => {
      originSet = true;
      clearHint();
      route.setOrigin(result);
    },
    onClear: () => {
      originSet = false;
      clearHint();
    },
  });
  createLocationSearch(map, {
    inputSelector: ".location-sheet__destination .search__input",
    listSelector: ".location-sheet__destination-results",
    markerColorVar: "--rain",
    onSelect: (result) => {
      route.setDestination(result);
      if (navigateButton) navigateButton.hidden = false;
    },
    onClear: () => {
      if (navigateButton) navigateButton.hidden = true;
      hideOrigin();
    },
    onMarkerClick: () => {
      showPlannerSheet();
    },
  });

  cancelButton?.addEventListener("click", () => {
    originSearch.clear();
    hideOrigin();
  });

  const handleNavigateClick = async (): Promise<void> => {
    if (!navigateButton || bootstrapInFlight) return;
    if (!originSet) {
      bootstrapInFlight = true;
      navigateButton.disabled = true;
      revealOrigin();
      setHint("Finding your location…");
      try {
        const point = await getCurrentLocation();
        if (originSet) return; // user picked a manual origin while we waited
        const result: GeocodeResult = { name: "Current location", address: "", lat: point.lat, lon: point.lon };
        originSet = true;
        originSearch.setExternalSelection(result, { flyTo: false });
        route.setOrigin(result);
        clearHint();
      } catch {
        clearHint();
        setHint("Couldn't get your location - search for a starting point");
        originInput?.focus();
      } finally {
        bootstrapInFlight = false;
        navigateButton.disabled = false;
      }
      return; // let the user review/edit the origin before actually routing
    }
    hidePlannerSheet();
    void route.navigateNow();
  };

  navigateButton?.addEventListener("click", () => {
    void handleNavigateClick();
  });

  const backBtn = document.querySelector<HTMLButtonElement>(".route-sheet__back-btn");
  backBtn?.addEventListener("click", () => {
    if (backBtn.disabled) return;
    route.cancelRoute();
    revealOrigin();
    showPlannerSheet();
  });

  let recenterHintTimer: ReturnType<typeof setTimeout> | undefined;
  const showRecenterHint = (text: string) => {
    if (!recenterHint) return;
    recenterHint.textContent = text;
    recenterHint.hidden = false;
    clearTimeout(recenterHintTimer);
    recenterHintTimer = setTimeout(() => {
      recenterHint.hidden = true;
    }, 4000);
  };

  geolocate.on("error", (event) => {
    showRecenterHint(
      event.code === 1 ? "Location access is off - allow it in your browser settings" : "Couldn't get your location",
    );
  });

  recenterBtn?.addEventListener("click", () => {
    geolocate.trigger();
  });
}
