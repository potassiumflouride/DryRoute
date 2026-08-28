import { trackEvent } from "./analytics";

const FEEDBACK_FORM_FALLBACK_URL = "https://forms.gle/placeholder";

export function initSettingsTray(): void {
  const toggleButton = document.querySelector<HTMLButtonElement>(".settings-toggle-btn");
  const tray = document.querySelector<HTMLDivElement>(".settings-tray");
  const backdrop = document.querySelector<HTMLDivElement>(".settings-tray__backdrop");
  const closeButton = document.querySelector<HTMLButtonElement>(".settings-tray__close-btn");
  const emailLink = document.querySelector<HTMLAnchorElement>(".settings-tray__email-link");
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
    trackEvent("settings_open");
  };

  const close = (method: "button" | "backdrop" | "escape") => {
    tray.classList.remove("is-open");
    tray.setAttribute("aria-hidden", "true");
    toggleButton.setAttribute("aria-expanded", "false");
    lastFocused?.focus();
    trackEvent("settings_close", { close_method: method });
  };

  toggleButton.addEventListener("click", () => {
    if (tray.classList.contains("is-open")) {
      close("button");
    } else {
      open();
    }
  });

  backdrop.addEventListener("click", () => close("backdrop"));
  closeButton.addEventListener("click", () => close("button"));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && tray.classList.contains("is-open")) {
      close("escape");
    }
  });

  emailLink?.addEventListener("click", () => trackEvent("feedback_email_click"));
  feedbackLink?.addEventListener("click", () =>
    trackEvent("feedback_form_click", { destination_url: feedbackLink.href }),
  );
}
