import type { IControl, Map as MapLibreMap } from "maplibre-gl";

export class MapAttributionControl implements IControl {
  private container?: HTMLDivElement;
  private bubble?: HTMLDivElement;
  private onDocumentClick = (event: MouseEvent) => {
    if (!(event.target instanceof Node)) return;
    if (this.container && !this.container.contains(event.target)) {
      this.bubble?.setAttribute("hidden", "");
    }
  };

  onAdd(_map: MapLibreMap): HTMLElement {
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl map-attribution";
    container.innerHTML = `
      <button class="map-attribution__info-btn" type="button" aria-label="Map & Data Sources"></button>
      <a class="map-attribution__text" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap</a>
      <div class="map-attribution__bubble" hidden>
        <span class="map-attribution__eyebrow">Map &amp; Data Sources</span>
        <dl class="map-attribution__list">
          <div class="map-attribution__row">
            <dt>Map data</dt>
            <dd>&copy; OpenStreetMap contributors, licensed under the ODbL.</dd>
          </div>
          <div class="map-attribution__row">
            <dt>Basemap</dt>
            <dd>Protomaps, using OpenStreetMap data.</dd>
          </div>
          <div class="map-attribution__row">
            <dt>Rain radar</dt>
            <dd>Weather Radar Images from the National Environment Agency (NEA) via data.gov.sg</dd>
          </div>
          <div class="map-attribution__row">
            <dt>Geocoding</dt>
            <dd>OneMap, Singapore Land Authority (SLA).</dd>
          </div>
          <div class="map-attribution__row">
            <dt>Routing</dt>
            <dd>Powered by Valhalla using OpenStreetMap data.</dd>
          </div>
          <div class="map-attribution__row">
            <dt>Map rendering</dt>
            <dd>MapLibre GL JS.</dd>
          </div>
        </dl>
      </div>
    `;

    this.container = container;
    this.bubble = container.querySelector<HTMLDivElement>(".map-attribution__bubble") ?? undefined;
    const infoButton = container.querySelector<HTMLButtonElement>(".map-attribution__info-btn");

    infoButton?.addEventListener("click", (event) => {
      event.stopPropagation();
      this.bubble?.toggleAttribute("hidden");
    });

    document.addEventListener("click", this.onDocumentClick);

    return container;
  }

  onRemove(): void {
    document.removeEventListener("click", this.onDocumentClick);
    this.container?.remove();
    this.container = undefined;
    this.bubble = undefined;
  }
}
