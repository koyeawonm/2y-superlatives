# 2Y Send-Off Superlatives

Voting site for the Wharton MBA Class of 2026 send-off superlatives.
Built on GitHub Pages + Google Apps Script + Google Sheets.

---

## Quick setup (under 30 minutes)

### Step 1 — Google Sheet: set up the database

1. Create a new Google Sheet named **"2Y Superlatives"**.
2. Create two tabs with these **exact** names and headers:

**`submissions` tab** (row 1 = header):
```
timestamp
```

**`votes` tab** (row 1 = headers):
```
ballot_id | category_id | nominee_name | is_write_in
```

> Tab names must match exactly: `submissions` and `votes` (lowercase, no spaces).

---

### Step 2 — Apps Script: deploy the backend

1. In your Google Sheet, go to **Extensions → Apps Script**.
2. Delete all existing code in the editor.
3. Copy the entire contents of `apps_script/Code.gs` and paste it in.
4. Set the two constants at the top if you want to change them:
   ```js
   const ADMIN_PASSWORD    = "2Y2026!";
   const VOTING_DEADLINE_MS = new Date("2026-05-01T03:59:00Z").getTime(); // April 30 11:59pm ET
   ```
5. Click **Deploy → New deployment**.
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy**. Authorize when prompted.
7. Copy the **Web app URL** — it looks like `https://script.google.com/macros/s/ABC.../exec`.

> **Every time you edit Code.gs**, you must click **Deploy → New deployment** for changes to take effect. Apps Script serves the last deployed version, not the saved file.

---

### Step 3 — Frontend config: set the Apps Script URL

Open `js/app.js` and set:
```js
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/ABC.../exec";
```

Open `js/admin.js` and set the same URL:
```js
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/ABC.../exec";
```

---

### Step 4 — Deploy to GitHub Pages

1. Create a new GitHub repo (public or private).
2. Push all files:
   ```bash
   git init
   git add .
   git commit -m "Initial deploy"
   git remote add origin https://github.com/<username>/<repo>.git
   git push -u origin main
   ```
3. In your repo: **Settings → Pages → Source → Deploy from a branch → main / (root)**.
4. Wait ~60 seconds. Your site is live at `https://<username>.github.io/<repo>/`.

> The `.nojekyll` file at the root tells GitHub Pages to skip Jekyll processing. Required.

---

### Step 5 — Test before sharing

- [ ] Run `python3 -m http.server 8000` from the project root and open `http://localhost:8000`
- [ ] Click "Start Voting", fill in a few categories, submit
- [ ] Check `votes` sheet — rows appear (shuffled order, no timestamps)
- [ ] Check `submissions` sheet — one row with a timestamp
- [ ] Reload the page — should show "Already submitted!" screen
- [ ] Open in incognito — should show the landing page and ballot again (this is the intended escape hatch if someone needs to re-vote)
- [ ] Open `admin.html`, enter `2Y2026!`, verify stats load and category results appear
- [ ] Click Export CSV — verify the download has the right columns
- [ ] Push to GitHub Pages, test once more on the live URL

---

## Duplicate prevention

Duplicate prevention is **client-side only**: after a successful submission, the browser sets `localStorage.ballot_submitted = "true"`. On next load, the site shows "Already submitted!" instead of the ballot.

This is intentional — the link is being shared with a trusted class via WhatsApp, not the public internet. Anyone who genuinely needs to re-vote (e.g. submitted with a mistake) can open an incognito window.

---

## Anonymity model

- **`submissions` sheet**: one row per ballot, containing only a `timestamp`. Used to count total ballots. No identifying information.
- **`votes` sheet**: one or two rows per category per ballot, containing a random `ballot_id` (UUID), category ID, nominee name, and write-in flag. The `ballot_id` is **never** written to the `submissions` sheet — there is no link between the two sheets.
- Vote rows are **shuffled** before being written to `votes`, so row order doesn't correlate with submission time.
- No timestamps are stored in `votes`.

Even with full read access to both sheets, it is not possible to link a submission timestamp to a specific set of votes.

---

## File structure

```
/
├── index.html          # Landing + ballot (state-driven, no page reloads)
├── admin.html          # Admin dashboard (password-gated)
├── css/
│   └── styles.css
├── js/
│   ├── classmates.js   # Hardcoded classmate array (75 people)
│   ├── superlatives.js # Hardcoded superlatives array (33 categories)
│   ├── app.js          # Ballot logic + API calls
│   ├── autocomplete.js # Autocomplete component
│   └── admin.js        # Admin dashboard logic
├── apps_script/
│   └── Code.gs         # Full backend — paste into Apps Script editor
├── .nojekyll
└── README.md
```

---

## Troubleshooting

### "Could not connect" / network error
- Make sure the Apps Script URL ends in `/exec` (not `/dev`).
- The URL must be from a **New deployment**, not just a saved file.

### Votes not appearing in the Sheet
Check Apps Script execution logs: **Apps Script editor → Executions**. Common causes:
- Sheet tab names don't exactly match `SUBMISSIONS_SHEET` / `VOTES_SHEET` constants (`submissions`, `votes`).
- Header row is missing from one of the tabs.

### Admin dashboard shows "Invalid admin password"
Password validation happens in Apps Script. If you changed `ADMIN_PASSWORD`, you must create a **new deployment** for it to take effect.

### Someone submitted twice
Open the `submissions` sheet — count rows minus 1 to see how many submissions landed. If you need to discard a duplicate, delete the corresponding rows from both sheets. Since `ballot_id` is shared across `votes` rows for a ballot but not in `submissions`, use the timestamp proximity and row count to identify likely duplicates (accepting some imprecision, which is fine for a class vote).

---

## Local development

```bash
python3 -m http.server 8000
# or
npx serve .
```

Open `http://localhost:8000`.

---

*Built with love for the 2Y class of 2026. ✦*
