import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { layers, namedFlavor } from "@protomaps/basemaps";
import type { GeocodeResult } from "./types";
import { createLocationSearch } from "./search";
import { MapAttributionControl } from "./attribution";
import { initSheetDrag } from "./sheetDrag";
import { initRadar } from "./radar";
import { initRoute } from "./route";
import { initSettingsTray } from "./settingsTray";
import { initOnboarding } from "./onboarding";
import { applyTheme, getInitialTheme, type Theme } from "./theme";
import { getCurrentLocation } from "./geolocation";
import { trackEvent } from "./analytics";
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
      <button class="settings-toggle-btn" type="button" aria-label="Open settings" aria-expanded="false" aria-controls="settings-tray">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      </button>
      <img class="app-header__mark" src="/pwa-192x192.png" alt="" />
      <span class="app-header__wordmark">Dry<strong>Route</strong></span>
      <div class="app-header__actions"></div>
    </header>
    <div class="settings-tray" id="settings-tray" aria-hidden="true">
      <div class="settings-tray__backdrop"></div>
      <div class="settings-tray__panel" role="dialog" aria-modal="true" aria-label="Settings">
        <div class="settings-tray__header">
          <span class="settings-tray__title">Settings</span>
          <button class="settings-tray__close-btn" type="button" aria-label="Close settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="settings-tray__body">
          <section class="settings-tray__section">
            <h3 class="settings-tray__section-title">Report a bug or give feedback</h3>
            <a class="settings-tray__link settings-tray__email-link" href="mailto:feedback@example.com">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="m22 6-10 7L2 6"/></svg>
              feedback@example.com
            </a>
            <a class="settings-tray__link settings-tray__feedback-link" href="#" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>
              Report an issue
            </a>
          </section>
          <section class="settings-tray__section">
            <h3 class="settings-tray__section-title">About</h3>
            <button class="settings-tray__link settings-tray__onboarding-btn" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 4v5h5"/></svg>
              Show onboarding
            </button>
          </section>
        </div>
      </div>
    </div>
    <div class="onboarding-overlay" aria-hidden="true">
      <div class="onboarding-overlay__backdrop"></div>
      <div class="onboarding-overlay__panel" role="dialog" aria-modal="true" aria-label="Welcome to DryRoute">
        <button class="onboarding-skip-btn" type="button">Skip</button>
        <div class="onboarding-track">
          <div class="onboarding-slide onboarding-slide--welcome">
            <div class="onboarding-welcome">
              <img class="onboarding-welcome__mark" src="/pwa-192x192.png" alt="" />
              <p class="onboarding-wordmark">Dry<strong>Route</strong></p>
              <p class="onboarding-welcome__tagline">Ride around the <span class="onboarding-accent-rain">rain.</span></p>
              <p class="onboarding-welcome__sub">Live rain radar for riders in Singapore, right on your route.</p>
            </div>
          </div>
          <div class="onboarding-slide">
            <div class="onboarding-visual">
              <div class="onboarding-radar-visual">
                <div class="onboarding-radar-grid"></div>
                <div class="onboarding-rain-blob onboarding-rain-blob--1"></div>
                <div class="onboarding-rain-blob onboarding-rain-blob--2"></div>
                <div class="onboarding-rain-blob onboarding-rain-blob--3"></div>
                <div class="onboarding-radar-pulse"><span class="onboarding-radar-pulse__dot"></span> Live &middot; NEA radar</div>
                <svg class="onboarding-radar-route" viewBox="0 0 240 240" fill="none">
                  <path d="M30 210 C 80 190, 100 150, 130 120 S 190 60, 210 30" stroke="var(--dry)" stroke-width="4" stroke-linecap="round" opacity="0.9"/>
                </svg>
              </div>
            </div>
            <div class="onboarding-copy">
              <p class="onboarding-eyebrow">Step 1</p>
              <h2>See the rain before you ride into it</h2>
              <p class="onboarding-desc">Live radar from NEA sits right on your map, refreshed every few minutes, so you know what's ahead.</p>
            </div>
          </div>
          <div class="onboarding-slide">
            <div class="onboarding-visual">
              <div class="onboarding-drag-visual">
                <div class="onboarding-drag-blob"></div>
                <div class="onboarding-hint-bubble">Drag to route around it</div>
                <svg viewBox="0 0 260 220" fill="none" class="onboarding-drag-svg">
                  <path d="M10 190 Q 70 60, 130 100 T 250 40" stroke="var(--rain)" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 9" opacity="0.5"/>
                  <path d="M10 190 Q 70 190, 130 140 T 250 40" stroke="var(--dry)" stroke-width="4" stroke-linecap="round"/>
                </svg>
                <div class="onboarding-waypoint"></div>
              </div>
            </div>
            <div class="onboarding-copy">
              <p class="onboarding-eyebrow">Step 2</p>
              <h2>Drag your route <span class="onboarding-accent-dry">around</span> the rain</h2>
              <p class="onboarding-desc">Pull your path away from the wet patches. DryRoute keeps the rest of the route riding-friendly.</p>
            </div>
          </div>
          <div class="onboarding-slide">
            <div class="onboarding-visual">
              <div class="onboarding-export-visual">
                <div class="onboarding-export-card">
                  <div class="onboarding-export-icon onboarding-export-icon--google">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M12 2C7.6 2 4 5.6 4 10c0 5.2 6.5 11 7.3 11.7.4.3 1 .3 1.4 0C13.5 21 20 15.2 20 10c0-4.4-3.6-8-8-8z" fill="white" opacity="0.95"/><circle cx="12" cy="10" r="3" fill="#4285f4"/></svg>
                  </div>
                  <div class="onboarding-export-text">
                    <p class="onboarding-export-title">Google Maps</p>
                    <p class="onboarding-export-sub">Turn-by-turn on your dry route</p>
                  </div>
                </div>
                <div class="onboarding-export-card">
                  <div class="onboarding-export-icon onboarding-export-icon--apple">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M16.5 2.5c.1 1-.3 2-1 2.8-.7.8-1.8 1.4-2.9 1.3-.1-1 .4-2 1-2.8.7-.8 1.9-1.4 2.9-1.3zM19.7 17.4c-.5 1.2-.8 1.7-1.5 2.7-1 1.4-2.3 3.2-4 3.2-1.5 0-1.9-1-3.9-1s-2.5 1-3.9 1c-1.7 0-3-1.6-4-3-2.4-3.4-2.7-7.5-1.2-9.6.8-1.2 2.2-2 3.6-2 1.5 0 2.4 1 3.7 1s2-.9 3.9-.9c1.4 0 2.9.7 3.9 1.9-3.4 1.9-2.9 6.7.4 7.7z" fill="white"/></svg>
                  </div>
                  <div class="onboarding-export-text">
                    <p class="onboarding-export-title">Apple Maps</p>
                    <p class="onboarding-export-sub">Turn-by-turn on your dry route</p>
                  </div>
                </div>
              </div>
            </div>
            <div class="onboarding-copy">
              <p class="onboarding-eyebrow">Step 3</p>
              <h2>Take it to <span class="onboarding-accent-rain">your</span> maps app</h2>
              <p class="onboarding-desc">When your route looks good, send it straight to Google Maps or Apple Maps for turn-by-turn.</p>
            </div>
          </div>
        </div>
        <div class="onboarding-bottom-nav">
          <button class="onboarding-back-btn is-hidden" type="button" aria-label="Back">
            <svg viewBox="0 0 16 16" fill="none"><path d="M13 8H3M7 4L3 8l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="onboarding-dots">
            <button class="onboarding-dot is-active" type="button" aria-label="Screen 1" aria-current="true"></button>
            <button class="onboarding-dot" type="button" aria-label="Screen 2" aria-current="false"></button>
            <button class="onboarding-dot" type="button" aria-label="Screen 3" aria-current="false"></button>
            <button class="onboarding-dot" type="button" aria-label="Screen 4" aria-current="false"></button>
          </div>
          <button class="onboarding-next-btn" type="button">
            <span class="onboarding-next-btn__label">Next</span>
            <svg viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
    </div>
    <div class="route-hint-bubble" hidden>Drag the route to customise</div>
    <div class="route-toast" hidden>
      <span class="route-toast__dot"></span>
      <span class="route-toast__message"></span>
      <button class="route-toast__cancel" type="button" aria-label="Dismiss">Dismiss</button>
    </div>
    <div class="map-controls">
      <div class="edit-hint-group">
        <button class="edit-start-btn" type="button" aria-label="Edit route" disabled hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        </button>
        <p class="edit-rain-hint" hidden aria-live="polite">
          <span class="edit-rain-hint__dot"></span>
          <span class="edit-rain-hint__text">Route crosses rain - tap edit to reroute</span>
          <button class="edit-rain-hint__dismiss" type="button" aria-label="Dismiss">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </p>
      </div>
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
        </div>
        <div class="location-sheet__body">
          <ul class="search__results location-sheet__destination-results" hidden></ul>
          <ul class="search__results location-sheet__origin-results" hidden></ul>
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
  initSettingsTray();
  const onboarding = initOnboarding();
  document.querySelector<HTMLButtonElement>(".settings-tray__onboarding-btn")?.addEventListener("click", () => {
    document.querySelector<HTMLButtonElement>(".settings-tray__close-btn")?.click();
    onboarding.open("replay");
  });

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
    listSelector: ".location-sheet__origin-results",
    markerColorVar: "--dry",
    analyticsField: "origin",
    onSelect: (result) => {
      originSet = true;
      clearHint();
      route.setOrigin(result);
      trackEvent("origin_selected", { origin_source: "search" });
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
    analyticsField: "destination",
    onSelect: (result) => {
      route.setDestination(result);
      if (navigateButton) navigateButton.hidden = false;
      trackEvent("destination_selected");
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
        trackEvent("current_location_used", { success: true });
        trackEvent("origin_selected", { origin_source: "current_location" });
      } catch (reason) {
        clearHint();
        setHint("Couldn't get your location - search for a starting point");
        originInput?.focus();
        trackEvent("current_location_used", { success: false });
        trackEvent("geolocation_error", { error_code: String(reason) });
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
    trackEvent("geolocation_error", { error_code: event.code });
    showRecenterHint(
      event.code === 1 ? "Location access is off - allow it in your browser settings" : "Couldn't get your location",
    );
  });

  recenterBtn?.addEventListener("click", () => {
    geolocate.trigger();
  });
}
