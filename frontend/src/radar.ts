import maplibregl from "maplibre-gl";
import type { RadarFrame } from "./types";
import { addToMapWhenReady } from "./mapReady";
import { trackEvent } from "./analytics";

const RADAR_BUCKET_URL = "https://dryroute-rain-radar.s3.ap-southeast-1.amazonaws.com";
const RADAR_RANGE = "240km";
const INTERVAL_MINUTES = 5; // NEA's actual frame cadence - must match the ingest Lambda's key format, not the poll rate
const POLL_INTERVAL_MINUTES = 2; // how often we re-check for a newly published frame
const TRIGGER_DELAY_SECONDS = 15;
const FRAME_COUNT = 12; // 1-hour scrubber window at 5-minute intervals
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000; // spaced retries for a frame the ingest Lambda hasn't uploaded yet
const PLAY_INTERVAL_MS = 1200;
const SOURCE_ID = "radar";
const LAYER_ID = "radar-layer";
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface RadarController {
  reattach: () => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Singapore has no DST, so shifting by a fixed +8h offset and reading UTC
// getters gives us SGT wall-clock fields without depending on the browser's locale.
function floorToIntervalUtc(date: Date): Date {
  const sgt = new Date(date.getTime() + SGT_OFFSET_MS);
  const flooredMinute = sgt.getUTCMinutes() - (sgt.getUTCMinutes() % INTERVAL_MINUTES);
  sgt.setUTCMinutes(flooredMinute, 0, 0);
  return new Date(sgt.getTime() - SGT_OFFSET_MS);
}

function formatFrameKeys(timestampUtc: Date): { img: string; json: string } {
  const sgt = new Date(timestampUtc.getTime() + SGT_OFFSET_MS);
  const datePrefix = sgt.toISOString().slice(0, 10);
  const stem = `radar_${RADAR_RANGE}_${datePrefix}T${String(sgt.getUTCHours()).padStart(2, "0")}-${String(
    sgt.getUTCMinutes(),
  ).padStart(2, "0")}-${String(sgt.getUTCSeconds()).padStart(2, "0")}`;
  return {
    img: `${RADAR_BUCKET_URL}/${datePrefix}/img/${stem}.png`,
    json: `${RADAR_BUCKET_URL}/${datePrefix}/json/${stem}.json`,
  };
}

interface NeaBoundaryBox {
  upperLeft: { longitude: number; latitude: number };
  lowerRight: { longitude: number; latitude: number };
}

async function fetchFrameOnce(targetUtc: Date): Promise<RadarFrame | null> {
  try {
    const response = await fetch(formatFrameKeys(targetUtc).json);
    if (!response.ok) return null;
    const payload = (await response.json()) as { data: { boundaryBox: NeaBoundaryBox } };
    return { timestamp: targetUtc.toISOString(), boundaryBox: payload.data.boundaryBox };
  } catch {
    return null;
  }
}

async function fetchFrame(targetUtc: Date): Promise<RadarFrame | null> {
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    const frame = await fetchFrameOnce(targetUtc);
    if (frame) return frame;
    if (attempt < RETRY_ATTEMPTS - 1) await sleep(RETRY_DELAY_MS);
  }
  return null;
}

function msUntilNextTrigger(now: Date): number {
  const next = new Date(now);
  next.setSeconds(TRIGGER_DELAY_SECONDS, 0);
  const flooredMinute = Math.floor(next.getMinutes() / POLL_INTERVAL_MINUTES) * POLL_INTERVAL_MINUTES;
  next.setMinutes(flooredMinute);
  if (next.getTime() <= now.getTime()) next.setMinutes(next.getMinutes() + POLL_INTERVAL_MINUTES);
  return next.getTime() - now.getTime();
}

