// Forecast questions about the economy, jobs and new research, built from public data series.
// Pure functions (no network, no files) so they can be tested alone; build-news.js fetches the data and calls these.
// Everything here describes data. Nothing is advice.
"use strict";

const DAY = 864e5;
const MODEL = "indicator-v1";

// ---------- what we ask about
// q: "higher" | "lower" (compared with the latest value) | "above_avg" (compared with the average of the last `win` values)
// freq: monthly | weekly | daily (daily series are read once a week) ; h: steps ahead ; res: smallest reported step ; k: months/weeks used for the trend
const SPECS = [
  { id: "us-unemployment", domain: "jobs", title: "US unemployment rate", unit: "%", dec: 1, res: 0.1, freq: "monthly", q: "higher", h: 1, k: 6, method: "normal",
    source: { kind: "fred", series: "UNRATE", name: "US Bureau of Labor Statistics, via FRED", url: "https://fred.stlouisfed.org/series/UNRATE" },
    why: "The share of people in the US labour force who are out of work and looking for a job, from the monthly household survey of the Bureau of Labor Statistics. It is one of the most watched summaries of the job market.", lag: "usually published in the first week of the following month" },
  { id: "us-jobless-claims", domain: "jobs", title: "US weekly jobless claims", unit: "", dec: 0, rnd: 1000, res: 0, freq: "weekly", q: "above_avg", win: 4, h: 2, k: 4, method: "normal",
    source: { kind: "fred", series: "ICSA", name: "US Department of Labor, via FRED", url: "https://fred.stlouisfed.org/series/ICSA" },
    why: "The number of people who filed a first claim for unemployment benefits in a week. It is published every Thursday and moves quickly, so it is an early sign of layoffs.", lag: "published on the Thursday after the week ends" },
  { id: "us-payrolls", domain: "jobs", title: "US monthly job gains", unit: "thousand jobs", dec: 0, rnd: 5, res: 0, freq: "monthly", transform: "diff", q: "above_avg", win: 6, h: 1, k: 6, method: "normal",
    source: { kind: "fred", series: "PAYEMS", name: "US Bureau of Labor Statistics, via FRED", url: "https://fred.stlouisfed.org/series/PAYEMS" },
    why: "The change in the number of non-farm jobs in the US from one month to the next, the “jobs added” figure in the headlines. Early figures are revised later, and this question uses the first value that appears.", lag: "usually published on the first Friday of the following month" },
  { id: "indeed-software", domain: "jobs", title: "Indeed software development job postings", unit: "index, 1 Feb 2020 = 100", dec: 1, res: 0.1, freq: "daily", q: "higher", h: 1, k: 6, method: "normal",
    source: { kind: "fred", series: "IHLIDXUSTPSOFTDEVE", name: "Indeed Hiring Lab, via FRED", url: "https://fred.stlouisfed.org/series/IHLIDXUSTPSOFTDEVE" },
    why: "Postings for software development jobs on Indeed in the US, relative to 1 February 2020 (set to 100). A measure of how much employers are hiring in the field.", lag: "updated daily with a short delay" },
  { id: "dk-unemployment", domain: "jobs", title: "Denmark unemployment rate", unit: "%", dec: 1, res: 0.1, freq: "monthly", q: "higher", h: 1, k: 6, method: "normal",
    source: { kind: "eurostat", geo: "DK", name: "Eurostat (seasonally adjusted)", url: "https://ec.europa.eu/eurostat/databrowser/view/une_rt_m/default/table?lang=en" },
    why: "The share of Denmark's labour force without work, seasonally adjusted and harmonised across countries by Eurostat.", lag: "published about six weeks after the month ends" },
  { id: "us-inflation", domain: "economy", title: "US inflation (year on year)", unit: "%", dec: 1, res: 0.1, freq: "monthly", transform: "yoy", q: "higher", h: 1, k: 6, method: "normal",
    source: { kind: "fred", series: "CPIAUCSL", name: "US Bureau of Labor Statistics, via FRED", url: "https://fred.stlouisfed.org/series/CPIAUCSL" },
    why: "The change in US consumer prices compared with the same month a year earlier, the standard measure of inflation.", lag: "usually published in the middle of the following month" },
  { id: "us-fed-funds", domain: "economy", title: "US effective federal funds rate", unit: "%", dec: 2, res: 0.05, freq: "monthly", q: "lower", h: 1, k: 6, method: "frequency", fwin: 12,
    source: { kind: "fred", series: "FEDFUNDS", name: "Board of Governors of the Federal Reserve, via FRED", url: "https://fred.stlouisfed.org/series/FEDFUNDS" },
    why: "The interest rate banks charge each other overnight, the rate the Federal Reserve steers. It sets the base for borrowing costs across the economy. It moves in steps at policy meetings, so most months it hardly changes.", lag: "the monthly average is published at the start of the following month" },
  { id: "us-10y-yield", domain: "economy", title: "US 10-year Treasury yield", verb: "close", unit: "%", dec: 2, res: 0.01, freq: "daily", q: "higher", h: 1, k: 6, method: "normal",
    source: { kind: "fred", series: "DGS10", name: "Board of Governors of the Federal Reserve, via FRED", url: "https://fred.stlouisfed.org/series/DGS10" },
    why: "The yield on 10-year US government bonds, a benchmark for mortgage and company borrowing rates. Short-term moves are close to a coin flip, so these questions mostly teach how little can be predicted.", lag: "daily close" },
  { id: "us-stocks", domain: "economy", title: "S&P 500 stock index", verb: "close", unit: "points", dec: 2, res: 0.01, freq: "daily", q: "higher", h: 1, k: 6, method: "normal",
    source: { kind: "fred", series: "SP500", name: "S&P Dow Jones Indices, via FRED", url: "https://fred.stlouisfed.org/series/SP500" },
    why: "An index of 500 large US companies, the usual shorthand for the stock market. These questions teach base rates: the index rises in more weeks than it falls, yet any single week is close to a coin flip.", lag: "daily close" },
  { id: "arxiv-underwater", domain: "research", title: "arXiv papers on underwater acoustics and sonar", unit: "papers", dec: 0, rnd: 1, res: 0, freq: "weekly", q: "above_avg", win: 8, h: 2, min: 52, minErr: 12, k: 4, method: "normal",
    source: { kind: "arxiv", query: '(abs:"underwater acoustic" OR abs:sonar OR abs:hydrophone OR abs:"underwater localization")', name: "arXiv, by submission date", url: "https://arxiv.org/" },
    why: "Papers submitted to arXiv in a week whose abstracts mention underwater acoustics, sonar or hydrophones. It shows how much researchers are publishing on the topic, not how good the work is." },
  { id: "arxiv-llm", domain: "research", title: "arXiv papers on language models", unit: "papers", dec: 0, rnd: 10, res: 0, freq: "weekly", q: "above_avg", win: 8, h: 2, min: 52, minErr: 12, k: 4, method: "normal",
    source: { kind: "arxiv", query: 'abs:"language model"', name: "arXiv, by submission date", url: "https://arxiv.org/" },
    why: "Papers submitted to arXiv in a week whose abstracts mention language models. A measure of research activity in the area that dominates AI news, not of quality." },
  { id: "arxiv-world-models", domain: "research", title: "arXiv papers on world models", unit: "papers", dec: 0, rnd: 1, res: 0, freq: "weekly", q: "above_avg", win: 8, h: 2, min: 52, minErr: 12, k: 4, method: "normal",
    source: { kind: "arxiv", query: '(abs:"world model" OR abs:"world models")', name: "arXiv, by submission date", url: "https://arxiv.org/" },
    why: "Papers submitted to arXiv in a week whose abstracts mention world models, models that learn how an environment changes in response to actions. A gauge of how fast the idea is spreading in research." },
  { id: "arxiv-sound-localization", domain: "research", title: "arXiv papers on sound source localization", unit: "papers", dec: 0, rnd: 1, res: 0, freq: "weekly", q: "above_avg", win: 8, h: 2, min: 52, minErr: 12, k: 4, method: "normal",
    source: { kind: "arxiv", query: '(abs:"sound source localization" OR abs:"acoustic localization" OR abs:"direction of arrival")', name: "arXiv, by submission date", url: "https://arxiv.org/" },
    why: "Papers submitted to arXiv in a week about locating sound sources or estimating direction of arrival, the field behind robot hearing and passive sonar." },
];

