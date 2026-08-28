const FEEDBACK_FORM_FALLBACK_URL = "https://forms.gle/placeholder";

export function initSettingsTray(): void {
  const toggleButton = document.querySelector<HTMLButtonElement>(".settings-toggle-btn");
  const tray = document.querySelector<HTMLDivElement>(".settings-tray");
  const backdrop = document.querySelector<HTMLDivElement>(".settings-tray__backdrop");
  const closeButton = document.querySelector<HTMLButtonElement>(".settings-tray__close-btn");
  const feedbackLink = document.querySelector<HTMLAnchorElement>(".settings-tray__feedback-link");
  if (!toggleButton || !tray || !backdrop || !closeButton) return;

  if (feedbackLink) {
    feedbackLink.href = import.meta.env.VITE_FEEDBACK_FORM_URL || FEEDBACK_FORM_FALLBACK_URL;
  }

  let lastFocused: HTMLElement | null = null;

  const open = () => {
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    tray.classList.add("is-open");
    tray.setAttribute("aria-hidden", "false");
    toggleButton.setAttribute("aria-expanded", "true");
    closeButton.focus();
  };

  const close = () => {
    tray.classList.remove("is-open");
    tray.setAttribute("aria-hidden", "true");
    toggleButton.setAttribute("aria-expanded", "false");
    lastFocused?.focus();
  };

  toggleButton.addEventListener("click", () => {
    if (tray.classList.contains("is-open")) {
      close();
    } else {
      open();
    }
  });

  backdrop.addEventListener("click", close);
  closeButton.addEventListener("click", close);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && tray.classList.contains("is-open")) {
      close();
    }
  });
}
