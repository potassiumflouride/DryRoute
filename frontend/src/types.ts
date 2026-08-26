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
}

export interface Route {
  legs: RouteLeg[];
  distanceMeters: number;
  durationSeconds: number;
}

export interface RainZone {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, never>;
    geometry: { type: "Polygon"; coordinates: number[][][] };
  }>;
}
