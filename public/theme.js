/**
 * Theme toggle UI: cycles system → light → dark → system
 */
const KEY = "dptf-theme";
const ORDER = ["system", "light", "dark"];

function getPref() {
  try {
    const p = localStorage.getItem(KEY) || "system";
    return ORDER.includes(p) ? p : "system";
  } catch {
    return "system";
  }
}

function resolve(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function apply(pref) {
  const resolved = resolve(pref);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePref = pref;
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* ignore */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved === "light" ? "#f6f3ee" : "#0b0c10");
  }
  syncButton(pref, resolved);
}

function labelFor(pref) {
  if (pref === "system") return "System";
  if (pref === "light") return "Light";
  return "Dark";
}

function iconFor(pref, resolved) {
  if (pref === "system") return "◐";
  if (resolved === "light") return "☀";
  return "☾";
}

function syncButton(pref, resolved) {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const icon = btn.querySelector(".theme-icon");
  const label = btn.querySelector(".theme-label");
  const r = resolved || resolve(pref);
  if (icon) icon.textContent = iconFor(pref, r);
  if (label) label.textContent = labelFor(pref);
  btn.setAttribute(
    "aria-label",
    `Color theme: ${labelFor(pref)}. Click to change.`,
  );
  btn.title = `Theme: ${labelFor(pref)} (click to cycle)`;
}

function cycle() {
  const pref = getPref();
  const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
  apply(next);
}

function initThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  syncButton(getPref());
  btn.addEventListener("click", cycle);

  // Follow OS changes while preference is "system"
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (getPref() === "system") apply("system");
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch {
    /* ignore */
  }
}

initThemeToggle();