// ---------- parsing
function parseFredCsv(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/).slice(1)) {
    const [d, v] = line.split(","); if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) continue;
    const x = Number(v); if (v === "" || v === "." || !Number.isFinite(x)) continue;
    out.push({ d, v: x });
  }
  return out.sort((a, b) => (a.d < b.d ? -1 : 1));
}
function parseEurostat(json) {
  const idx = json && json.dimension && json.dimension.time && json.dimension.time.category && json.dimension.time.category.index, vals = (json && json.value) || {};
  if (!idx) return [];
  return Object.keys(idx).map((t) => ({ d: t + "-01", v: vals[idx[t]] })).filter((x) => Number.isFinite(x.v)).sort((a, b) => (a.d < b.d ? -1 : 1));
}

// ---------- dates and series shaping
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => iso(Date.parse(d + "T00:00:00Z") + n * DAY);
function addMonths(d, n) { const t = new Date(d + "T00:00:00Z"); t.setUTCMonth(t.getUTCMonth() + n); return iso(t); }
const mondayOf = (d) => { const t = new Date(d + "T00:00:00Z"), k = (t.getUTCDay() + 6) % 7; return iso(t.getTime() - k * DAY); };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (d) => MONTHS[Number(d.slice(5, 7)) - 1] + " " + d.slice(0, 4);
const longDate = (d) => Number(d.slice(8, 10)) + " " + MONTHS[Number(d.slice(5, 7)) - 1] + " " + d.slice(0, 4);
const round = (x, dec) => { const f = Math.pow(10, dec); return Math.round(x * f) / f; };
const rnd = (x, unit) => Math.round(x / unit) * unit;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const robustSd = (a) => { if (a.length < 5) return 0; const m = median(a), mad = median(a.map((x) => Math.abs(x - m))); return 1.4826 * mad; };
const std = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
// standard normal cdf (Abramowitz and Stegun 7.1.26)
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }

