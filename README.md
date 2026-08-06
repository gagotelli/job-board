# Job board

A single-page tracker for the Sydney & Queensland job search. Three streams
(IT, Photography, Tennis), per-role status, and notes on fit.

Live at **https://gagotelli.github.io/job-board/**

## How the pieces fit

```
data/jobs.json  ──  source of truth. Every listing lives here.
      │
      │  scripts/sync-jobs.mjs
      ▼
index.html      ──  generated. Self-contained: open it anywhere.
```

`index.html` is the whole app — styles, script and job data inlined, no build
step and no runtime dependencies. That means it works opened straight off
disk, but it also means **the job data is baked in**. The page never fetches
anything; the list changes only when the file changes.

The `JOBS` array inside `index.html` is generated. Don't hand-edit it —
edit `data/jobs.json` and re-render:

```bash
node scripts/sync-jobs.mjs --render-only
```

## Daily sync

`.github/workflows/daily-jobs.yml` runs at 20:00 UTC (6am AEST / 7am AEDT),
queries the Adzuna API for each stream, adds anything new, and commits. GitHub
Pages redeploys on push, so the board updates on its own.

**It does nothing until you add API credentials.** Without them the script
prints a notice and exits cleanly, leaving the board as-is.

1. Get a free key at <https://developer.adzuna.com/>
2. Repo **Settings → Secrets and variables → Actions → New repository secret**
3. Add `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`
4. **Actions** tab → *Daily job sync* → **Run workflow** to test it immediately

### The merge is append-only

A listing already in `data/jobs.json` (matched on URL) is left completely
alone — title, note, status, everything. Sync only ever *adds*. Your triage
is never overwritten, and nothing is auto-deleted when an ad expires.

New listings arrive as `maybe` with the salary and a description snippet as
the note, for you to triage.

### Tuning what it searches

Search terms live in the `STREAMS` block at the top of
`scripts/sync-jobs.mjs`. Add or remove terms there. `MAX_DAYS_OLD` (default
14) sets how far back each query reaches.

## Adding jobs by hand

Append an object to `data/jobs.json`, then `--render-only`:

```json
{
  "d": "2026-08-06",
  "posted": "2026-08-04",
  "cat": "it",
  "r": "NSW",
  "t": "Network Engineer",
  "c": "Some Company",
  "l": "Sydney · Hybrid",
  "u": "https://www.seek.com.au/job/12345678",
  "cv": "Q3 2026",
  "s": "apply",
  "n": "Why it is or isn't a fit."
}
```

| Field | Meaning |
|---|---|
| `d` | date **you found** it — drives the day grouping |
| `posted` | date the **ad went up** — drives the age badge. Optional; omit rather than guess |
| `cat` | `it` \| `photography` \| `tennis` |
| `r` | `NSW` \| `QLD` |
| `cv` | which CV version to send |
| `s` | `apply` \| `maybe` \| `applied` \| `skip` — the starting status |

`d` and `posted` are deliberately separate. They're the same for a role found
the day it was listed, and they diverge the moment older roles get imported.
Only `posted` produces an age badge, which turns amber past 14 days.

## Known limits

- **Adzuna is an aggregator, not Seek.** It indexes a subset of the Australian
  market. Expect coverage to differ from a direct Seek search — keep your Seek
  and LinkedIn job alerts running alongside this.
- **Seek, LinkedIn, Indeed and Jora cannot be scraped.** All four return 403 to
  automated requests and their terms prohibit it. That's why this uses an API
  rather than reading those sites directly.
- **The sync has never run against the live API.** It was built and tested
  against a stubbed response; the first real run may need adjustment if
  Adzuna's response shape differs from what's assumed.
- **Scheduled runs are not a precise alarm.** GitHub delays cron under load,
  and disables scheduled workflows on public repos after 60 days without
  commits. A daily sync that commits keeps itself alive; a long quiet spell
  won't.
- **Status is per-browser.** Statuses live in `localStorage`, so your laptop
  and phone keep separate marks, and the hosted site and a local copy don't
  share them either.
- **The sign-in is not security.** This repo is public and every listing is
  readable in the page source without signing in. The gate is a convenience,
  and the login screen says so.

## Local development

```bash
python3 -m http.server 8000     # then open http://127.0.0.1:8000
```

Serve it rather than double-clicking: sign-in uses WebCrypto, which needs a
secure context (`https://` or `localhost`).
