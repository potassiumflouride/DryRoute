type AnalyticsEventParams = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let initialized = false;

export function initAnalytics(): void {
  const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;
  if (!measurementId || initialized) return;
  initialized = true;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer.push(args);
  };
  window.gtag("js", new Date());
  window.gtag("config", measurementId, { anonymize_ip: true });
}

export function trackEvent(name: string, params?: AnalyticsEventParams): void {
  if (typeof window.gtag !== "function") return;
  window.gtag("event", name, params);
}
