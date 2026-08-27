const COLLAPSED_REM = 5.5;
const EXPANDED_VH_FRACTION = 0.375;
const TAP_THRESHOLD_PX = 6;

export interface SheetDragController {
  expand: () => void;
}

export function initSheetDrag(sheet: HTMLElement, handle: HTMLElement): SheetDragController {
  let dragging = false;
  let expanded = true;
  let startY = 0;
  let startHeight = 0;
  let maxMoved = 0;

  const rootFontSize = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const collapsedPx = () => COLLAPSED_REM * rootFontSize();
  const expandedPx = () => window.innerHeight * EXPANDED_VH_FRACTION;
  const currentHeightPx = () => sheet.getBoundingClientRect().height;

  const setExpanded = (next: boolean) => {
    expanded = next;
    sheet.classList.remove("is-dragging");
    if (expanded) {
      sheet.style.removeProperty("--sheet-height");
    } else {
      sheet.style.setProperty("--sheet-height", `calc(env(safe-area-inset-bottom, 0px) + ${COLLAPSED_REM}rem)`);
    }
    handle.setAttribute("aria-expanded", String(expanded));
  };

  const endDrag = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture(event.pointerId);

    if (maxMoved < TAP_THRESHOLD_PX) {
      setExpanded(!expanded);
      return;
    }

    const midpoint = (collapsedPx() + expandedPx()) / 2;
    setExpanded(currentHeightPx() >= midpoint);
  };

  handle.addEventListener("pointerdown", (event) => {
    dragging = true;
    maxMoved = 0;
    startY = event.clientY;
    startHeight = currentHeightPx();
    sheet.classList.add("is-dragging");
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const delta = startY - event.clientY;
    maxMoved = Math.max(maxMoved, Math.abs(delta));
    const next = Math.min(expandedPx(), Math.max(collapsedPx(), startHeight + delta));
    sheet.style.setProperty("--sheet-height", `${next}px`);
  });

  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);

  handle.setAttribute("role", "button");
  handle.setAttribute("tabindex", "0");
  handle.setAttribute("aria-label", "Resize search panel");
  handle.setAttribute("aria-expanded", "true");
  handle.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setExpanded(!expanded);
  });

  return {
    expand: () => setExpanded(true),
  };
}
