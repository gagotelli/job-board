#!/usr/bin/env node
/**
 * Pulls new listings into data/jobs.json, then regenerates the JOBS array
 * inside index.html from it.
 *
 * data/jobs.json is the source of truth. index.html is generated output —
 * edit the JSON (or your notes in it), never the array in the HTML, or the
 * next sync will overwrite you.
 *
 * Existing entries are never modified and never deleted. A listing already
 * present (matched on URL) is left exactly as it is, so hand-written notes
 * and status changes survive every sync.
 *
 *   node scripts/sync-jobs.mjs               fetch + merge + render
 *   node scripts/sync-jobs.mjs --render-only re-render HTML from the JSON
 *   node scripts/sync-jobs.mjs --dry-run     show what would change, write nothing
 *   node scripts/sync-jobs.mjs --prune       drop off-topic and duplicate imports
 *   node scripts/sync-jobs.mjs --merge f.json add entries parsed from an alert email
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STREAMS } from "./streams.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JSON_PATH = path.join(ROOT, "data", "jobs.json");
const HTML_PATH = path.join(ROOT, "index.html");

const args = new Set(process.argv.slice(2));
const RENDER_ONLY = args.has("--render-only");
const DRY_RUN = args.has("--dry-run");
const PRUNE = args.has("--prune");
const MERGE_FILE = (() => {
  const a = process.argv.slice(2);
  const i = a.indexOf("--merge");
  return i === -1 ? null : a[i + 1];
})();

/* How far back to ask for. Matches the 14-day window the board works to. */
const MAX_DAYS_OLD = 14;


const APP_ID = process.env.ADZUNA_APP_ID;
const APP_KEY = process.env.ADZUNA_APP_KEY;

const load = () => JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
const todayISO = () => new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------------ fetch */

async function search(term, whereLabel) {
  const url = new URL("https://api.adzuna.com/v1/api/jobs/au/search/1");
  url.searchParams.set("app_id", APP_ID);
  url.searchParams.set("app_key", APP_KEY);
  url.searchParams.set("results_per_page", "50");
  url.searchParams.set("what", term);
  url.searchParams.set("where", whereLabel);
  url.searchParams.set("max_days_old", String(MAX_DAYS_OLD));
  url.searchParams.set("content-type", "application/json");

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Adzuna ${res.status} ${res.statusText} for "${term}" in ${whereLabel}`);
  }
  const data = await res.json();
  return Array.isArray(data.results) ? data.results : [];
}

/* Adzuna's shape is not guaranteed, so read every field defensively. */
function toEntry(raw, { cat, cv, region }) {
  const url = raw.redirect_url;
  const title = raw.title;
  if (!url || !title) return null;

  const strip = s => String(s).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const posted = raw.created ? String(raw.created).slice(0, 10) : "";

  let salary = "";
  if (raw.salary_min && raw.salary_max) {
    const k = n => "$" + Math.round(n / 1000) + "k";
    salary = raw.salary_min === raw.salary_max
      ? k(raw.salary_min)
      : `${k(raw.salary_min)}–${k(raw.salary_max)}`;
  }

  return {
    d: todayISO(),                                   // date this sync found it
    posted,                                          // date the ad went up
    src: "adzuna",                                   // which feed it came from
    cat,
    r: region,
    t: strip(title),
    c: strip(raw.company?.display_name || "Unknown"),
    l: strip(raw.location?.display_name || region),
    u: url,
    cv,
    s: "maybe",                                      // everything lands unread
    n: [salary, strip(raw.description || "").slice(0, 180)].filter(Boolean).join(" · ")
  };
}

async function fetchAll() {
  const found = [];
  const problems = [];
  let offTopic = 0;

  for (const stream of STREAMS) {
    for (const [region, whereLabel] of Object.entries(stream.regions)) {
      for (const term of stream.terms) {
        try {
          const results = await search(term, whereLabel);
          for (const raw of results) {
            const entry = toEntry(raw, { cat: stream.cat, cv: stream.cv, region });
            if (!entry) continue;
            // Adzuna matches the whole ad body, so drop anything whose
            // title says it belongs to a different line of work.
            if (stream.match && !stream.match.test(entry.t)) { offTopic++; continue; }
            found.push(entry);
          }
          // Be a considerate API citizen.
          await new Promise(r => setTimeout(r, 350));
        } catch (err) {
          problems.push(err.message);
        }
      }
    }
  }
  return { found, problems, offTopic };
}

/* ----------------------------------------------------------------- render */

const esc = s => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function toLiteral(j) {
  const f = [
    `d:"${esc(j.d)}"`,
    j.posted ? `posted:"${esc(j.posted)}"` : null,
    j.src ? `src:"${esc(j.src)}"` : null,
    `cat:"${esc(j.cat)}"`,
    `r:"${esc(j.r)}"`,
    `t:"${esc(j.t)}"`,
    `c:"${esc(j.c)}"`,
    `l:"${esc(j.l)}"`,
    `u:"${esc(j.u)}"`,
    `cv:"${esc(j.cv)}"`,
    `s:"${esc(j.s)}"`,
    `n:"${esc(j.n)}"`
  ].filter(Boolean);
  return "  {" + f.join(",") + "}";
}

function render(jobs) {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const open = "const JOBS = [";
  const close = "\n];";
  const i = html.indexOf(open);
  const k = html.indexOf(close, i);
  if (i === -1 || k === -1) throw new Error("Could not find the JOBS array in index.html");

  // Newest day first, so the file reads the way the board does.
  const sorted = [...jobs].sort((a, b) => (b.d || "").localeCompare(a.d || ""));

  const banner =
    "\n  // Generated from data/jobs.json by scripts/sync-jobs.mjs — do not edit by hand.\n";
  const out =
    html.slice(0, i + open.length) + banner +
    sorted.map(toLiteral).join(",\n") +
    html.slice(k);

  fs.writeFileSync(HTML_PATH, out);
  return sorted.length;
}

/* ------------------------------------------------------------------- main */

const existing = load();

/* Adzuna indexes the same advert from several feeds, so one role can arrive
   under a handful of URLs. Same title + employer + state is the same job. */
const sameJob = j =>
  [j.t, j.c, j.r].map(v => String(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).join("|");

/* Auto-imported rows come from Adzuna; anything else was added by hand and
   is never touched by pruning. */
const isImported = j => {
  try { return new URL(j.u).hostname.endsWith("adzuna.com.au"); } catch { return false; }
};

if (RENDER_ONLY) {
  console.log(`Rendered ${render(existing)} jobs into index.html`);
  process.exit(0);
}

if (MERGE_FILE) {
  const incoming = JSON.parse(fs.readFileSync(MERGE_FILE, "utf8"));
  const seenUrl = new Set(existing.map(j => j.u));
  const seenJob = new Set(existing.map(sameJob));
  const fresh = [];
  for (const j of incoming) {
    if (!j.u || !j.t || !j.c) continue;
    if (seenUrl.has(j.u) || seenJob.has(sameJob(j))) continue;
    seenUrl.add(j.u); seenJob.add(sameJob(j));
    fresh.push(j);
  }
  if (!fresh.length) {
    console.log(`Nothing new in ${MERGE_FILE} (${incoming.length} offered).`);
    process.exit(0);
  }
  console.log(`Adding ${fresh.length} of ${incoming.length} from ${MERGE_FILE}:`);
  for (const j of fresh) console.log(`  [${j.src}/${j.cat}] ${j.t} — ${j.c}`);
  if (DRY_RUN) { console.log("\n--dry-run: nothing written."); process.exit(0); }
  const merged = [...existing, ...fresh];
  fs.writeFileSync(JSON_PATH, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Wrote ${merged.length} jobs to data/jobs.json`);
  console.log(`Rendered ${render(merged)} jobs into index.html`);
  process.exit(0);
}

