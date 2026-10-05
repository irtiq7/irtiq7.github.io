// Pure functions behind news/signals.json and news/forecasts.json (used by build-news.js, testable alone).
// Everything here describes what the news feeds are discussing. Nothing is advice.
"use strict";

const STOP = new Set(("a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just like me more most my new no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up us very was we were what when where which while who whom why will with would you your says say said one two three year years first last may might much many get gets got make makes made use used using via per still back even")
  .split(" "));
// Words that are common in news but say nothing about an idea
const GENERIC = new Set(("tech news report reports company companies people time week today according announced announces launch launches launched latest show shows review guide best price deal deals day days amid top big way need needs real good great take takes plans plan could says story stories read watch video photos here's inside why's weekly daily monthly update updates ceo cfo cto help found public open getty image images photo credit source sources statement including includes included percent million billion trillion across around another january february march april june july august september october november december monday tuesday wednesday thursday friday saturday sunday language prediction found")
  .split(" "));

const DAY = 864e5;
const dayStr = (t) => new Date(t).toISOString().slice(0, 10);

// ---------- terms
function tokens(text) {
  return (String(text).match(/[A-Za-z][A-Za-z0-9+#.-]*[A-Za-z0-9+#]|[A-Za-z]/g) || []).map((raw) => ({ raw, low: raw.toLowerCase() }));
}
function eligible(t) {
  if (STOP.has(t.low) || GENERIC.has(t.low)) return false;
  if (/^\d+$/.test(t.low)) return false;
  if (t.low === "ai") return false; // too broad alone; "ai agents" etc. still count as bigrams
  return t.low.length >= 4 || /^[A-Z][A-Z0-9]{2,6}$/.test(t.raw);
}
// Candidate ideas in a piece of text: single words and two-word phrases, lower-case, de-duplicated
function extractTerms(text) {
  const tk = tokens(text), out = new Set();
  for (let i = 0; i < tk.length; i++) {
    const a = tk[i], b = tk[i + 1];
    const ae = eligible(a) || a.low === "ai";
    if (eligible(a)) out.add(a.low);
    if (b && ae && (eligible(b) || b.low === "ai") && !(a.low === "ai" && b.low === "ai")) out.add(a.low + " " + b.low);
  }
  return [...out];
}
// Pick the terms worth archiving for each item: repeated ones first (they can trend), then rarer title terms
function pickTerms(items, perItem = 15) {
  const per = items.map((i) => ({ title: new Set(extractTerms(i.title)), all: extractTerms(i.title + ". " + (i.summary || "")) }));
  const df = new Map();
  per.forEach((p) => p.all.forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
  const cap = Math.max(5, Math.ceil(items.length * 0.05)); // above this a term is too common to be informative
  return per.map((p) => {
    const rank = (t) => (df.get(t) > 1 && df.get(t) <= cap ? 2 : 0) + (p.title.has(t) ? 1 : 0) + (t.includes(" ") ? 0.5 : 0);
    return p.all.filter((t) => df.get(t) <= cap).sort((a, b) => rank(b) - rank(a) || df.get(b) - df.get(a) || (a < b ? -1 : 1)).slice(0, perItem);
  });
}

// ---------- market mood (plain word lists, shown on the page)
const MOOD = {
  pos: ["rally", "rallies", "surge", "surges", "soar", "soars", "record", "gains", "gain", "jump", "jumps", "beats", "beat", "upgrade", "upgrades", "rebound", "rebounds", "boom", "optimism", "strong", "growth", "rises", "climb", "climbs", "bullish", "outperform"],
  neg: ["slump", "slumps", "plunge", "plunges", "tumble", "tumbles", "selloff", "sell-off", "fears", "fear", "recession", "cuts", "cut", "warning", "warns", "downgrade", "downgrades", "crash", "losses", "loss", "drop", "drops", "falls", "slows", "slowdown", "layoffs", "bearish", "weak", "worry", "worries", "risk"],
};
function moodScore(text) {
  const w = String(text).toLowerCase().match(/[a-z][a-z-]+/g) || [];
  let p = 0, n = 0;
  for (const x of w) { if (MOOD.pos.includes(x)) p++; else if (MOOD.neg.includes(x)) n++; }
  return p + n ? Math.round(((p - n) / (p + n)) * 100) / 100 : null;
}

// ---------- emerging ideas
// items: archive entries {id, c: category, s: source id, p: published ISO, w: [terms], t: [topics], m: mood}
function collect(items, now) {
  const recentFrom = now - 7 * DAY, baseFrom = now - 28 * DAY, catFrom = now - 14 * DAY;
  const terms = new Map();
  const entry = (t) => terms.get(t) || terms.set(t, { recent: new Set(), base: new Set(), src: new Set(), cats: new Set(), first: {}, ex: [] }).get(t);
  for (const it of items) {
    const ts = Date.parse(it.p); if (!Number.isFinite(ts) || ts > now + DAY) continue;
    for (const t of it.w || []) {
      const e = entry(t);
      if (!e.first[it.c] || ts < Date.parse(e.first[it.c])) e.first[it.c] = it.p;
      if (ts >= recentFrom) { e.recent.add(it.id); e.src.add(it.s); e.ex.push({ id: it.id, ts }); }
      else if (ts >= baseFrom) e.base.add(it.id);
      if (ts >= catFrom) e.cats.add(it.c);
    }
  }
  return terms;
}
function describe(term, e) {
  const stage = e.cats.has("research") ? (e.cats.has("tech") || e.cats.has("business") ? "spreading" : "early") : "mainstream";
  const f = e.first, rs = f.research ? Date.parse(f.research) : null;
  const later = [f.tech, f.business].filter(Boolean).map((x) => Date.parse(x)).sort((a, b) => a - b)[0];
  return {
    term, stage, recent: e.recent.size, base_per_week: Math.round(e.base.size / 3 * 10) / 10, outlets: e.src.size, is_new: e.base.size === 0,
    first_seen: Object.fromEntries(Object.entries(f).map(([c, v]) => [c, dayStr(Date.parse(v))])),
    lag_days: rs && later && later > rs ? Math.round((later - rs) / DAY) : null,
    examples: e.ex.sort((a, b) => b.ts - a.ts).slice(0, 3).map((x) => x.id),
  };
}
// Is there enough older data to say a term is unusually frequent? (Needs about three weeks of history.)
function baselineStats(items, now) {
  const days = new Set(); let n = 0;
  for (const it of items) { const ts = Date.parse(it.p); if (ts >= now - 28 * DAY && ts < now - 7 * DAY) { n++; days.add(dayStr(ts)); } }
  return { items: n, days: days.size, ready: n >= 150 && days.size >= 7, needs: "at least 150 stories on at least 7 different days, all older than a week" };
}
function dropSubsumed(rows, max) {
  const chosen = [];
  for (const r of rows) {
    if (chosen.some((c) => c.term.includes(r.term) && c.term !== r.term && r.recent <= c.recent * 1.3)) continue;
    chosen.push(r); if (chosen.length >= max) break;
  }
  return chosen;
}
// Terms used much more than usual. Only meaningful once baselineStats().ready.
function computeEmerging(items, now, opts = {}) {
  const minRecent = opts.minRecent || 5, minSources = opts.minSources || 3;
  const rows = [];
  for (const [term, e] of collect(items, now)) {
    if (e.recent.size < minRecent || e.src.size < minSources) continue;
    const ratio = (e.recent.size / 7 + 0.05) / (e.base.size / 21 + 0.05);
    if (ratio < 1.8) continue;
    rows.push({ ...describe(term, e), ratio: Math.round(ratio * 10) / 10, score: ratio * Math.log(1 + e.recent.size) * Math.log(1 + e.src.size) });
  }
  rows.sort((a, b) => b.score - a.score);
  const out = dropSubsumed(rows, opts.max || 24); out.forEach((r) => delete r.score); return out;
}
// Fallback while history is short: the two-word phrases mentioned most this week (not yet "emerging").
function mostDiscussed(items, now, opts = {}) {
  const rows = [];
  for (const [term, e] of collect(items, now)) {
    if (!term.includes(" ") || e.recent.size < (opts.minRecent || 5) || e.src.size < 3) continue;
    rows.push({ ...describe(term, e), score: e.recent.size * Math.log(1 + e.src.size) });
  }
  rows.sort((a, b) => b.score - a.score);
  const out = dropSubsumed(rows, opts.max || 12); out.forEach((r) => delete r.score); return out;
}

function dataCoverage(items, now) {
  const perDay = new Map();
  for (const it of items) { const ts = Date.parse(it.p); if (ts >= now - 28 * DAY && ts <= now + DAY) perDay.set(dayStr(ts), (perDay.get(dayStr(ts)) || 0) + 1); }
  const days = [...perDay.values()].filter((n) => n >= 10).length;
  return { days_with_data: days, provisional: days < 14 };
}

// ---------- momentum of topics (the coarse labels the news page already uses)
function computeMomentum(items, now) {
  const out = {};
  for (const cat of ["research", "tech", "business"]) {
    const rec = {}, base = {};
    for (const it of items) {
      if (it.c !== cat) continue; const ts = Date.parse(it.p);
      const bucket = ts >= now - 7 * DAY ? rec : ts >= now - 28 * DAY ? base : null; if (!bucket) continue;
      for (const t of it.t || []) bucket[t] = (bucket[t] || 0) + 1;
    }
    const rows = Object.keys({ ...rec, ...base }).map((t) => {
      const b7 = (base[t] || 0) / 3, r = rec[t] || 0;
      return { topic: t, recent: r, base_per_week: Math.round(b7 * 10) / 10, change: Math.round(((r - b7) / Math.max(b7, 3)) * 100) };
    }).filter((x) => x.recent + x.base_per_week >= 6);
    out[cat] = { rising: rows.filter((x) => x.change > 15).sort((a, b) => b.change - a.change).slice(0, 5), falling: rows.filter((x) => x.change < -15).sort((a, b) => a.change - b.change).slice(0, 5) };
  }
  return out;
}

// ---------- mood series from archived business items
function computeMood(items, now, days = 30) {
  const labels = Array.from({ length: days }, (_, k) => dayStr(now - (days - 1 - k) * DAY));
  const sum = new Array(days).fill(0), cnt = new Array(days).fill(0);
  for (const it of items) {
    if (it.c !== "business" || it.m == null) continue;
    const k = labels.indexOf(dayStr(Date.parse(it.p))); if (k >= 0) { sum[k] += it.m; cnt[k]++; }
  }
  const series = sum.map((s, k) => (cnt[k] >= 3 ? Math.round((s / cnt[k]) * 100) / 100 : null));
  const recent = items.filter((i) => i.c === "business" && i.m != null && Date.parse(i.p) >= now - 7 * DAY);
  const avg = recent.length >= 5 ? Math.round((recent.reduce((a, i) => a + i.m, 0) / recent.length) * 100) / 100 : null;
  return { days: labels, series, last7_average: avg, last7_scored: recent.length, lexicon: MOOD };
}

// ---------- stories several outlets cover
function clusterStories(items) {
  const sets = items.map((i) => new Set(tokens(i.title).filter((t) => t.low.length >= 4 && !STOP.has(t.low) && !GENERIC.has(t.low)).map((t) => t.low)));
  const parent = items.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
    if (items[a].sourceId === items[b].sourceId) continue;
    const A = sets[a], B = sets[b]; if (A.size < 3 || B.size < 3) continue;
    let inter = 0; for (const x of A) if (B.has(x)) inter++;
    if (inter >= 3 && inter / (A.size + B.size - inter) >= 0.5) parent[find(a)] = find(b);
  }
  const groups = new Map();
  items.forEach((it, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)).push(it); });
  return [...groups.values()].filter((g) => new Set(g.map((x) => x.sourceId)).size >= 2)
    .map((g) => g.sort((a, b) => (a.published < b.published ? 1 : -1)))
    .sort((a, b) => new Set(b.map((x) => x.sourceId)).size - new Set(a.map((x) => x.sourceId)).size || (a[0].published < b[0].published ? 1 : -1)).slice(0, 10);
}

// ---------- forecast ledger
const MODEL = "poisson-persistence-v1";
function poissonTailGE(k, lambda) {
  if (k <= 0) return 1;
  let term = Math.exp(-lambda), cdf = term;
  for (let i = 1; i < k; i++) { term *= lambda / i; cdf += term; }
  return Math.min(1, Math.max(0, 1 - cdf));
}
// One question per strongest emerging term, at most once a week. The probability comes from a stated model, never edited later.
function makeForecasts(candidates, existing, now, basis = "emerging", count = 6) {
  const madeDay = dayStr(now);
  if (existing.some((f) => now - Date.parse(f.made) < 7 * DAY)) return [];
  return candidates.filter((e) => e.recent >= 5).slice(0, count).map((e) => {
    const k = Math.max(3, Math.round(0.75 * e.recent));
    const lambda = 0.85 * e.recent + 0.15 * e.base_per_week;
    const p = Math.round(Math.min(0.98, Math.max(0.02, poissonTailGE(k, lambda))) * 100) / 100;
    return {
      id: `f-${madeDay}-${e.term.replace(/[^a-z0-9]+/g, "-")}`, made: madeDay, resolves: dayStr(now + 7 * DAY), kind: "term-persistence", term: e.term,
      question: `Will "${e.term}" appear in at least ${k} stories during the next 7 days?`, threshold: k, p, model: MODEL, basis,
      inputs: { recent_7d: e.recent, base_per_week: e.base_per_week, lambda: Math.round(lambda * 10) / 10 }, outcome: null, observed: null, brier: null, log_score: null,
    };
  });
}
// Fill in outcomes for forecasts whose window is over. Only the result fields are ever written.
function resolveForecasts(forecasts, items, now) {
  for (const f of forecasts) {
    if (f.outcome !== null || f.void) continue;
    const start = Date.parse(f.made) + DAY, end = Date.parse(f.resolves) + DAY; // days made+1 .. resolves
    if (now < end + DAY) continue;
    const inWindow = items.filter((i) => { const t = Date.parse(i.p); return t >= start && t < end; });
    if (inWindow.length < 50) { f.void = "too little data was collected in the window"; continue; }
    f.observed = new Set(inWindow.filter((i) => (i.w || []).includes(f.term)).map((i) => i.id)).size;
    f.outcome = f.observed >= f.threshold ? 1 : 0;
    f.brier = Math.round((f.p - f.outcome) ** 2 * 1000) / 1000;
    f.log_score = Math.round(-Math.log(f.outcome ? f.p : 1 - f.p) * 1000) / 1000;
  }
  return forecasts;
}
function scoreboard(forecasts) {
  const done = forecasts.filter((f) => f.outcome !== null && !f.void), n = done.length;
  const mean = (k) => (n ? Math.round((done.reduce((a, f) => a + f[k], 0) / n) * 1000) / 1000 : null);
  const bs = mean("brier");
  const bins = [[0, 0.34], [0.34, 0.67], [0.67, 1.01]].map(([lo, hi]) => {
    const g = done.filter((f) => f.p >= lo && f.p < hi);
    return { range: `${Math.round(lo * 100)}-${Math.min(100, Math.round(hi * 100))}%`, n: g.length, mean_p: g.length ? Math.round((g.reduce((a, f) => a + f.p, 0) / g.length) * 100) / 100 : null, observed: g.length ? Math.round((g.reduce((a, f) => a + f.outcome, 0) / g.length) * 100) / 100 : null };
  });
  return { model: MODEL, open: forecasts.filter((f) => f.outcome === null && !f.void).length, resolved: n, voided: forecasts.filter((f) => f.void).length,
    mean_brier: bs, benchmark_brier: 0.25, skill: bs == null ? null : Math.round((1 - bs / 0.25) * 100) / 100, mean_log_score: mean("log_score"), calibration: bins };
}

module.exports = { STOP, GENERIC, MOOD, extractTerms, pickTerms, moodScore, computeEmerging, mostDiscussed, baselineStats, computeMomentum, computeMood, dataCoverage, clusterStories, makeForecasts, resolveForecasts, scoreboard, poissonTailGE, MODEL, dayStr };