function toWeekly(hist) { // one point a week, counted back from the newest observation
  if (!hist.length) return [];
  const out = []; let j = hist.length - 1;
  for (let d = hist[j].d; j >= 0; d = addDays(d, -7)) {
    while (j >= 0 && hist[j].d > d) j--;
    if (j < 0 || Date.parse(d) - Date.parse(hist[j].d) > 5 * DAY) { if (j < 0) break; continue; }
    out.push({ d, v: hist[j].v });
  }
  return out.reverse();
}
function yoy(hist) { const by = new Map(hist.map((x) => [x.d, x.v])), out = []; for (const x of hist) { const p = by.get(addMonths(x.d, -12)); if (p != null) out.push({ d: x.d, v: (x.v / p - 1) * 100 }); } return out; }
function diffs(hist) { const by = new Map(hist.map((x) => [x.d, x.v])), out = []; for (const x of hist) { const p = by.get(addMonths(x.d, -1)); if (p != null) out.push({ d: x.d, v: x.v - p }); } return out; }
// The series a question is asked about: transformed, and read once a week for daily data
function shape(spec, raw) {
  let s = raw;
  if (spec.freq === "daily") s = toWeekly(s);
  if (spec.transform === "yoy") s = yoy(s);
  if (spec.transform === "diff") s = diffs(s);
  return s;
}
const stepDays = (spec) => (spec.freq === "monthly" ? 0 : spec.freq === "weekly" ? 7 : 7);
function targetDate(spec, lastD) {
  if (spec.freq === "monthly") return addMonths(lastD, spec.h);
  return addDays(lastD, 7 * spec.h);
}
// The value a question will be settled on. Daily data: the last value on or before the date, not older than four days.
function valueAt(spec, raw, target) {
  if (spec.freq === "daily") {
    let best = null; for (const x of raw) { if (x.d <= target) best = x; else break; }
    return best && Date.parse(target) - Date.parse(best.d) <= 4 * DAY ? best.v : null;
  }
  const s = spec.transform === "yoy" ? yoy(raw) : spec.transform === "diff" ? diffs(raw) : raw;
  const hit = s.find((x) => x.d === target); return hit ? hit.v : null;
}

