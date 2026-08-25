import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { createLocationSearch } from "./search";
import { initRadar } from "./radar";
import { initRoute } from "./route";
import { initDevMode } from "./devmode";
import { applyTheme, getInitialTheme, type Theme } from "./theme";
import "./style.css";

const TILES_SOURCE = "protomaps";
const TILES_URL = "/tiles/singapore/{z}/{x}/{y}.mvt";

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
    <div class="search-group">
      <div class="search search--origin">
        <input
          class="search__input"
          type="text"
          placeholder="Search a location in Singapore"
          autocomplete="off"
        />
        <ul class="search__results" hidden></ul>
      </div>
      <div class="search search--waypoint" hidden>
        <div class="search__waypoint-row">
          <input class="search__input" type="text" placeholder="Waypoint" readonly />
          <button class="search__waypoint-clear" type="button" aria-label="Remove waypoint">&times;</button>
        </div>
      </div>
      <div class="search search--destination">
        <input
          class="search__input"
          type="text"
          placeholder="Add a destination"
          autocomplete="off"
        />
        <ul class="search__results" hidden></ul>
      </div>
      <button class="navigate-button" type="button" disabled>Navigate</button>
      <div class="route-summary" hidden></div>
    </div>
    <div class="route-toast" hidden>
      <span class="route-toast__dot"></span>
      <span class="route-toast__message"></span>
      <button class="route-toast__cancel" type="button" aria-label="Cancel waypoint selection">Cancel</button>
    </div>
    <div class="radar-scrubber" role="group" aria-label="Rain radar playback">
      <div class="radar-scrubber__row">
        <button class="radar-scrubber__play" type="button" aria-label="Play radar replay" aria-pressed="false">
          <svg class="icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <svg class="icon-pause" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
        </button>
        <div class="radar-scrubber__track">
          <div class="radar-scrubber__bars"></div>
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
        <div class="radar-scrubber__status">
          <span class="radar-scrubber__badge is-live">
            <span class="radar-scrubber__dot"></span>
            <span class="radar-scrubber__badge-label">Live</span>
          </span>
          <span class="radar-scrubber__time">&ndash;&ndash;:&ndash;&ndash;</span>
          <span class="radar-scrubber__offset">&nbsp;</span>
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
    fitBoundsOptions: { padding: 24 },
  });
  map.addControl(new maplibregl.NavigationControl());
  const radar = initRadar(map);
  const devMode = initDevMode(map);
  const route = initRoute(map, devMode.isOn);

  createLocationSearch(map, {
    inputSelector: ".search--origin .search__input",
    listSelector: ".search--origin .search__results",
    markerColorVar: "--dry",
    onSelect: (result) => route.setOrigin(result),
  });
  createLocationSearch(map, {
    inputSelector: ".search--destination .search__input",
    listSelector: ".search--destination .search__results",
    markerColorVar: "--rain",
    onSelect: (result) => route.setDestination(result),
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
