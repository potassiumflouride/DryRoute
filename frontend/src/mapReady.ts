const RETRY_MS = 100;
const MAX_ATTEMPTS = 50;

// addSource/addLayer require the style to be mutable, which isn't guaranteed
// right after map construction or a theme-toggle setStyle() call - both
// map.isStyleLoaded() and the "styledata" event are unreliable signals for
// this (isStyleLoaded() can report false indefinitely after setStyle(), and
// "styledata" may not fire again once loading has settled), so this retries
// the mutation itself on a short interval until it stops throwing.
export function addToMapWhenReady(addNow: () => void, attempt = 0): void {
  try {
    addNow();
  } catch {
    if (attempt >= MAX_ATTEMPTS) return;
    setTimeout(() => addToMapWhenReady(addNow, attempt + 1), RETRY_MS);
  }
}
