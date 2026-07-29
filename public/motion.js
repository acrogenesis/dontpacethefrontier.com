/**
 * Scroll reveals + count pop. Safe no-op when reduced motion is preferred.
 */
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function revealAll() {
    document
      .querySelectorAll(".reveal, .reveal-scale, .rail-panel")
      .forEach((el) => el.classList.add("is-in"));
  }

  if (reduce) {
    revealAll();
    return;
  }

  document.documentElement.classList.add("motion-on");

  const io =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              entry.target.classList.add("is-in");
              io.unobserve(entry.target);
            }
          },
          { root: null, rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
        )
      : null;

  function observeReveals(root = document) {
    root.querySelectorAll(".reveal, .reveal-scale, .rail-panel").forEach((el, i) => {
      if (el.classList.contains("is-in")) return;
      if (!el.style.getPropertyValue("--reveal-delay")) {
        // light stagger for siblings in the same section
        const siblings = el.parentElement
          ? [...el.parentElement.children].filter((c) =>
              c.classList?.contains("reveal") ||
              c.classList?.contains("reveal-scale"),
            )
          : [];
        const idx = siblings.indexOf(el);
        if (idx > 0) {
          el.style.setProperty("--reveal-delay", `${Math.min(idx * 70, 280)}ms`);
        }
      }
      if (io) io.observe(el);
      else el.classList.add("is-in");
    });
  }

  // Expose for app.js to re-run if needed
  window.__dptfObserveReveals = observeReveals;

  /** Pop count elements when their text changes */
  function watchCount(el) {
    if (!el) return;
    let last = el.textContent;
    const mo = new MutationObserver(() => {
      const next = el.textContent;
      if (next === last) return;
      last = next;
      el.classList.remove("is-pop");
      // reflow so animation can restart
      void el.offsetWidth;
      el.classList.add("is-pop");
    });
    mo.observe(el, { characterData: true, childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      observeReveals();
      watchCount(document.getElementById("hero-count"));
      watchCount(document.getElementById("total-count"));
    });
  } else {
    observeReveals();
    watchCount(document.getElementById("hero-count"));
    watchCount(document.getElementById("total-count"));
  }
})();
