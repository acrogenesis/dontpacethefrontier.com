/**
 * Apply theme before first paint (loaded synchronously in <head>).
 * Preference: localStorage "dptf-theme" = "system" | "light" | "dark"
 * Default: system
 */
(function () {
  var KEY = "dptf-theme";
  var pref = "system";
  try {
    pref = localStorage.getItem(KEY) || "system";
  } catch (e) {
    /* private mode */
  }
  if (pref !== "light" && pref !== "dark" && pref !== "system") pref = "system";

  var resolved =
    pref === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : pref;

  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePref = pref;

  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "light" ? "#f6f3ee" : "#0b0c10");
})();