// ---------- the forecasting method and its test on history
// Returns the probability the event happens when asked at position i of the shaped series x, and the facts behind it.
function ask(spec, x, i, errs) {
  const last = x[i].v, h = spec.h;
  if (spec.method === "frequency") {
    const from = Math.max(0, i - h - (spec.fwin || 60)), outcomes = [];
    for (let m = from; m + h <= i; m++) outcomes.push(spec.q === "lower" ? x[m + h].v < x[m].v - spec.res / 2 : x[m + h].v > x[m].v + spec.res / 2);
    if (outcomes.length < 12) return null;
    const hits = outcomes.filter(Boolean).length;
    return { p: (hits + 1) / (outcomes.length + 2), threshold: last, mean: last, sd: null, n: outcomes.length, hits };
  }
  let mu, threshold;
  if (spec.q === "above_avg") {
    const w = spec.win, avg = mean(x.slice(i - w + 1, i + 1).map((y) => y.v)); threshold = rnd(avg, spec.rnd || 1);
    let ew = x[Math.max(0, i - 2 * w)].v; for (let m = Math.max(0, i - 2 * w) + 1; m <= i; m++) ew = 0.4 * x[m].v + 0.6 * ew; mu = ew;
  } else {
    const k = spec.k, drift = (x[i].v - x[i - k].v) / k; threshold = last; mu = last + 0.5 * drift * h;
  }
  if (errs.length < (spec.minErr || 20)) return null;
  const sd = Math.max(robustSd(errs.slice(-120)), spec.res / 4, 1e-9);
  let p;
  if (spec.q === "higher") p = 1 - normCdf((threshold + spec.res / 2 - mu) / sd);
  else if (spec.q === "lower") p = normCdf((threshold - spec.res / 2 - mu) / sd);
  else p = 1 - normCdf((threshold + (spec.res || 0) / 2 - mu) / sd);
  return { p, threshold, mean: mu, sd, n: errs.length };
}
function eventHappened(spec, threshold, v) {
  const r = (y) => round(y, spec.dec);
  return spec.q === "lower" ? r(v) < r(threshold) : r(v) > (spec.q === "above_avg" ? threshold : r(threshold));
}
// Walk through history: at every earlier point, ask the same question and see what happened.
function backtest(spec, x) {
  const h = spec.h, minStart = (spec.q === "above_avg" ? 2 * spec.win : spec.k) + 1, errs = [], results = [];
  for (let i = minStart; i + h < x.length; i++) {
    // errors that were already known at i: forecasts made at m <= i - h
    const known = errsUpTo(spec, x, i - h, minStart);
    const a = ask(spec, x, i, known); if (!a) continue;
    results.push({ i, p: a.p, o: eventHappened(spec, a.threshold, x[i + h].v) ? 1 : 0 });
  }
  void errs;
  return results;
}
const errCache = new WeakMap();
function errsUpTo(spec, x, lastOrigin, minStart) {
  let c = errCache.get(x); if (!c) { c = {}; errCache.set(x, c); }
  const key = spec.id + ":" + spec.h; if (!c[key]) {
    const list = []; for (let m = minStart; m + spec.h < x.length; m++) {
      let mu;
      if (spec.q === "above_avg") { const w = spec.win; let ew = x[Math.max(0, m - 2 * w)].v; for (let q = Math.max(0, m - 2 * w) + 1; q <= m; q++) ew = 0.4 * x[q].v + 0.6 * ew; mu = ew; }
      else { const drift = (x[m].v - x[m - spec.k].v) / spec.k; mu = x[m].v + 0.5 * drift * spec.h; }
      list.push({ m, e: x[m + spec.h].v - mu });
    }
    c[key] = list;
  }
  return c[key].filter((r) => r.m <= lastOrigin).map((r) => r.e);
}
function scoreBacktest(results) {
  const n = results.length; if (n < 30) return { n, ok: false };
  const base = (results.filter((r) => r.o).length + 1) / (n + 2);
  const bm = mean(results.map((r) => (r.p - r.o) ** 2)), bb = mean(results.map((r) => (base - r.o) ** 2));
  const skill = 1 - bm / bb, hitRate = mean(results.map((r) => ((r.p >= 0.5 ? 1 : 0) === r.o ? 1 : 0)));
  return { n, ok: true, base: round(base, 3), brier_model: round(bm, 3), brier_base: round(bb, 3), skill: round(skill, 3), hit_rate: round(hitRate, 3) };
}

