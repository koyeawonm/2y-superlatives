// =============================================================================
// admin.js — Admin dashboard logic
// =============================================================================
// Set APPS_SCRIPT_URL to your deployed Apps Script web app URL.
// This must match the value in app.js.
// =============================================================================

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzjNKZozzfSg012TZDjJKggxgRl6JOSjROYtQXQI41IGYzBklNIzHXTzGhPWnZ_7qsFRQ/exec";

// Superlative ID → object lookup (built from superlatives.js).
const SUP_MAP = {};
SUPERLATIVES.forEach(s => { SUP_MAP[s.id] = s; });

// ── Auth ───────────────────────────────────────────────────────────────────────

let _adminPassword = null;

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("password-form");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const pw = document.getElementById("password-input").value.trim();
    if (!pw) return;

    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Checking…";

    // Validate password via a real API call.
    try {
      const res = await apiFetch({ action: "admin_stats", password: pw });
      if (!res.ok) {
        document.getElementById("pw-error").textContent = res.error || "Incorrect password.";
        document.getElementById("pw-error").style.display = "block";
        btn.disabled = false;
        btn.textContent = "Enter";
        return;
      }

      _adminPassword = pw;
      document.getElementById("login-view").style.display = "none";
      document.getElementById("dashboard-view").style.display = "block";
      renderSummary(res);
      renderCategories(res.categories);
    } catch (err) {
      document.getElementById("pw-error").textContent = "Connection error. Try again.";
      document.getElementById("pw-error").style.display = "block";
      btn.disabled = false;
      btn.textContent = "Enter";
    }
  });

  const refreshBtn = document.getElementById("refresh-btn");
  if (refreshBtn) refreshBtn.addEventListener("click", loadDashboard);

  const exportBtn = document.getElementById("export-btn");
  if (exportBtn) exportBtn.addEventListener("click", exportCSV);
});

// ── Dashboard loading ─────────────────────────────────────────────────────────

async function loadDashboard() {
  setLoading(true);
  try {
    const res = await apiFetch({ action: "admin_stats", password: _adminPassword });
    if (!res.ok) {
      alert("Error loading data: " + res.error);
      return;
    }
    renderSummary(res);
    renderCategories(res.categories);
  } catch (err) {
    alert("Network error: " + err.message);
  } finally {
    setLoading(false);
  }
}

// ── Summary stats ─────────────────────────────────────────────────────────────

function renderSummary(stats) {
  document.getElementById("stat-ballots").textContent = stats.totalBallots;
  document.getElementById("stat-percent").textContent = stats.percentVoted + "%";

  const statusEl = document.getElementById("voting-status");
  if (stats.votingOpen) {
    const deadline = new Date(stats.deadlineISO);
    statusEl.textContent = "Open — closes " + deadline.toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
    });
    statusEl.className = "status-badge status-badge--open";
  } else {
    statusEl.textContent = "Closed";
    statusEl.className = "status-badge status-badge--closed";
  }

  renderInsights(stats);
}

function renderInsights(stats) {
  const cats = stats.categories;
  if (!cats || cats.length === 0) return;

  // Most voted: category with the highest totalVotes.
  const mostVoted = cats.reduce((best, c) => c.totalVotes > best.totalVotes ? c : best, cats[0]);

  // Most skipped: category with the fewest votes (only among categories that
  // have at least one ballot submitted, so we don't show 0/0 edge cases).
  const withVotes = cats.filter(c => c.totalVotes > 0);
  const mostSkipped = withVotes.length > 0
    ? withVotes.reduce((worst, c) => c.totalVotes < worst.totalVotes ? c : worst, withVotes[0])
    : null;

  // Total write-in votes across all categories.
  const writeInCount = cats.reduce((sum, c) => {
    return sum + c.topNominees.filter(n => n.isWriteIn).reduce((s, n) => s + n.votes, 0);
  }, 0);

  const barEl = document.getElementById("insights-bar");

  // Only show the bar if there's something meaningful to display.
  if (stats.totalBallots === 0) {
    barEl.style.display = "none";
    return;
  }

  const supTitle = (catId) => {
    const s = SUP_MAP[catId];
    // Strip "The X Award" → "X" for brevity, keep it short.
    if (!s) return catId;
    return s.title.replace(/^The /, "").replace(/ Award.*$/, "");
  };

  document.getElementById("insight-most-voted").textContent =
    `${supTitle(mostVoted.categoryId)} (${mostVoted.totalVotes} votes)`;

  document.getElementById("insight-most-skipped").textContent = mostSkipped
    ? `${supTitle(mostSkipped.categoryId)} (${mostSkipped.totalVotes} votes)`
    : "—";

  document.getElementById("insight-writeins").textContent =
    writeInCount === 0 ? "None" : writeInCount;

  barEl.style.display = "flex";
}

