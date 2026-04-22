// =============================================================================
// 2Y Send-Off Superlatives — Google Apps Script Backend
// =============================================================================
// Deploy as: Execute as → Me | Who has access → Anyone
// After deploying, copy the Web App URL into js/app.js and js/admin.js.
// =============================================================================

// ── CONFIGURE THESE BEFORE DEPLOYING ─────────────────────────────────────────

// Admin dashboard password. Never expose this in client code — the client
// sends a plaintext password attempt here and this script validates it.
const ADMIN_PASSWORD = "2Y2026!";

// Voting deadline: April 30, 2026 at 11:59pm ET (UTC-4 in April = 03:59 UTC May 1).
// Stored as a Unix timestamp in milliseconds.
const VOTING_DEADLINE_MS = new Date("2026-05-01T03:59:00Z").getTime();

// Sheet tab names — must match exactly.
const SUBMISSIONS_SHEET = "submissions";
const VOTES_SHEET       = "votes";

// =============================================================================
// ENTRY POINT
// =============================================================================

/**
 * Main entry point for all HTTP POST requests.
 * Returns JSON via ContentService (handles CORS for browser fetch calls).
 */
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action;

    let result;
    switch (action) {
      case "submit_ballot": result = handleSubmitBallot(body); break;
      case "admin_stats":   result = handleAdminStats(body);   break;
      case "admin_export":  result = handleAdminExport(body);  break;
      default:
        result = { ok: false, error: "Unknown action: " + action };
    }

    return respond(result);
  } catch (err) {
    return respond({ ok: false, error: "Server error: " + err.message });
  }
}

function doGet(e) {
  return respond({ ok: true, message: "2Y Superlatives API is running." });
}

// =============================================================================
// HANDLERS
// =============================================================================

/**
 * submit_ballot
 * No authentication — duplicate prevention is client-side (localStorage).
 * Server only enforces the voting deadline.
 *
 * Body: { action, votes: [{ categoryId, nomineeName, isWriteIn }] }
 *       Duo: [{ categoryId, nomineeName1, nomineeName2, isWriteIn }]
 * Returns: { ok }
 */
function handleSubmitBallot(body) {
  // Server-side deadline check.
  if (Date.now() > VOTING_DEADLINE_MS) {
    return { ok: false, error: "Voting has closed." };
  }

  const votes = body.votes;
  if (!Array.isArray(votes) || votes.length === 0) {
    return { ok: false, error: "No votes provided." };
  }

  // Generate a random UUID as ballot_id.
  // This lives only in the votes sheet — it is never written to submissions.
  const ballotId = generateUUID();

  // Build vote rows. Each "single" vote = one row. Each "duo" = two rows.
  const voteRows = [];
  for (const vote of votes) {
    if (!vote.categoryId) continue;

    if (vote.nomineeName1 && vote.nomineeName2) {
      // Duo — two rows under the same ballotId.
      voteRows.push([ballotId, vote.categoryId, vote.nomineeName1, vote.isWriteIn ? "TRUE" : "FALSE"]);
      voteRows.push([ballotId, vote.categoryId, vote.nomineeName2, vote.isWriteIn ? "TRUE" : "FALSE"]);
    } else if (vote.nomineeName) {
      voteRows.push([ballotId, vote.categoryId, vote.nomineeName, vote.isWriteIn ? "TRUE" : "FALSE"]);
    }
  }

  if (voteRows.length === 0) {
    return { ok: false, error: "No valid votes found." };
  }

  // CRITICAL: Shuffle vote rows before writing.
  // Without this, row order in the votes sheet would correlate with submission
  // time, making it possible to link a submission to its ballot via timing.
  shuffleArray(voteRows);

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Write vote rows to votes sheet. No timestamp stored here.
  const votesSheet = ss.getSheetByName(VOTES_SHEET);
  if (!votesSheet) throw new Error("Sheet '" + VOTES_SHEET + "' not found.");
  const lastVoteRow = votesSheet.getLastRow();
  votesSheet.getRange(lastVoteRow + 1, 1, voteRows.length, 4).setValues(voteRows);

  // Append a single timestamp row to submissions sheet.
  // The submissions sheet has no ballot_id — there is no link between the two
  // sheets. It exists only to count total ballots submitted.
  const submissionsSheet = ss.getSheetByName(SUBMISSIONS_SHEET);
  if (!submissionsSheet) throw new Error("Sheet '" + SUBMISSIONS_SHEET + "' not found.");
  submissionsSheet.appendRow([new Date().toISOString()]);

  return { ok: true };
}

/**
 * admin_stats
 * Returns summary stats and per-category top nominees.
 * Body: { action, password }
 * Returns: { ok, totalBallots, totalEligible, percentVoted, votingOpen, deadlineISO, categories }
 */
function handleAdminStats(body) {
  if (!validateAdminPassword(body.password)) return adminAuthError();

  const ss              = SpreadsheetApp.getActiveSpreadsheet();
  const submissionsSheet = ss.getSheetByName(SUBMISSIONS_SHEET);
  const votesSheet       = ss.getSheetByName(VOTES_SHEET);

  // Total ballots = row count of submissions sheet minus the header row.
  const totalBallots  = Math.max(0, submissionsSheet.getLastRow() - 1);
  const totalEligible = 75; // Hardcoded class size.

  // Load all vote rows and tally.
  const allVoteRows      = getSheetData(votesSheet);
  const categoryTallies  = buildCategoryTallies(allVoteRows);

  const votingOpen  = Date.now() < VOTING_DEADLINE_MS;
  const deadlineISO = new Date(VOTING_DEADLINE_MS).toISOString();

  return {
    ok: true,
    totalBallots,
    totalEligible,
    percentVoted: totalEligible > 0 ? Math.round((totalBallots / totalEligible) * 100) : 0,
    votingOpen,
    deadlineISO,
    categories: categoryTallies,
  };
}

