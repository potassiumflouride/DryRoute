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
  coverage: number;
}
