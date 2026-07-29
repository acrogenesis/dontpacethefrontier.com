const PAGE_SIZE = 40;
let offset = 0;
let total = 0;

const $ = (sel) => document.querySelector(sel);

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

function renderSignatory(s) {
  const li = document.createElement("li");
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

function renderComment(s) {
  const li = document.createElement("li");
  const quote = document.createElement("p");
  quote.className = "comment-body";
  appendText(quote, `“${s.comment || ""}”`);
  const name = document.createElement("p");
  name.className = "sig-name";
  name.style.marginTop = "0.65rem";
  appendText(name, s.name || "Signer");
  const meta = document.createElement("p");
  meta.className = "sig-meta";
  meta.appendChild(metaBits(s));
  li.appendChild(quote);
  li.appendChild(name);
  li.appendChild(meta);
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
  } else if (sign === "already") {
    banner.className = "narrow banner ok";
    banner.textContent = "This X account already signed. Thank you!";
  } else if (sign === "error") {
    banner.className = "narrow banner err";
    banner.textContent =
      params.get("message") || "Something went wrong. Please try again.";
  }
  history.replaceState({}, "", location.pathname + location.hash);
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
  if (reset) {
    offset = 0;
    $("#signatory-list").replaceChildren();
  }
  const res = await fetch(
    `/api/signatories?limit=${PAGE_SIZE}&offset=${offset}`,
  );
  const data = await res.json();
  total = data.total || 0;
  $("#total-count").textContent = total.toLocaleString();
  $("#hero-count").textContent = total.toLocaleString();

  const list = $("#signatory-list");
  for (const s of data.signatories || []) {
    list.appendChild(renderSignatory(s));
  }
  offset += (data.signatories || []).length;
  $("#load-more").hidden = offset >= total;
}

async function loadComments() {
  const res = await fetch("/api/comments?limit=40");
  const data = await res.json();
  const list = $("#comment-list");
  list.replaceChildren();
  const comments = data.comments || [];
  if (!comments.length) {
    $("#no-comments").hidden = false;
    return;
  }
  $("#no-comments").hidden = true;
  for (const s of comments) list.appendChild(renderComment(s));
}

async function checkAuthMode() {
  try {
    // Only available when X_DEV_MOCK=1
    const res = await fetch("/api/dev/status");
    if (!res.ok) return;
    const data = await res.json();
    if (data.mockAuth) $("#mock-note").hidden = false;
  } catch {
    /* ignore */
  }
}

$("#load-more")?.addEventListener("click", () => loadSignatories(false));

$("#sign-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = $("#form-status");
  const btn = $("#submit-btn");
  status.className = "form-status";
  status.textContent = "";
  btn.disabled = true;
  btn.textContent = "Redirecting to X…";

  const payload = {
    company: $("#company").value,
    title: $("#title").value,
    comment: $("#comment").value,
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
      status.textContent = data.error || "Could not start X sign-in.";
      btn.disabled = false;
      btn.replaceChildren();
      const logo = document.createElement("span");
      logo.className = "x-logo";
      logo.setAttribute("aria-hidden", "true");
      logo.textContent = "𝕏";
      btn.appendChild(logo);
      btn.appendChild(document.createTextNode(" Sign with X"));
      return;
    }
    location.href = data.redirectUrl;
  } catch {
    status.className = "form-status show err";
    status.textContent = "Network error. Try again.";
    btn.disabled = false;
    btn.replaceChildren();
    const logo = document.createElement("span");
    logo.className = "x-logo";
    logo.setAttribute("aria-hidden", "true");
    logo.textContent = "𝕏";
    btn.appendChild(logo);
    btn.appendChild(document.createTextNode(" Sign with X"));
  }
});

showBannerFromQuery();
Promise.all([
  loadStats(),
  loadSignatories(true),
  loadComments(),
  checkAuthMode(),
]).catch(console.error);