/**
 * admin_export
 * Returns CSV-ready tallies (category, rank, nominee, votes, is_write_in).
 * Does NOT export submission timestamps or any identifying data.
 * Body: { action, password }
 * Returns: { ok, csv }
 */
function handleAdminExport(body) {
  if (!validateAdminPassword(body.password)) return adminAuthError();

  const ss         = SpreadsheetApp.getActiveSpreadsheet();
  const votesSheet = ss.getSheetByName(VOTES_SHEET);
  const allVoteRows = getSheetData(votesSheet);
  const tallies     = buildCategoryTallies(allVoteRows);

  const lines = ["category_id,rank,nominee_name,votes,is_write_in"];
  for (const cat of tallies) {
    cat.topNominees.forEach((nominee, idx) => {
      lines.push([
        csvEscape(cat.categoryId),
        idx + 1,
        csvEscape(nominee.name),
        nominee.votes,
        nominee.isWriteIn ? "TRUE" : "FALSE",
      ].join(","));
    });
  }

  return { ok: true, csv: lines.join("\n") };
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Read all data rows from a sheet, returning objects keyed by the header row.
 * Assumes row 0 is the header.
 */
function getSheetData(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data    = sheet.getDataRange().getValues();
  const headers = data[0].map(h => h.toString().trim());
  const rows    = [];

  for (let i = 1; i < data.length; i++) {
    const row = {};
    headers.forEach((h, j) => { row[h] = data[i][j]; });
    rows.push(row);
  }
  return rows;
}

/**
 * Build per-category tallies from raw vote rows.
 * For duo categories, pairs are counted as order-agnostic sets:
 * "Tome + Koy" and "Koy + Tome" count as the same pair.
 */
function buildCategoryTallies(voteRows) {
  const byCategory = {};
  for (const row of voteRows) {
    const catId     = row["category_id"] || row[1];
    const name      = row["nominee_name"] || row[2];
    const isWriteIn = (row["is_write_in"] || row[3] || "").toString().toUpperCase() === "TRUE";

    if (!catId || !name) continue;

    if (!byCategory[catId]) byCategory[catId] = { single: {} };
    if (!byCategory[catId].single[name]) {
      byCategory[catId].single[name] = { votes: 0, isWriteIn };
    }
    byCategory[catId].single[name].votes++;
  }

  // Detect duo categories: any (ballot_id, category_id) group with 2 names.
  const duoCats        = new Set();
  const ballotCatGroups = {};
  for (const row of voteRows) {
    const ballotId  = row["ballot_id"] || row[0];
    const catId     = row["category_id"] || row[1];
    const name      = row["nominee_name"] || row[2];
    const isWriteIn = (row["is_write_in"] || row[3] || "").toString().toUpperCase() === "TRUE";

    if (!ballotId || !catId || !name) continue;

    const key = ballotId + "||" + catId;
    if (!ballotCatGroups[key]) ballotCatGroups[key] = { catId, names: [], isWriteIn };
    ballotCatGroups[key].names.push(name);
  }

  const duoTallies = {};
  for (const key of Object.keys(ballotCatGroups)) {
    const group = ballotCatGroups[key];
    if (group.names.length === 2) {
      duoCats.add(group.catId);
      // Normalize pair order so (A,B) === (B,A).
      const pairKey = group.names.slice().sort().join(" + ");
      if (!duoTallies[group.catId]) duoTallies[group.catId] = {};
      if (!duoTallies[group.catId][pairKey]) {
        duoTallies[group.catId][pairKey] = { votes: 0, isWriteIn: group.isWriteIn };
      }
      duoTallies[group.catId][pairKey].votes++;
    }
  }

  const allCatIds = [...new Set(voteRows.map(r => r["category_id"] || r[1]).filter(Boolean))];
  return allCatIds.map(catId => {
    const isDuo = duoCats.has(catId);
    let topNominees;

    if (isDuo && duoTallies[catId]) {
      topNominees = Object.entries(duoTallies[catId])
        .map(([name, { votes, isWriteIn }]) => ({ name, votes, isWriteIn }))
        .sort((a, b) => b.votes - a.votes);
    } else {
      const nominees = byCategory[catId] ? byCategory[catId].single : {};
      topNominees = Object.entries(nominees)
        .map(([name, { votes, isWriteIn }]) => ({ name, votes, isWriteIn }))
        .sort((a, b) => b.votes - a.votes);
    }

    return {
      categoryId:  catId,
      isDuo,
      totalVotes:  topNominees.reduce((s, n) => s + n.votes, 0),
      topNominees, // All nominees — client limits display to top 3.
    };
  });
}

/**
 * Fisher-Yates shuffle — mutates the array in place.
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Generate a version-4 UUID.
 */
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function validateAdminPassword(password) {
  return password === ADMIN_PASSWORD;
}

function adminAuthError() {
  return { ok: false, error: "Invalid admin password." };
}

function csvEscape(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function respond(result) {
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
