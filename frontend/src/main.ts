import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { layers, namedFlavor } from "@protomaps/basemaps";
import type { GeocodeResult } from "./types";
import { createLocationSearch } from "./search";
import { initRadar } from "./radar";
import { initRoute } from "./route";
import { initDevMode } from "./devmode";
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
      <div class="app-header__actions">
        <button class="devmode-toggle" type="button" aria-label="Toggle dev rain-zone testing mode" aria-pressed="false" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5s6.5 7 6.5 11.5a6.5 6.5 0 1 1-13 0C5.5 9.5 12 2.5 12 2.5z"/></svg>
        </button>
        <button class="theme-toggle" type="button" aria-label="Toggle light/dark theme">
          <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
        </button>
      </div>
    </header>
    <div class="search-pill-group">
      <div class="search search--destination">
        <span class="search__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        </span>
        <input
          class="search__input"
          type="text"
          placeholder="Where to?"
          autocomplete="off"
        />
        <ul class="search__results" hidden></ul>
      </div>
      <div class="search search--origin">
        <span class="search__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        </span>
        <input
          class="search__input"
          type="text"
          placeholder="Search a location in Singapore"
          autocomplete="off"
        />
        <ul class="search__results" hidden></ul>
      </div>
      <p class="search-hint" hidden aria-live="polite"></p>
      <button class="navigate-button" type="button" hidden>Navigate</button>
    </div>
    <div class="route-hint-bubble" hidden>Drag the route to customise</div>
    <div class="route-toast" hidden>
      <span class="route-toast__dot"></span>
      <span class="route-toast__message"></span>
      <button class="route-toast__cancel" type="button" aria-label="Dismiss">Dismiss</button>
    </div>
    <div class="map-controls">
      <button class="recenter-btn" type="button" aria-label="Recenter on my location">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
      </button>
      <button class="radar-toggle-btn is-active" type="button" aria-label="Toggle rain radar" aria-pressed="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5s6.5 7 6.5 11.5a6.5 6.5 0 1 1-13 0C5.5 9.5 12 2.5 12 2.5z"/></svg>
      </button>
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
          <button class="route-reset" type="button" hidden>Reset</button>
          <div class="route-sheet__more">
            <button class="route-sheet__more-btn" type="button" aria-label="More export options" aria-haspopup="true" disabled>&#8943;</button>
            <div class="route-sheet__more-menu" hidden>
              <button class="share-menu__option share-menu__option--apple" type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>
                <span>Open in Apple Maps</span>
              </button>
            </div>
          </div>
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
  });
  map.addControl(new maplibregl.NavigationControl(), "bottom-right");
  const radar = initRadar(map);
  const devMode = initDevMode(map);
  const route = initRoute(map, devMode.isOn);

  let originSet = false;
  let bootstrapInFlight = false;

  const originGroup = document.querySelector<HTMLDivElement>(".search--origin");
  const originInput = document.querySelector<HTMLInputElement>(".search--origin .search__input");
  const hint = document.querySelector<HTMLParagraphElement>(".search-hint");
  const navigateButton = document.querySelector<HTMLButtonElement>(".navigate-button");
  const recenterBtn = document.querySelector<HTMLButtonElement>(".recenter-btn");

  const revealOrigin = () => originGroup?.classList.add("is-shown");
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
    inputSelector: ".search--origin .search__input",
    listSelector: ".search--origin .search__results",
    markerColorVar: "--dry",
    onSelect: (result) => {
      originSet = true;
      clearHint();
      route.setOrigin(result);
    },
  });
  createLocationSearch(map, {
    inputSelector: ".search--destination .search__input",
    listSelector: ".search--destination .search__results",
    markerColorVar: "--rain",
    onSelect: (result) => route.setDestination(result),
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
        return;
      } finally {
        bootstrapInFlight = false;
        navigateButton.disabled = false;
      }
    }
    void route.navigateNow();
  };

  navigateButton?.addEventListener("click", () => {
    void handleNavigateClick();
  });

  recenterBtn?.addEventListener("click", () => {
    void (async () => {
      try {
        const point = await getCurrentLocation();
        map.flyTo({ center: [point.lon, point.lat], zoom: Math.max(map.getZoom(), 15) });
      } catch {
        // Silent failure is acceptable for a convenience recenter action.
      }
    })();
  });

  const toggle = document.querySelector<HTMLButtonElement>(".theme-toggle");
  toggle?.addEventListener("click", () => {
    const next: Theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);
    map.setStyle(buildMapStyle(next));
    radar.reattach();
    devMode.reattach();
    route.reattach();
  });
}
