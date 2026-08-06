#!/usr/bin/env node
/**
 * Turns a job-alert email into job entries.
 *
 *   node scripts/parse-alert.mjs --source indeed --cat it --region NSW < body.txt
 *
 * Reads the email's PLAIN TEXT body on stdin and writes JSON entries to
 * stdout, ready for `sync-jobs.mjs --merge`.
 *
 * Each board formats its alert differently, so every source needs its own
 * parser written against a real sample. Only parsers that have been checked
 * against an actual email are listed in PARSERS — asking for one that isn't
 * there fails loudly rather than silently inventing rows.
 */

import fs from "node:fs";
import { matcherFor } from "./streams.mjs";

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf("--" + k); return i === -1 ? null : args[i + 1]; };

const SOURCE = opt("source");
const CAT    = opt("cat")    || "it";
const REGION = opt("region") || "NSW";
const CV     = opt("cv")     || "Q3 2026";

const todayISO = () => new Date().toISOString().slice(0, 10);
const clean = s => String(s).replace(/\s+/g, " ").trim();

/* Indeed's plain-text alert repeats a fixed block per job:
 *
 *   Job Title
 *   Company - Location
 *   $salary a year            (optional)
 *   Easily apply              (optional)
 *   a line or two of blurb
 *   https://au.indeed.com/... (the link closes the block)
 */
function parseIndeed(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let block = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (/^https?:\/\/\S*indeed\.com\/\S+/.test(line)) {
      const entry = blockToEntry(block, line);
      if (entry) out.push(entry);
      block = [];
    } else if (line) {
      block.push(line);
    }
  }
  return out;

  function blockToEntry(b, url) {
    // Drop the greeting and any boilerplate that opens the mail.
    const start = b.findIndex(l => /^.+\s+-\s+.+$/.test(l));
    if (start < 1) return null;

    const title = clean(b[start - 1]);
    const m = b[start].match(/^(.*?)\s+-\s+(.*)$/);
    if (!title || !m) return null;

    const company = clean(m[1]);
    const location = clean(m[2]);
    if (!company || !location) return null;

    const salary = b.slice(start + 1).find(l => /^\$[\d,]/.test(l)) || "";
    const blurb = b.slice(start + 1)
      .filter(l => !/^\$[\d,]/.test(l) && !/^Easily apply$/i.test(l))
      .join(" ");

    return {
      d: todayISO(),
      src: "indeed",
      cat: CAT,
      r: REGION,
      t: title,
      c: company,
      l: location,
      u: url,
      cv: CV,
      s: "maybe",
      n: [clean(salary), clean(blurb).slice(0, 180)].filter(Boolean).join(" · ")
    };
  }
}

/* Only verified parsers belong here. */
const PARSERS = { indeed: parseIndeed };

if (!SOURCE || !PARSERS[SOURCE]) {
  console.error(
    `No verified parser for source "${SOURCE}".\n` +
    `Available: ${Object.keys(PARSERS).join(", ")}\n\n` +
    `A parser can only be written against a real sample of that board's\n` +
    `alert email. Forward one and it can be added — guessing the format\n` +
    `would produce entries that look right and link nowhere.`
  );
  process.exit(2);
}

const body = fs.readFileSync(0, "utf8");
const entries = PARSERS[SOURCE](body);

// A location that names another state should not be filed under this one.
const OTHER_STATES = /\b(QLD|Queensland|VIC|Victoria|WA|Western Australia|SA|South Australia|TAS|Tasmania|NT|ACT)\b/i;
const inRegion = entries.filter(e => REGION === "QLD" || !OTHER_STATES.test(e.l));

/* Alert emails carry whatever the board felt like recommending, so the same
   title test the API sync uses applies here. Without it a "jobs picked for
   you" mail drops personal trainers and brand ambassadors onto the board. */
const match = matcherFor(CAT);
const kept = match ? inRegion.filter(e => match.test(e.t)) : inRegion;

process.stderr.write(
  `Parsed ${entries.length}, ${inRegion.length} in ${REGION}, ` +
  `${kept.length} on topic for "${CAT}".\n`
);
process.stdout.write(JSON.stringify(kept, null, 2) + "\n");
