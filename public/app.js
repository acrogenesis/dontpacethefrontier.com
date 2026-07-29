// Load a large first page so small petitions show everyone at once.
// "Show more" only appears once total exceeds this (API max is 200).
const PAGE_SIZE = 50;
let offset = 0;
let total = 0;
let loadingMore = false;

const $ = (sel) => document.querySelector(sel);

function updateLoadMoreButton() {
  const btn = $("#load-more");
  if (!btn) return;
  const hasMore = offset < total;
  // Class-based visibility: .btn { display } overrides the UA [hidden] rule
  btn.hidden = !hasMore;
  btn.classList.toggle("is-shown", hasMore);
  btn.disabled = loadingMore || !hasMore;
  btn.setAttribute("aria-hidden", hasMore ? "false" : "true");
  btn.textContent = loadingMore
    ? "Loading…"
    : hasMore
      ? `Show more (${Math.min(PAGE_SIZE, total - offset)} remaining)`
      : "Show more";
}

function isSafeXHandle(h) {
  return typeof h === "string" && /^[A-Za-z0-9_]{1,15}$/.test(h);
}

function isSafeAvatarUrl(url) {
  if (typeof url !== "string" || !url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return (
      host === "pbs.twimg.com" ||
      host === "abs.twimg.com" ||
      host.endsWith(".twimg.com")
    );
  } catch {
    return false;
  }
}

function appendText(el, text) {
  el.appendChild(document.createTextNode(text == null ? "" : String(text)));
}