// ---------- making a question
// raw: observations of the source series (FRED/Eurostat) or weekly counts for arXiv. Returns a question record, or null.
function planQuestion(baseSpec, raw, now) {
  let spec = baseSpec;
  const x = shape(spec, raw); if (x.length < (spec.min || 60)) return null;
  // Weekly and daily data: always ask about a date after today, even when the newest figure is a week or two old
  if (spec.freq !== "monthly" && x.length) { let h = spec.h; while (Date.parse(addDays(x[x.length - 1].d, 7 * h)) <= now) h++; spec = { ...spec, h }; }
  const i = x.length - 1, errs = errsUpTo(spec, x, i - spec.h + 0, spec.q === "above_avg" ? 2 * spec.win + 1 : spec.k + 1);
  const a = ask(spec, x, i, errs); if (!a) return null;
  const bt = scoreBacktest(backtest(spec, x));
  if (!bt.ok) return null;
  const base = bt.base, skill = bt.skill, w = Math.max(0, Math.min(1, skill / 0.15));
  const p = Math.max(0.03, Math.min(0.97, round(base + w * (a.p - base), 2)));
  const last = x[i], target = targetDate(spec, last.d);
  const tail = x.slice(-36).map((y) => ({ d: y.d, v: round(y.v, spec.dec + 1) }));
  const thr = spec.q === "above_avg" ? a.threshold : last.v;
  const fmt = (v) => (spec.unit === "%" ? round(v, spec.dec) + "%" : spec.unit === "points" ? round(v, spec.dec).toLocaleString("en-US") : round(v, spec.dec).toLocaleString("en-US"));
  const when = spec.freq === "monthly" ? monthName(target) : "the week of " + longDate(target);
  let question;
  if (spec.id === "us-jobless-claims") question = `Will US initial jobless claims for the week ending ${longDate(target)} be above ${fmt(thr)}, the average of the last 4 weeks?`;
  else if (spec.id === "us-payrolls") question = `Will US employers add more than ${fmt(thr)} thousand jobs in ${monthName(target)}, the average of the last 6 months?`;
  else if (spec.domain === "research") question = `Will arXiv receive more than ${fmt(thr)} papers on ${spec.title.replace("arXiv papers on ", "")} in the week starting ${longDate(target)}, the average of the last 8 weeks?`;
  else if (spec.freq === "daily") question = `Will the ${spec.title} ${spec.verb || "be"} ${spec.q === "lower" ? "lower" : "higher"} on ${longDate(target)} than on ${longDate(last.d)} (${fmt(last.v)})?`;
  else question = `Will the ${spec.title}${/inflation/.test(spec.title) ? "" : ""} for ${monthName(target)} be ${spec.q === "lower" ? "lower" : "higher"} than ${fmt(last.v)}?`;
  if (spec.freq === "monthly" && spec.q !== "above_avg") question = question.replace(/ for [A-Z][a-z]+ \d{4} /, ` for ${monthName(target)} `);
  const release = spec.freq === "monthly" ? addDays(addMonths(target, 1), 10) : addDays(target, spec.freq === "weekly" && spec.domain === "research" ? 8 : 6);
  return {
    id: `f-${iso(now)}-${spec.id}`, made: iso(now), resolves: release, kind: "indicator", indicator: spec.id, domain: spec.domain, label: spec.title, term: spec.id,
    h_steps: spec.h, target_date: target, threshold: spec.q === "above_avg" ? a.threshold : last.v, direction: spec.q, p, model: MODEL, basis: "indicator", question,
    context: {
      measure: { why: spec.why, unit: spec.unit, source: spec.source, lag: spec.lag || null, freq: spec.freq },
      latest: { date: last.d, value: round(last.v, spec.dec + 1) }, history: tail,
      trend: trendNote(spec, x),
      reasoning: { method: spec.method, q: spec.q, k: spec.k, win: spec.win || null, h: spec.h, window_n: a.n || null, window_hits: a.hits == null ? null : a.hits, model_p: round(a.p, 2), expected: a.mean == null ? null : round(a.mean, spec.dec + 1), sd: a.sd == null ? null : round(a.sd, spec.dec + 1), threshold: a.threshold,
        backtest: bt, weight: round(w, 2), base_rate: base, final_p: p },
      resolution: resolutionText(spec, target, when),
    },
    inputs: {}, outcome: null, observed: null, brier: null, log_score: null,
  };
}
function trendNote(spec, x) {
  const n = spec.freq === "monthly" ? 6 : 8, a = x[x.length - 1], b = x[Math.max(0, x.length - 1 - n)], unit = spec.freq === "monthly" ? "months" : "weeks";
  const hi = Math.max(...x.slice(-52).map((y) => y.v)), lo = Math.min(...x.slice(-52).map((y) => y.v));
  return { change: round(a.v - b.v, spec.dec + 1), over: n + " " + unit, high_52: round(hi, spec.dec + 1), low_52: round(lo, spec.dec + 1) };
}
function resolutionText(spec, target, when) {
  const src = spec.source.name;
  if (spec.freq === "daily") return `Uses the last value on or before ${longDate(target)} (not older than four days) from ${src}. Yes if it is ${spec.q === "lower" ? "below" : "above"} the starting value.`;
  if (spec.domain === "research") return `Counts papers submitted to arXiv from ${target} to ${addDays(target, 6)} (UTC) whose abstract matches the search. Yes if the count is above the average of the last 8 weeks. Papers cross-listed or withdrawn later are not recounted.`;
  if (spec.freq === "weekly") return `Uses the value for the week ending ${longDate(target)} as first shown by ${src}. Yes if it is above the 4-week average. Figures can be revised afterwards, and the first value shown is the one used.`;
  return `Uses the value for ${when} as first shown by ${src}. Yes if it ${spec.q === "lower" ? "is lower than" : spec.q === "above_avg" ? "is above" : "is higher than"} the starting figure after rounding to the reported precision. A tie is a no. Figures can be revised afterwards, and the first value shown is the one used.`;
}