if (PRUNE) {
  const matcher = Object.fromEntries(STREAMS.map(s => [s.cat, s.match]));
  const kept = [], dropped = [];
  const seenJob = new Set();

  for (const j of existing) {
    if (!isImported(j)) { kept.push(j); continue; }        // hand-added, always keep
    const m = matcher[j.cat];
    if (m && !m.test(j.t)) { dropped.push([j, "off-topic"]); continue; }
    const key = sameJob(j);
    if (seenJob.has(key)) { dropped.push([j, "duplicate"]); continue; }
    seenJob.add(key);
    kept.push(j);
  }

  if (!dropped.length) {
    console.log("Nothing to prune.");
    process.exit(0);
  }
  const by = {};
  for (const [j, why] of dropped) by[j.cat + " " + why] = (by[j.cat + " " + why] || 0) + 1;
  console.log(`Pruning ${dropped.length} of ${existing.length} imported rows:`);
  for (const [k, n] of Object.entries(by)) console.log(`  ${n}\t${k}`);
  console.log("\nExamples:");
  for (const [j, why] of dropped.slice(0, 8)) console.log(`  (${why}) [${j.cat}] ${j.t} — ${j.c}`);

  if (DRY_RUN) { console.log("\n--dry-run: nothing written."); process.exit(0); }

  fs.writeFileSync(JSON_PATH, JSON.stringify(kept, null, 2) + "\n");
  console.log(`\nWrote ${kept.length} jobs to data/jobs.json`);
  console.log(`Rendered ${render(kept)} jobs into index.html`);
  process.exit(0);
}

if (!APP_ID || !APP_KEY) {
  console.log(
    "No ADZUNA_APP_ID / ADZUNA_APP_KEY set — skipping fetch.\n" +
    "Get free credentials at https://developer.adzuna.com/ and add them as\n" +
    "repository secrets (Settings -> Secrets and variables -> Actions).\n" +
    "Until then the board keeps whatever is already in data/jobs.json."
  );
  process.exit(0);
}

const { found, problems, offTopic } = await fetchAll();

const seenUrl = new Set(existing.map(j => j.u));
const seenJob = new Set(existing.filter(isImported).map(sameJob));
const fresh = [];
let dupes = 0;
for (const j of found) {
  if (seenUrl.has(j.u)) { dupes++; continue; }   // already tracked, leave it untouched
  const key = sameJob(j);
  if (seenJob.has(key)) { dupes++; continue; }   // same role via a different feed
  seenUrl.add(j.u);
  seenJob.add(key);
  fresh.push(j);
}

for (const p of problems) console.warn("warning: " + p);
console.log(`Results kept ${found.length}, dropped ${offTopic} off-topic, ${dupes} already known or duplicate.`);

if (!fresh.length) {
  console.log("No new listings. Nothing to commit.");
  process.exit(0);
}

console.log(`Found ${fresh.length} new listings:`);
for (const j of fresh.slice(0, 20)) console.log(`  [${j.cat}/${j.r}] ${j.t} — ${j.c}`);
if (fresh.length > 20) console.log(`  …and ${fresh.length - 20} more`);

if (DRY_RUN) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

const merged = [...existing, ...fresh];
fs.writeFileSync(JSON_PATH, JSON.stringify(merged, null, 2) + "\n");
console.log(`Wrote ${merged.length} jobs to data/jobs.json`);
console.log(`Rendered ${render(merged)} jobs into index.html`);