function metaBits(s) {
  const frag = document.createDocumentFragment();
  const parts = [];
  if (s.title) parts.push({ type: "text", value: s.title });
  if (s.company) parts.push({ type: "text", value: s.company });
  if (s.xHandle && isSafeXHandle(s.xHandle)) {
    parts.push({ type: "handle", value: s.xHandle });
  }
  parts.forEach((p, i) => {
    if (i > 0) appendText(frag, " · ");
    if (p.type === "handle") {
      const a = document.createElement("a");
      a.href = `https://x.com/${p.value}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      appendText(a, `@${p.value}`);
      frag.appendChild(a);
    } else {
      appendText(frag, p.value);
    }
  });
  if (!parts.length) appendText(frag, "Signer");
  return frag;
}

let listAnimSeq = 0;

function nextItemDelay() {
  // Stagger batches without unbounded delay growth
  const d = (listAnimSeq % 8) * 45;
  listAnimSeq += 1;
  return `${d}ms`;
}

function renderSignatory(s) {
  const li = document.createElement("li");
  li.style.setProperty("--item-delay", nextItemDelay());
  const row = document.createElement("div");
  row.className = "sig-row";

  if (s.avatarUrl && isSafeAvatarUrl(s.avatarUrl)) {
    const img = document.createElement("img");
    img.className = "avatar";
    img.src = s.avatarUrl;
    img.alt = "";
    img.width = 40;
    img.height = 40;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    row.appendChild(img);
  } else {
    const fallback = document.createElement("div");
    fallback.className = "avatar avatar-fallback";
    fallback.setAttribute("aria-hidden", "true");
    appendText(fallback, (s.name || "?")[0] || "?");
    row.appendChild(fallback);
  }

  const body = document.createElement("div");
  const name = document.createElement("p");
  name.className = "sig-name";
  appendText(name, s.name || "Signer");
  const meta = document.createElement("p");
  meta.className = "sig-meta";
  meta.appendChild(metaBits(s));
  body.appendChild(name);
  body.appendChild(meta);
  row.appendChild(body);
  li.appendChild(row);
  return li;
}

const COMMENT_CLAMP_CHARS = 320;

function renderComment(s) {
  const li = document.createElement("li");
  li.style.setProperty("--item-delay", nextItemDelay());

  const mark = document.createElement("div");
  mark.className = "comment-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "“";
  li.appendChild(mark);

  const text = (s.comment || "").trim();
  const quote = document.createElement("p");
  quote.className = "comment-body";
  appendText(quote, text);
  li.appendChild(quote);

  if (text.length > COMMENT_CLAMP_CHARS) {
    quote.classList.add("is-clamped");
    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "comment-expand";
    expand.textContent = "Show more";
    expand.addEventListener("click", () => {
      const open = quote.classList.toggle("is-clamped");
      // toggle returns new state: true if class present (clamped)
      expand.textContent = open ? "Show more" : "Show less";
    });
    li.appendChild(expand);
  }

  const footer = document.createElement("div");
  footer.className = "comment-footer";

  if (s.avatarUrl && isSafeAvatarUrl(s.avatarUrl)) {
    const img = document.createElement("img");
    img.className = "avatar";
    img.src = s.avatarUrl;
    img.alt = "";
    img.width = 40;
    img.height = 40;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    footer.appendChild(img);
  } else {
    const fallback = document.createElement("div");
    fallback.className = "avatar avatar-fallback";
    fallback.setAttribute("aria-hidden", "true");
    appendText(fallback, (s.name || "?")[0] || "?");
    footer.appendChild(fallback);
  }

  const who = document.createElement("div");
  const name = document.createElement("p");
  name.className = "sig-name";
  appendText(name, s.name || "Signer");
  const meta = document.createElement("p");
  meta.className = "sig-meta";
  meta.appendChild(metaBits(s));
  who.appendChild(name);
  who.appendChild(meta);
  footer.appendChild(who);
  li.appendChild(footer);
  return li;
}

function showBannerFromQuery() {
  const params = new URLSearchParams(location.search);
  const sign = params.get("sign");
  if (!sign) return;
  const banner = $("#banner");
  banner.hidden = false;
  if (sign === "ok") {
    banner.className = "narrow banner ok";
    banner.textContent =
      "You're on the list. Thanks for signing with X!";
  } else if (sign === "updated") {
    banner.className = "narrow banner ok";
    banner.textContent = "Your signature was updated. Thanks!";
  } else if (sign === "already") {
    banner.className = "narrow banner ok";
    banner.textContent =
      "This X account already signed. Use “Update my signature” to change title or comment (company refreshes from your X affiliation).";
  } else if (sign === "error") {
    banner.className = "narrow banner err";
    banner.textContent =
      params.get("message") || "Something went wrong. Please try again.";
  }
  history.replaceState({}, "", location.pathname + location.hash);
}

function setXButtonLabel(btn, label) {
  btn.replaceChildren();
  const logo = document.createElement("span");
  logo.className = "x-logo";
  logo.setAttribute("aria-hidden", "true");
  logo.textContent = "𝕏";
  btn.appendChild(logo);
  btn.appendChild(document.createTextNode(` ${label}`));
}

async function startOAuth(intent) {
  const status = $("#form-status");
  const submitBtn = $("#submit-btn");
  const editBtn = $("#edit-btn");
  const active =
    intent === "edit" ? editBtn : submitBtn;
  const idleLabel = intent === "edit" ? "Update my signature" : "Sign with X";

  status.className = "form-status";
  status.textContent = "";
  submitBtn.disabled = true;
  if (editBtn) editBtn.disabled = true;
  if (active) active.textContent = "Redirecting to X…";

  const payload = {
    title: $("#title").value,
    comment: $("#comment").value,
    intent: intent === "edit" ? "edit" : "sign",
  };

  try {
    const res = await fetch("/api/auth/x/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.redirectUrl) {
      status.className = "form-status show err";
      status.textContent =
        data.error ||
        (intent === "edit"
          ? "Could not start update."
          : "Could not start X sign-in.");
      submitBtn.disabled = false;
      if (editBtn) editBtn.disabled = false;
      setXButtonLabel(submitBtn, "Sign with X");
      if (editBtn) setXButtonLabel(editBtn, "Update my signature");
      return;
    }
    location.href = data.redirectUrl;
  } catch {
    status.className = "form-status show err";
    status.textContent = "Network error. Try again.";
    submitBtn.disabled = false;
    if (editBtn) editBtn.disabled = false;
    setXButtonLabel(submitBtn, "Sign with X");
    if (editBtn) setXButtonLabel(editBtn, "Update my signature");
  }
}

async function loadStats() {
  const res = await fetch("/api/stats");
  const data = await res.json();
  total = data.total || 0;
  $("#hero-count").textContent = total.toLocaleString();
  $("#total-count").textContent = total.toLocaleString();

  const chips = $("#company-summary");
  chips.replaceChildren();
  for (const row of (data.byCompany || []).slice(0, 12)) {
    const el = document.createElement("span");
    el.className = "chip";
    appendText(el, `${row.company} `);
    const strong = document.createElement("strong");
    appendText(strong, String(row.count));
    el.appendChild(strong);
    chips.appendChild(el);
  }
}

async function loadSignatories(reset = false) {
  if (loadingMore) return;
  if (!reset && offset >= total && total > 0) {
    updateLoadMoreButton();
    return;
  }

  loadingMore = true;
  updateLoadMoreButton();

  const list = $("#signatory-list");
  const prevCount = list ? list.children.length : 0;

  try {
    if (reset) {
      offset = 0;
      listAnimSeq = 0;
      list?.replaceChildren();
    }

    const res = await fetch(
      `/api/signatories?limit=${PAGE_SIZE}&offset=${offset}`,
    );
    if (!res.ok) throw new Error("Failed to load signatories");
    const data = await res.json();
    total = Number(data.total) || 0;
    const totalEl = $("#total-count");
    const heroEl = $("#hero-count");
    if (totalEl) totalEl.textContent = total.toLocaleString();
    if (heroEl) heroEl.textContent = total.toLocaleString();

    const batch = Array.isArray(data.signatories) ? data.signatories : [];
    for (const s of batch) {
      list?.appendChild(renderSignatory(s));
    }
    offset += batch.length;

    // If the API returned nothing new, treat the list as complete
    if (!reset && batch.length === 0) {
      offset = Math.max(offset, total);
    }

    // Scroll newly appended items into view when loading more
    if (!reset && batch.length && list) {
      const scroll = document.querySelector("#signatories .rail-scroll");
      const firstNew = list.children[prevCount];
      if (firstNew && typeof firstNew.scrollIntoView === "function") {
        firstNew.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else if (scroll) {
        scroll.scrollTo({ top: scroll.scrollHeight, behavior: "smooth" });
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    loadingMore = false;
    updateLoadMoreButton();
  }
}

async function loadComments() {
  const res = await fetch("/api/comments?limit=40");
  const data = await res.json();
  const list = $("#comment-list");
  list?.replaceChildren();
  listAnimSeq = 0;
  const comments = data.comments || [];
  const empty = $("#no-comments");
  if (!comments.length) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  for (const s of comments) list?.appendChild(renderComment(s));
}

async function checkAuthMode() {
  try {
    // Only available when X_DEV_MOCK=1 (404 in production is expected)
    const res = await fetch("/api/dev/status");
    if (!res.ok) return;
    const data = await res.json();
    if (data.mockAuth) {
      const note = $("#mock-note");
      if (note) note.hidden = false;
    }
  } catch {
    /* ignore */
  }
}

$("#load-more")?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (loadingMore) return;
  loadSignatories(false);
});

$("#sign-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  startOAuth("sign");
});

$("#edit-btn")?.addEventListener("click", () => {
  startOAuth("edit");
});

showBannerFromQuery();
Promise.all([
  loadStats(),
  loadSignatories(true),
  loadComments(),
  checkAuthMode(),
]).catch(console.error);
