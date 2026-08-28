import { trackEvent } from "./analytics";

const STORAGE_KEY = "dryroute-onboarding-seen";

export interface OnboardingController {
  open(trigger?: "first_visit" | "replay"): void;
}

export function initOnboarding(): OnboardingController {
  const overlay = document.querySelector<HTMLDivElement>(".onboarding-overlay");
  const backdrop = document.querySelector<HTMLDivElement>(".onboarding-overlay__backdrop");
  const track = document.querySelector<HTMLDivElement>(".onboarding-track");
  const slides = Array.from(document.querySelectorAll<HTMLDivElement>(".onboarding-slide"));
  const dots = Array.from(document.querySelectorAll<HTMLButtonElement>(".onboarding-dot"));
  const backButton = document.querySelector<HTMLButtonElement>(".onboarding-back-btn");
  const nextButton = document.querySelector<HTMLButtonElement>(".onboarding-next-btn");
  const nextLabel = document.querySelector<HTMLSpanElement>(".onboarding-next-btn__label");
  const skipButton = document.querySelector<HTMLButtonElement>(".onboarding-skip-btn");

  if (!overlay || !backdrop || !track || !nextButton || !nextLabel || !skipButton || !backButton) {
    return { open: () => {} };
  }
  if (slides.length === 0 || dots.length !== slides.length) {
    return { open: () => {} };
  }

  const total = slides.length;
  let index = 0;
  let lastFocused: HTMLElement | null = null;

  const render = () => {
    track.style.transform = `translateX(-${(index * 100) / total}%)`;
    dots.forEach((dot, i) => {
      dot.classList.toggle("is-active", i === index);
      dot.setAttribute("aria-current", i === index ? "true" : "false");
    });
    const isLast = index === total - 1;
    const isFirst = index === 0;
    nextLabel.textContent = isLast ? "Get started" : "Next";
    skipButton.hidden = isLast;
    backButton.classList.toggle("is-hidden", isFirst);
    if (overlay.classList.contains("is-open")) {
      trackEvent("onboarding_step_view", { step_index: index + 1 });
    }
  };

  const goTo = (next: number) => {
    index = Math.max(0, Math.min(total - 1, next));
    render();
  };

  const markSeen = () => {
    localStorage.setItem(STORAGE_KEY, "true");
  };

  const open = (trigger: "first_visit" | "replay" = "first_visit") => {
    index = 0;
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    trackEvent("onboarding_start", { trigger });
    render();
  };

  const close = () => {
    markSeen();
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    lastFocused?.focus();
  };

  nextButton.addEventListener("click", () => {
    if (index === total - 1) {
      trackEvent("onboarding_complete");
      close();
      return;
    }
    trackEvent("onboarding_next", { step_index: index + 1 });
    goTo(index + 1);
  });

  backButton.addEventListener("click", () => {
    trackEvent("onboarding_back", { step_index: index + 1 });
    goTo(index - 1);
  });
  skipButton.addEventListener("click", () => {
    trackEvent("onboarding_skip", { step_index: index + 1 });
    close();
  });

  dots.forEach((dot, i) => {
    dot.addEventListener("click", () => {
      trackEvent("onboarding_dot_nav", { from_step: index + 1, to_step: i + 1 });
      goTo(i);
    });
  });

  backdrop.addEventListener("click", close);

  document.addEventListener("keydown", (event) => {
    if (!overlay.classList.contains("is-open")) return;
    if (event.key === "Escape") close();
    if (event.key === "ArrowRight") goTo(index + 1);
    if (event.key === "ArrowLeft") goTo(index - 1);
  });

  let startX: number | null = null;
  overlay.addEventListener("pointerdown", (event) => {
    startX = event.clientX;
  });
  overlay.addEventListener("pointerup", (event) => {
    if (startX === null) return;
    const dx = event.clientX - startX;
    if (Math.abs(dx) > 40) {
      const direction = dx < 0 ? "left" : "right";
      trackEvent("onboarding_swipe", { direction, step_index: index + 1 });
      goTo(dx < 0 ? index + 1 : index - 1);
    }
    startX = null;
  });

  render();
  if (!localStorage.getItem(STORAGE_KEY)) {
    open();
  }

  return { open };
}
