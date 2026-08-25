export type GeolocationFailureReason = "denied" | "unavailable" | "timeout" | "unsupported";

export interface GeoPoint {
  lat: number;
  lon: number;
}

function mapError(error: GeolocationPositionError): GeolocationFailureReason {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "denied";
    case error.TIMEOUT:
      return "timeout";
    default:
      return "unavailable";
  }
}

export function getCurrentLocation(timeoutMs = 8000): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject("unsupported" satisfies GeolocationFailureReason);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      (error) => reject(mapError(error)),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
