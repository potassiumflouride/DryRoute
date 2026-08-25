import maplibregl from "maplibre-gl";
import type { GeocodeResult } from "@dryroute/shared-types";

const DEBOUNCE_MS = 300;

export interface LocationSearch {
  setValue: (name: string) => void;
  clear: () => void;
}

export function createLocationSearch(
  map: maplibregl.Map,
  opts: {
    inputSelector: string;
    listSelector: string;
    markerColorVar: string;
    onSelect: (result: GeocodeResult) => void;
  },
): LocationSearch {
  const input = document.querySelector<HTMLInputElement>(opts.inputSelector);
  const list = document.querySelector<HTMLUListElement>(opts.listSelector);

  const noop: LocationSearch = { setValue: () => {}, clear: () => {} };
  if (!input || !list) return noop;

  let marker: maplibregl.Marker | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let requestId = 0;

  const renderResults = (results: GeocodeResult[]) => {
    list.innerHTML = "";
    if (results.length === 0) {
      list.hidden = true;
      return;
    }
    for (const result of results) {
      const item = document.createElement("li");
      item.className = "search__result";
      item.innerHTML = `
        <span class="search__result-name">${escapeHtml(result.name)}</span>
        <span class="search__result-address">${escapeHtml(result.address)}</span>
      `;
      item.addEventListener("click", () => selectResult(result));
      list.appendChild(item);
    }
    list.hidden = false;
  };

  const selectResult = (result: GeocodeResult) => {
    map.flyTo({ center: [result.lon, result.lat], zoom: 16 });

    if (marker) {
      marker.remove();
    }
    marker = new maplibregl.Marker({
      color: getComputedStyle(document.documentElement).getPropertyValue(opts.markerColorVar).trim(),
    })
      .setLngLat([result.lon, result.lat])
      .addTo(map);

    input.value = result.name;
    list.hidden = true;
    input.blur();
    opts.onSelect(result);
  };

  const search = async (query: string) => {
    const thisRequest = ++requestId;
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error(`Search failed: ${response.status}`);
      const results = (await response.json()) as GeocodeResult[];
      if (thisRequest !== requestId) return; // stale response, a newer query is in flight
      renderResults(results);
    } catch {
      if (thisRequest !== requestId) return;
      list.hidden = true;
    }
  };

  input.addEventListener("input", () => {
    const query = input.value.trim();
    clearTimeout(debounceTimer);
    if (query.length < 2) {
      list.hidden = true;
      return;
    }
    debounceTimer = setTimeout(() => void search(query), DEBOUNCE_MS);
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Node)) return;
    if (!list.contains(event.target) && event.target !== input) {
      list.hidden = true;
    }
  });

  return {
    setValue: (name: string) => {
      input.value = name;
    },
    clear: () => {
      input.value = "";
      list.hidden = true;
      if (marker) {
        marker.remove();
        marker = null;
      }
    },
  };
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
