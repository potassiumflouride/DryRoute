import maplibregl from "maplibre-gl";
import type { RadarFrame } from "./types";
import { addToMapWhenReady } from "./mapReady";

const POLL_MS = 5 * 60 * 1000;
const PLAY_INTERVAL_MS = 1200;
const SOURCE_ID = "radar";
const LAYER_ID = "radar-layer";

export interface RadarController {
  reattach: () => void;
}

export function initRadar(map: maplibregl.Map): RadarController {
  const root = document.querySelector<HTMLDivElement>(".radar-scrubber");
  const playButton = document.querySelector<HTMLButtonElement>(".radar-scrubber__play");
  const barsEl = document.querySelector<HTMLDivElement>(".radar-scrubber__bars");
  const playhead = document.querySelector<HTMLDivElement>(".radar-scrubber__playhead");
  const range = document.querySelector<HTMLInputElement>(".radar-scrubber__range");
  const badge = document.querySelector<HTMLSpanElement>(".radar-scrubber__badge");
  const badgeLabel = document.querySelector<HTMLSpanElement>(".radar-scrubber__badge-label");
  const timeLabel = document.querySelector<HTMLSpanElement>(".radar-scrubber__time");
  const offsetLabel = document.querySelector<HTMLSpanElement>(".radar-scrubber__offset");

  const noop: RadarController = { reattach: () => {} };
  if (
    !root ||
    !playButton ||
    !barsEl ||
    !playhead ||
    !range ||
    !badge ||
    !badgeLabel ||
    !timeLabel ||
    !offsetLabel
  ) {
    return noop;
  }

  let frames: RadarFrame[] = [];
  let currentIndex = 0;
  let isLive = true;
  let playing = false;
  let playTimer: ReturnType<typeof setInterval> | undefined;

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false });

  const sourceUrl = (frame: RadarFrame) => `/api/radar/frames/${encodeURIComponent(frame.timestamp)}.png`;

  const applySource = () => {
    const frame = frames[currentIndex];
    if (!frame) return;

    const { upperLeft, lowerRight } = frame.boundaryBox;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [upperLeft.longitude, upperLeft.latitude],
      [lowerRight.longitude, upperLeft.latitude],
      [lowerRight.longitude, lowerRight.latitude],
      [upperLeft.longitude, lowerRight.latitude],
    ];

    const source = map.getSource(SOURCE_ID) as maplibregl.ImageSource | undefined;
    if (source) {
      source.updateImage({ url: sourceUrl(frame), coordinates });
      return;
    }

    addToMapWhenReady(() => {
      if (map.getSource(SOURCE_ID)) return;
      map.addSource(SOURCE_ID, { type: "image", url: sourceUrl(frame), coordinates });
      map.addLayer({ id: LAYER_ID, type: "raster", source: SOURCE_ID, paint: { "raster-opacity": 0.6 } });
    });
  };

  const render = () => {
    const frame = frames[currentIndex];
    if (!frame) return;

    range.max = String(frames.length - 1);
    range.value = String(currentIndex);

    const pct = frames.length > 1 ? (currentIndex / (frames.length - 1)) * 100 : 100;
    playhead.style.left = `${pct}%`;

    Array.from(barsEl.children).forEach((bar, i) => bar.classList.toggle("is-active", i === currentIndex));

    badge.classList.toggle("is-live", isLive);
    badgeLabel.textContent = isLive ? "Live" : "Replay";
    timeLabel.textContent = formatTime(frame.timestamp);

    const latestFrame = frames[frames.length - 1];
    if (isLive || !latestFrame) {
      offsetLabel.textContent = "now";
    } else {
      const minutesAgo = Math.round((Date.parse(latestFrame.timestamp) - Date.parse(frame.timestamp)) / 60000);
      offsetLabel.textContent = minutesAgo > 0 ? `-${minutesAgo}m` : "now";
    }

    applySource();
  };

  const rebuildBars = () => {
    barsEl.innerHTML = "";
    const maxCoverage = Math.max(...frames.map((f) => f.coverage), 0.0001);
    for (const frame of frames) {
      const bar = document.createElement("div");
      bar.className = "radar-scrubber__bar";
      bar.style.height = `${Math.max(8, (frame.coverage / maxCoverage) * 100)}%`;
      barsEl.appendChild(bar);
    }
  };

  const setFrames = (nextFrames: RadarFrame[]) => {
    if (nextFrames.length === 0) return;

    const previousTimestamp = frames[currentIndex]?.timestamp;
    frames = nextFrames;
    range.min = "0";
    rebuildBars();

    if (isLive) {
      currentIndex = frames.length - 1;
    } else {
      const stillPresentIndex = frames.findIndex((f) => f.timestamp === previousTimestamp);
      currentIndex = stillPresentIndex >= 0 ? stillPresentIndex : frames.length - 1;
    }
    render();
  };

  const fetchFrames = async () => {
    try {
      const response = await fetch("/api/radar/frames");
      if (!response.ok) throw new Error(`Radar fetch failed: ${response.status}`);
      setFrames((await response.json()) as RadarFrame[]);
    } catch {
      // keep showing the last known frames; the next poll retries
    }
  };

  const stopPlaying = () => {
    playing = false;
    playButton.classList.remove("is-playing");
    playButton.setAttribute("aria-pressed", "false");
    clearInterval(playTimer);
  };

  const startPlaying = () => {
    if (frames.length < 2) return;
    playing = true;
    playButton.classList.add("is-playing");
    playButton.setAttribute("aria-pressed", "true");
    if (currentIndex >= frames.length - 1) currentIndex = 0;
    isLive = false;

    playTimer = setInterval(() => {
      currentIndex += 1;
      if (currentIndex >= frames.length - 1) {
        currentIndex = frames.length - 1;
        isLive = true;
        render();
        stopPlaying();
        return;
      }
      render();
    }, PLAY_INTERVAL_MS);
  };

  playButton.addEventListener("click", () => (playing ? stopPlaying() : startPlaying()));

  range.addEventListener("input", () => {
    stopPlaying();
    currentIndex = Number(range.value);
    isLive = currentIndex === frames.length - 1;
    render();
  });

  void fetchFrames();
  setInterval(() => void fetchFrames(), POLL_MS);

  return {
    reattach: () => {
      if (frames.length > 0) applySource();
    },
  };
}
