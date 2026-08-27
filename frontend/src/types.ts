export type TravelMode = "foot" | "bicycle" | "motorcycle";

export interface GeocodeResult {
  name: string;
  address: string;
  lat: number;
  lon: number;
}

export interface RadarFrame {
  timestamp: string;
  boundaryBox: {
    upperLeft: { longitude: number; latitude: number };
    lowerRight: { longitude: number; latitude: number };
  };
}

export interface RouteLeg {
  geometry: { type: "LineString"; coordinates: [number, number][] };
  distanceMeters: number;
  durationSeconds: number;
  rainSegments?: { type: "LineString"; coordinates: [number, number][] }[];
}

export interface Route {
  legs: RouteLeg[];
  distanceMeters: number;
  durationSeconds: number;
}
