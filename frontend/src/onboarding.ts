const STORAGE_KEY = "dryroute-onboarding-seen";

export interface OnboardingController {
  open(): void;
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
  };

  const goTo = (next: number) => {
    index = Math.max(0, Math.min(total - 1, next));
    render();
  };

  const markSeen = () => {
    localStorage.setItem(STORAGE_KEY, "true");
  };

  const open = () => {
    index = 0;
    render();
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
  };

  const close = () => {
    markSeen();
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    lastFocused?.focus();
  };

  nextButton.addEventListener("click", () => {
    if (index === total - 1) {
      close();
      return;
    }
    goTo(index + 1);
  });

  backButton.addEventListener("click", () => goTo(index - 1));
  skipButton.addEventListener("click", close);

  dots.forEach((dot, i) => {
    dot.addEventListener("click", () => goTo(i));
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
