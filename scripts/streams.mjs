/**
 * Shared search definitions. Imported by sync-jobs.mjs (Adzuna API) and
 * parse-alert.mjs (job-alert emails) so both apply the same relevance rules.
 */

/* Which searches feed which tab.
 *
 * `terms` are what gets sent to Adzuna, which matches against the whole ad
 * body — so "tennis" alone pulls in every golf club and hotel that mentions
 * a tennis court in its perks. `match` is the guard: a result is only kept
 * if its TITLE matches, which is what actually keeps a stream on topic.
 * Widen a stream by adding terms; keep it honest by widening `match` too. */
export const STREAMS = [
  {
    cat: "it",
    cv: "Q3 2026",
    regions: { NSW: "New South Wales", QLD: "Queensland" },
    terms: [
      "network engineer",
      "systems engineer",
      "service delivery manager",
      "IT project manager",
      "infrastructure engineer",
      "IT manager"
    ],
    match: /\b(IT|ICT|network|networking|system|systems|infrastructure|cloud|server|devops|SRE|technical|technology|telecom|telecommunications|telco|broadband|NBN|fibre|fiber|wireless|VoIP|engineer|engineering|architect|analyst|administrator|support|helpdesk|help ?desk|service desk|delivery|project manager|program manager|security|cyber|data ?cent(re|er)|platform|application|software|developer|programmer|database|DBA|storage|backup|virtualisation|virtualization|automation|integration|Azure|AWS|M365|Microsoft|Cisco|VMware|Citrix|Linux)\b/i
  },
  {
    cat: "photography",
    cv: "Photography",
    regions: { NSW: "New South Wales" },
    terms: ["photographer", "photography", "photo editor", "videographer"],
    match: /\b(photograph(y|er|ic)?|photo|videograph(y|er)|cinematograph(y|er)|camera|retoucher)\b/i
  },
  {
    cat: "tennis",
    cv: "Tennis",
    regions: { NSW: "New South Wales" },
    terms: ["tennis coach", "tennis instructor", "tennis"],
    match: /\btennis\b/i
  }
];

export const matcherFor = cat => (STREAMS.find(s => s.cat === cat) || {}).match || null;