export function initRadar(map: maplibregl.Map): RadarController {
  const root = document.querySelector<HTMLDivElement>(".radar-player");
  const playButton = document.querySelector<HTMLButtonElement>(".radar-scrubber__play");
  const playhead = document.querySelector<HTMLDivElement>(".radar-scrubber__playhead");
  const range = document.querySelector<HTMLInputElement>(".radar-scrubber__range");
  const badge = document.querySelector<HTMLSpanElement>(".radar-scrubber__badge");
  const badgeLabel = document.querySelector<HTMLSpanElement>(".radar-scrubber__badge-label");
  const timeLabel = document.querySelector<HTMLSpanElement>(".radar-scrubber__time");
  const offsetLabel = document.querySelector<HTMLSpanElement>(".radar-scrubber__offset");
  const statusText = document.querySelector<HTMLParagraphElement>(".radar-player__status");

  const noop: RadarController = { reattach: () => {} };
  if (!root || !playButton || !playhead || !range || !badge || !badgeLabel || !timeLabel || !offsetLabel || !statusText) {
    return noop;
  }

  let frames: RadarFrame[] = [];
  let currentIndex = 0;
  let isLive = true;
  let playing = false;
  let playTimer: ReturnType<typeof setInterval> | undefined;

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false });

  const sourceUrl = (frame: RadarFrame) => formatFrameKeys(new Date(frame.timestamp)).img;

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

  const setFrames = (nextFrames: RadarFrame[]) => {
    if (nextFrames.length === 0) return;

    const previousTimestamp = frames[currentIndex]?.timestamp;
    frames = nextFrames;
    range.min = "0";

    if (isLive) {
      currentIndex = frames.length - 1;
    } else {
      const stillPresentIndex = frames.findIndex((f) => f.timestamp === previousTimestamp);
      currentIndex = stillPresentIndex >= 0 ? stillPresentIndex : frames.length - 1;
    }
    render();
  };

  const backfill = async () => {
    const floor = floorToIntervalUtc(new Date());
    const targets = Array.from(
      { length: FRAME_COUNT },
      (_, i) => new Date(floor.getTime() - (FRAME_COUNT - 1 - i) * INTERVAL_MINUTES * 60000),
    );
    const fetched = await Promise.all(targets.map((target) => fetchFrameOnce(target)));
    const valid = fetched.filter((frame): frame is RadarFrame => frame !== null);
    if (valid.length === 0) {
      statusText.textContent = "Radar data temporarily unavailable.";
      statusText.hidden = false;
      return;
    }
    statusText.hidden = true;
    setFrames(valid);
  };

  const pollLatest = async () => {
    const target = floorToIntervalUtc(new Date());
    const frame = await fetchFrame(target);
    if (frame) {
      statusText.hidden = true;
      const withoutDuplicate = frames.filter((f) => f.timestamp !== frame.timestamp);
      setFrames([...withoutDuplicate, frame].slice(-FRAME_COUNT));
    }
  };

  const scheduleNextPoll = () => {
    setTimeout(() => {
      void pollLatest().finally(scheduleNextPoll);
    }, msUntilNextTrigger(new Date()));
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
    if (isLive) trackEvent("radar_mode_change", { mode: "replay" });
    isLive = false;

    playTimer = setInterval(() => {
      currentIndex += 1;
      if (currentIndex >= frames.length - 1) {
        currentIndex = frames.length - 1;
        isLive = true;
        trackEvent("radar_mode_change", { mode: "live" });
        render();
        stopPlaying();
        return;
      }
      render();
    }, PLAY_INTERVAL_MS);
  };

  playButton.addEventListener("click", () => {
    if (playing) {
      stopPlaying();
      trackEvent("radar_pause");
    } else {
      startPlaying();
      trackEvent("radar_play");
    }
  });

  range.addEventListener("input", () => {
    stopPlaying();
    currentIndex = Number(range.value);
    const nextIsLive = currentIndex === frames.length - 1;
    if (nextIsLive !== isLive) {
      trackEvent("radar_mode_change", { mode: nextIsLive ? "live" : "replay" });
    }
    isLive = nextIsLive;
    render();
  });

  range.addEventListener("change", () => {
    const seekPositionPct =
      frames.length > 1 ? Math.round((currentIndex / (frames.length - 1)) * 10) * 10 : 100;
    trackEvent("radar_scrub", { seek_position_pct: seekPositionPct });
  });

  void backfill();
  scheduleNextPoll();

  return {
    reattach: () => {
      if (frames.length > 0) applySource();
    },
  };
}
