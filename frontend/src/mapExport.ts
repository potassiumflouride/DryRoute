import * as turf from "@turf/turf";
import type { Route } from "./types";

interface LngLat {
  lat: number;
  lon: number;
}

const format = (point: LngLat) => `${point.lat},${point.lon}`;

/**
 * Builds an ordered list of up to `maxPoints` points describing `route`, always
 * including every anchor (origin, user waypoints, destination) exactly. Remaining
 * slots are filled by sampling each leg's own geometry, proportional to leg length,
 * so the route's shape - including any rain detour - survives the export.
 */
export function buildExportPoints(route: Route, anchors: LngLat[], maxPoints = 10): LngLat[] {
  if (anchors.length >= maxPoints) return anchors;

  const budget = maxPoints - anchors.length;
  const legLengthsKm = route.legs.map((leg) =>
    turf.length({ type: "Feature", properties: {}, geometry: leg.geometry }, { units: "kilometers" }),
  );
  const totalKm = legLengthsKm.reduce((sum, km) => sum + km, 0);

  const rawShares = totalKm > 0 ? legLengthsKm.map((km) => (budget * km) / totalKm) : legLengthsKm.map(() => 0);
  const allocations = rawShares.map(Math.floor);
  let allocated = allocations.reduce((sum, n) => sum + n, 0);
  const remainders = rawShares
    .map((share, i) => ({ i, remainder: share - Math.floor(share) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const { i } of remainders) {
    if (allocated >= budget) break;
    allocations[i] = (allocations[i] ?? 0) + 1;
    allocated += 1;
  }

  const points: LngLat[] = [anchors[0]!];
  route.legs.forEach((leg, i) => {
    const k = allocations[i] ?? 0;
    if (k > 0) {
      const legFeature = { type: "Feature" as const, properties: {}, geometry: leg.geometry };
      const legLengthKm = legLengthsKm[i] ?? 0;
      for (let j = 1; j <= k; j++) {
        const along = turf.along(legFeature, (legLengthKm * j) / (k + 1), { units: "kilometers" });
        const [lon, lat] = along.geometry.coordinates as [number, number];
        points.push({ lat, lon });
      }
    }
    points.push(anchors[i + 1]!);
  });

  return points;
}

export function buildGoogleMapsUrl(points: LngLat[]): string {
  const origin = points[0]!;
  const destination = points[points.length - 1]!;
  const waypoints = points.slice(1, -1);

  const params = new URLSearchParams({
    api: "1",
    origin: format(origin),
    destination: format(destination),
  });
  if (waypoints.length > 0) params.set("waypoints", waypoints.map(format).join("|"));

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function buildAppleMapsUrl(points: LngLat[]): string {
  const origin = points[0]!;
  const stops = points.slice(1);

  const params = new URLSearchParams({ saddr: format(origin) });
  params.set("daddr", stops.map(format).join("+to:"));

  return `https://maps.apple.com/?${params.toString()}`;
}