// ---------- settle questions whose data has arrived
// getRaw(spec) -> raw observations (or null if the data could not be fetched this time)
function resolveIndicators(forecasts, getRaw, now) {
  for (const f of forecasts) {
    if (f.kind !== "indicator" || f.outcome !== null || f.void) continue;
    const spec = SPECS.find((s) => s.id === f.indicator); if (!spec) continue;
    const raw = getRaw(spec); if (!raw) continue;
    if (spec.domain === "research") { if (now < Date.parse(addDays(f.target_date, 7)) + DAY) continue; }
    const v = spec.domain === "research" ? (raw.find((r) => r.d === f.target_date) || {}).v : valueAt(spec, raw, f.target_date);
    if (v == null) { if (now > Date.parse(f.resolves) + 75 * DAY) f.void = "the data never appeared"; continue; }
    if (spec.freq === "daily" && now < Date.parse(f.target_date) + DAY) continue;
    const start = f.context.latest.value;
    f.observed = round(v, spec.dec + 1);
    f.outcome = eventHappened(spec, f.threshold, v) ? 1 : 0;
    f.brier = round((f.p - f.outcome) ** 2, 3); f.log_score = round(-Math.log(f.outcome ? f.p : 1 - f.p), 3);
    const delta = round(v - (spec.q === "above_avg" ? f.threshold : start), spec.dec + 1), sign = delta > 0 ? "+" : "";
    f.result_note = spec.q === "above_avg" ? `The value was ${f.observed.toLocaleString("en-US")} against a bar of ${f.threshold.toLocaleString("en-US")} (${sign}${delta.toLocaleString("en-US")}).` : `The value was ${f.observed.toLocaleString("en-US")}, against ${start.toLocaleString("en-US")} at the start (${sign}${delta.toLocaleString("en-US")}).`;
  }
  return forecasts;
}

// Which indicators need a new question: none open, and no earlier question for the same target date
function dueSpecs(forecasts) {
  return SPECS.filter((spec) => !forecasts.some((f) => f.kind === "indicator" && f.indicator === spec.id && f.outcome === null && !f.void));
}
function makeIndicatorForecasts(forecasts, getRaw, now) {
  const out = [];
  for (const spec of dueSpecs(forecasts)) {
    const raw = getRaw(spec); if (!raw || raw.length < (spec.min || 60)) continue;
    const q = planQuestion(spec, raw, now); if (!q) continue;
    if (forecasts.some((f) => f.kind === "indicator" && f.indicator === spec.id && f.target_date === q.target_date)) continue;
    out.push(q);
  }
  return out;
}

module.exports = { SPECS, MODEL, parseFredCsv, parseEurostat, shape, toWeekly, yoy, diffs, targetDate, valueAt, ask, backtest, scoreBacktest, planQuestion, resolveIndicators, makeIndicatorForecasts, dueSpecs, normCdf, addMonths, addDays, mondayOf, monthName, longDate, eventHappened };
