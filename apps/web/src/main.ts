import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { initSearch } from "./search";
import "./style.css";

const TILES_SOURCE = "protomaps";
const TILES_URL = "/tiles/singapore/{z}/{x}/{y}.mvt";

const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.innerHTML = `
    <header class="app-header">
      <img class="app-header__mark" src="/pwa-192x192.png" alt="" />
      <span class="app-header__wordmark">Dry<strong>Route</strong></span>
    </header>
    <div class="search">
      <input
        class="search__input"
        type="text"
        placeholder="Search a location in Singapore"
        autocomplete="off"
      />
      <ul class="search__results" hidden></ul>
    </div>
    <div id="map"></div>
  `;

  const map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
      sprite: "https://protomaps.github.io/basemaps-assets/sprites/v4/dark",
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
      layers: layers(TILES_SOURCE, namedFlavor("dark"), { lang: "en" }),
    },
    bounds: [
      [103.59, 1.16], // SW
      [104.05, 1.48], // NE
    ],
    fitBoundsOptions: { padding: 24 },
  });
  map.addControl(new maplibregl.NavigationControl());
  initSearch(map);
}
