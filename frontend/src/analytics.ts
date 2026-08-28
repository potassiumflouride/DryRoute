type AnalyticsEventParams = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackEvent(name: string, params?: AnalyticsEventParams): void {
  if (typeof window.gtag !== "function") return;
  window.gtag("event", name, params);
}
