export type TravelMode = "foot" | "bicycle" | "motorcycle";

export interface GeocodeResult {
  name: string;
  address: string;
  lat: number;
  lon: number;
}