// ── Per-category results ──────────────────────────────────────────────────────

function renderCategories(categories) {
  const container = document.getElementById("categories-container");
  if (!container) return;
  container.innerHTML = "";

  const catMap = {};
  (categories || []).forEach(c => { catMap[c.categoryId] = c; });

  SUPERLATIVES.forEach((sup, idx) => {
    const cat = catMap[sup.id];

    const section = document.createElement("div");
    section.className = "admin-category";

    const header = document.createElement("div");
    header.className = "admin-category__header";

    const titleWrap = document.createElement("div");
    const num = document.createElement("span");
    num.className = "admin-category__num";
    num.textContent = idx + 1;
    const title = document.createElement("span");
    title.className = "admin-category__title";
    title.textContent = sup.title;
    titleWrap.appendChild(num);
    titleWrap.appendChild(title);

    const totalVotes = document.createElement("span");
    totalVotes.className = "admin-category__total";
    totalVotes.textContent = cat
      ? cat.totalVotes + " vote" + (cat.totalVotes !== 1 ? "s" : "")
      : "0 votes";

    header.appendChild(titleWrap);
    header.appendChild(totalVotes);
    section.appendChild(header);

    if (!cat || !cat.topNominees || cat.topNominees.length === 0) {
      const empty = document.createElement("p");
      empty.className = "admin-category__empty";
      empty.textContent = "No votes yet.";
      section.appendChild(empty);
    } else {
      const top3 = cat.topNominees.slice(0, 3);
      const list = document.createElement("ol");
      list.className = "admin-nominee-list";

      top3.forEach((nominee, rank) => {
        const li = document.createElement("li");
        li.className = "admin-nominee-list__item";

        const rankEl = document.createElement("span");
        rankEl.className = "admin-nominee-list__rank";
        rankEl.textContent = rank + 1;

        const nameEl = document.createElement("span");
        nameEl.className = "admin-nominee-list__name";
        nameEl.textContent = nominee.name;

        if (nominee.isWriteIn) {
          const badge = document.createElement("span");
          badge.className = "write-in-badge";
          badge.textContent = "write-in";
          nameEl.appendChild(badge);
        }

        const votesEl = document.createElement("span");
        votesEl.className = "admin-nominee-list__votes";
        votesEl.textContent = nominee.votes + (nominee.votes === 1 ? " vote" : " votes");

        li.appendChild(rankEl);
        li.appendChild(nameEl);
        li.appendChild(votesEl);
        list.appendChild(li);
      });

      section.appendChild(list);
    }

    container.appendChild(section);
  });
}

// ── CSV export ────────────────────────────────────────────────────────────────

async function exportCSV() {
  const btn = document.getElementById("export-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Generating…"; }

  try {
    const res = await apiFetch({ action: "admin_export", password: _adminPassword });
    if (!res.ok) {
      alert("Export failed: " + res.error);
      return;
    }

    const blob = new Blob([res.csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "superlatives-results.csv";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("Network error during export: " + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Export CSV"; }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

async function apiFetch(body) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function setLoading(loading) {
  const el = document.getElementById("loading-indicator");
  if (el) el.style.display = loading ? "flex" : "none";
}
