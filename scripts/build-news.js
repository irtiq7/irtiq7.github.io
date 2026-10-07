// Builds the data behind ai_news.html:
//   news/latest.json          current items (summary, key terms, topics, reading time, outlet lean)
//   news/archive/YYYY-MM-DD.json   slim daily copy, used for trends (kept for 60 days)
//   news/trends.json          topic counts per published day, last 30 days
// Source list, topic keywords and outlet lean ratings live in news/sources.json.
// Run by a scheduled workflow, or locally: cd scripts && npm ci && node build-news.js
// Only a short extract is stored per article, never the full text; every item links to its source.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { XMLParser } = require("fast-xml-parser");
const { JSDOM, VirtualConsole } = require("jsdom");
const { Readability } = require("@mozilla/readability");

const ROOT = path.join(__dirname, "..");
const NEWS = process.env.NEWS_DIR || path.join(ROOT, "news");
const NOW = process.env.NEWS_NOW ? Date.parse(process.env.NEWS_NOW) : Date.now(); // overridable for tests
const signals = require("./signals");
const UA = "Mozilla/5.0 (compatible; irtiq7-news-builder; +https://irtiq7.github.io/ai_news.html)";
const DEFAULT_LIMIT = 20;          // items kept per source
const ARTICLE_FETCHES_PER_SOURCE = 20;
const ARCHIVE_DAYS = 60;
const TREND_DAYS = 30;
const SUMMARY_MAX = 420;

const sourcesFile = JSON.parse(fs.readFileSync(path.join(NEWS, "sources.json"), "utf8"));

// ---------- small helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);
const day = (d) => new Date(d).toISOString().slice(0, 10);
const STOP = new Set(("a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just like me more most my new no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up us very was we were what when where which while who whom why will with would you your says say said one two three year years first last may might much many get gets got make makes made use used using via per than still back even")
  .split(" "));

async function fetchText(url, ms = 15000, retried = false) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml,application/rss+xml,text/xml;q=0.9,*/*;q=0.8" } });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return await r.text();
  } catch (e) {
    if (!retried && (e.status === 429 || e.status === 503)) { clearTimeout(t); await sleep(4000); return fetchText(url, ms, true); }
    throw e;
  } finally { clearTimeout(t); }
}

// ---------- robots.txt (articles are only fetched where allowed)
const robotsCache = new Map();
async function allowedByRobots(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    robotsCache.set(u.origin, fetchText(u.origin + "/robots.txt", 8000).then(parseRobots).catch(() => []));
  }
  const rules = await robotsCache.get(u.origin);
  let best = { len: -1, allow: true };
  for (const r of rules) {
    if (!r.path) continue;
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(u.pathname + u.search) && r.path.length > best.len) best = { len: r.path.length, allow: r.allow };
  }
  return best.allow;
}
function parseRobots(txt) {
  const rules = []; let agents = [], inRules = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { if (inRules) { agents = []; inRules = false; } agents.push(v.toLowerCase()); }
    else if (k === "allow" || k === "disallow") {
      inRules = true;
      if (agents.includes("*")) rules.push({ allow: k === "allow", path: v });
    }
  }
  return rules;
}

// ---------- feed parsing
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", processEntities: false, trimValues: true });
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const txt = (x) => (x == null ? "" : typeof x === "object" ? (x["#text"] ?? "") + "" : x + "");

function decodeEntities(s) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", eacute: "é", egrave: "è", ecirc: "ê", aacute: "á", agrave: "à", acirc: "â", auml: "ä", ouml: "ö", uuml: "ü", oacute: "ó", iacute: "í", uacute: "ú", ntilde: "ñ", ccedil: "ç", Eacute: "É", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", deg: "°", times: "×", middot: "·", bull: "•", laquo: "«", raquo: "»", rarr: "→", larr: "←" };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
    return named[e.toLowerCase()] ?? m;
  });
}
function stripHtml(html) {
  const once = (h) => String(h || "")
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|blockquote)>/gi, "\n")
    .replace(/<\/?(a|b|i|em|strong|span|small|sup|sub|code|u|mark|abbr|cite)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ");
  // Some feeds entity-escape their HTML, so decode once, strip tags, decode again.
  return decodeEntities(once(decodeEntities(String(html || ""))))
    .replace(/[ \t\u00a0]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}
function firstImg(html) {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(String(html || ""));
  return m ? m[1] : "";
}
function parseFeed(xml) {
  const doc = parser.parse(xml);
  let raw = [];
  if (doc.rss) raw = arr(doc.rss.channel?.item);
  else if (doc.feed) raw = arr(doc.feed.entry);
  else if (doc["rdf:RDF"]) raw = arr(doc["rdf:RDF"].item);
  return raw.map((it) => {
    let link = "";
    if (typeof it.link === "string") link = it.link;
    else if (it.link) {
      const ls = arr(it.link);
      const alt = ls.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") || ls[0];
      link = alt?.["@_href"] || txt(alt);
    }
    link = decodeEntities(link);
    const html = txt(it["content:encoded"]) || txt(it.content) || txt(it.description) || txt(it.summary) || "";
    let image = it["media:thumbnail"]?.["@_url"] || arr(it["media:content"]).map((m) => m?.["@_url"]).find(Boolean) || "";
    const enc = arr(it.enclosure).find((e) => /image/.test(e?.["@_type"] || ""));
    image = image || enc?.["@_url"] || firstImg(html);
    return {
      title: stripHtml(txt(it.title)).replace(/\s+/g, " "),
      url: link.trim(),
      date: txt(it.pubDate) || txt(it.published) || txt(it.updated) || txt(it["dc:date"]),
      html,
      image: typeof image === "string" ? image : "",
    };
  }).filter((i) => i.title && /^https?:\/\//.test(i.url));
}

// ---------- text analysis
function cleanBlurb(t) {
  return t
    .replace(/^arXiv:\S+\s+Announce Type:\s*\S+\s*/i, "").replace(/^Abstract:\s*/i, "")
    .replace(/The post .{1,200}? appeared first on .{1,80}?\.?$/i, "")
    .replace(/\s*(\[…\]|\[\.\.\.\]|…|Read more.*|Continue reading.*)$/i, "")
    .replace(/\s+/g, " ").trim();
}
const titleLike = (s) => { const w = s.split(/\s+/); return w.length > 4 && w.filter((x) => /^[A-Z0-9“"(]/.test(x)).length / w.length > 0.6; };
function sentences(t) {
  return t.replace(/\n+/g, " ").split(/(?<=[.!?])["”’)]?\s+(?=["“‘(]?[A-Z0-9])/).map((s) => s.trim()).filter((s) => s.length >= 25 && s.length <= 320 && !/^(Image|Photo|Credit|Subscribe|Sign up|Follow us|Copyright|Advertisement|Interactive Explainer)/i.test(s) && !titleLike(s));
}
const words = (t) => (t.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || []).filter((w) => !STOP.has(w));
function summarize(text, title) {
  const sents = sentences(text);
  if (!sents.length) return text.length > SUMMARY_MAX ? text.slice(0, SUMMARY_MAX).replace(/\s+\S*$/, "") + "…" : text;
  if (sents.length <= 3) return clip(sents.slice(0, 3).join(" "));
  const tf = new Map(); for (const w of words(text)) tf.set(w, (tf.get(w) || 0) + 1);
  const tw = new Set(words(title));
  const scored = sents.map((s, i) => {
    const ws = words(s); if (!ws.length) return { s, i, sc: 0 };
    const sc = ws.reduce((a, w) => a + (tf.get(w) || 0) + (tw.has(w) ? 3 : 0), 0) / Math.sqrt(ws.length);
    return { s, i, sc: sc * (i === 0 ? 1.5 : i < 4 ? 1.15 : 1) };
  });
  const top = scored.sort((a, b) => b.sc - a.sc).slice(0, 3).sort((a, b) => a.i - b.i).map((x) => x.s);
  return clip(top.join(" "));
}
function clip(s) {
  if (s.length <= SUMMARY_MAX) return s;
  const cut = s.slice(0, SUMMARY_MAX), end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
}
function topicsFor(category, text) {
  const t = " " + text.toLowerCase() + " ";
  const out = [];
  for (const [name, terms] of Object.entries(sourcesFile.topics[category] || {})) {
    if (terms.some((term) => new RegExp("(?<![a-z0-9])" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![a-z0-9])", "i").test(t))) out.push(name);
  }
  return out;
}

// ---------- article fetch (short extract only)
async function fetchArticle(url) {
  if (!(await allowedByRobots(url))) return null;
  const html = await fetchText(url, 15000);
  const dom = new JSDOM(html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, ""), { url, virtualConsole: new VirtualConsole() });
  const og = dom.window.document.querySelector('meta[property="og:image"]')?.getAttribute("content") || "";
  const art = new Readability(dom.window.document).parse();
  dom.window.close();
  return { text: art ? art.textContent.replace(/\s+/g, " ").trim() : "", image: og };
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// ---------- main
async function main() {
  const prevFile = path.join(NEWS, "latest.json");
  const prev = fs.existsSync(prevFile) ? JSON.parse(fs.readFileSync(prevFile, "utf8")) : null;
  const status = [];

  const perSource = await pool(sourcesFile.sources, 6, async (src) => {
    try {
      const xml = await fetchText(src.url);
      let entries = parseFeed(xml);
      if (src.filter) { const re = new RegExp(src.filter, "i"); entries = entries.filter((e) => re.test(e.title + " " + stripHtml(e.html))); }
      else if (!entries.length) throw new Error("no items");
      const now = Date.now();
      const items = entries.map((e) => ({ ...e, ts: Date.parse(e.date) })).map((e) => ({ ...e, ts: Number.isFinite(e.ts) && e.ts < now + 864e5 ? e.ts : now }))
        .sort((a, b) => b.ts - a.ts).slice(0, src.limit || DEFAULT_LIMIT);
      status.push(`ok     ${src.id} (${items.length})`);
      return { src, items };
    } catch (e) {
      status.push(`FAILED ${src.id}: ${e.message}`);
      return { src, items: null };
    }
  });

  // Build items, fetching a few article pages per source where the feed text is thin
  const built = [];
  for (const { src, items } of perSource) {
    if (!items) {
      // keep what we had for up to 7 days, so one bad run does not empty a source
      const keep = (prev?.items || []).filter((i) => i.sourceId === src.id && Date.now() - Date.parse(i.published) < 7 * 864e5);
      built.push(...keep);
      continue;
    }
    let fetched = 0;
    const prevById = new Map((prev?.items || []).map((i) => [i.id, i]));
    for (const e of items) {
      const id = sha(e.url);
      const old = prevById.get(id);
      if (old && old.sourceId === src.id) { built.push(old); continue; }       // already summarised
      let body = cleanBlurb(stripHtml(e.html)), image = e.image, fullText = body.split(/\s+/).length >= 250;
      if (!src.paywalled && body.length < 600 && fetched < ARTICLE_FETCHES_PER_SOURCE && !src.id.startsWith("arxiv")) {
        fetched++;
        try {
          const a = await fetchArticle(e.url);
          if (a && a.text.length > body.length) { body = cleanBlurb(a.text); fullText = true; }
          if (a && !image) image = a.image;
          await sleep(400);
        } catch { /* keep the feed text */ }
      }
      const wc = body.split(/\s+/).filter(Boolean).length;
      built.push({
        id, category: src.category, sourceId: src.id, title: e.title, url: e.url,
        published: new Date(e.ts).toISOString(),
        summary: (() => { const x = summarize(body, e.title); return x.length >= 40 ? x : ""; })(),
        readingMin: fullText ? Math.max(1, Math.round(wc / 220)) : null,
        image: /^https?:\/\//.test(image || "") ? image : "",
        _body: body,
      });
    }
  }

  // Key terms (tf-idf over this run) and topics
  const df = new Map(); const docs = built.map((i) => i._body ? new Set(words(i._body)) : new Set());
  docs.forEach((s) => s.forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
  built.forEach((it, idx) => {
    if (it._body) {
      const tf = new Map(); for (const w of words(it._body + " " + it.title)) tf.set(w, (tf.get(w) || 0) + 1);
      it.keywords = [...tf.entries()].map(([w, c]) => [w, c * Math.log((built.length + 1) / ((df.get(w) || 0) + 1))]).filter(([w]) => w.length > 3)
        .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
      it.topics = topicsFor(it.category, it.title + " " + it.summary + " " + it._body.slice(0, 1500));
    }
    delete it._body;
    it.keywords = it.keywords || []; it.topics = it.topics || [];
  });

  const seen = new Set();
  const itemsOut = built.filter((i) => !seen.has(i.id) && seen.add(i.id)).sort((a, b) => (a.published < b.published ? 1 : -1));
  const failedAll = status.every((s) => s.startsWith("FAILED"));
  console.log(status.sort().join("\n"));
  if (failedAll) throw new Error("Every source failed; leaving existing files untouched.");

  const sources = Object.fromEntries(sourcesFile.sources.map((s) => [s.id, { name: s.name, category: s.category, paywalled: !!s.paywalled, lean: s.lean }]));
  const sameItems = prev && JSON.stringify(prev.items) === JSON.stringify(itemsOut) && JSON.stringify(prev.sources) === JSON.stringify(sources);
  const topicLists = Object.fromEntries(Object.entries(sourcesFile.topics).map(([c, t]) => [c, Object.keys(t)]));
  if (sameItems) console.log("unchanged news/latest.json");
  else {
    fs.writeFileSync(prevFile, JSON.stringify({ generated_at: new Date().toISOString(), scale: sourcesFile.scale, lean_note: sourcesFile.note, topics: topicLists, sources, items: itemsOut }) + "\n");
    console.log(`updated news/latest.json (${itemsOut.length} items)`);
  }

  // ---- Archive: only items not seen on an earlier day, with the terms used for the signals
  const archDir = path.join(NEWS, "archive");
  fs.mkdirSync(archDir, { recursive: true });
  const today = day(NOW);
  const written = (file, text, label) => {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) { fs.writeFileSync(file, text); console.log("updated " + label); }
  };
  const termLists = signals.pickTerms(itemsOut);
  itemsOut.forEach((i, k) => { i._w = termLists[k]; });
  const archFiles = fs.readdirSync(archDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  const earlier = new Set();
  for (const f of archFiles) if (f !== today + ".json") for (const i of JSON.parse(fs.readFileSync(path.join(archDir, f), "utf8"))) earlier.add(i.id);
  const slim = itemsOut.filter((i) => !earlier.has(i.id)).map((i) => {
    const e = { id: i.id, c: i.category, s: i.sourceId, p: i.published, t: i.topics, w: i._w, n: i.title, u: i.url };
    if (i.category === "business") { const m = signals.moodScore(i.title + " " + i.summary); if (m != null) e.m = m; }
    return e;
  });
  written(path.join(archDir, today + ".json"), JSON.stringify(slim) + "\n", `news/archive/${today}.json`);
  for (const f of fs.readdirSync(archDir)) {
    const d = f.replace(".json", ""); if (/^\d{4}-\d{2}-\d{2}$/.test(d) && NOW - Date.parse(d) > ARCHIVE_DAYS * 864e5) fs.unlinkSync(path.join(archDir, f));
  }
  const all = new Map();
  for (const f of fs.readdirSync(archDir).sort()) for (const i of JSON.parse(fs.readFileSync(path.join(archDir, f), "utf8"))) all.set(i.id, i);
  const arch = [...all.values()];

  // ---- Topic trends (last 30 days, by published day)
  const days = Array.from({ length: TREND_DAYS }, (_, k) => day(NOW - (TREND_DAYS - 1 - k) * 864e5));
  const trends = { days, categories: {} };
  for (const cat of Object.keys(sourcesFile.topics)) {
    const counts = {};
    for (const i of arch) {
      if (i.c !== cat) continue;
      const di = days.indexOf(day(i.p)); if (di < 0) continue;
      for (const t of i.t || []) (counts[t] = counts[t] || new Array(TREND_DAYS).fill(0))[di]++;
    }
    trends.categories[cat] = Object.fromEntries(Object.entries(counts).sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0)).slice(0, 10));
  }
  written(path.join(NEWS, "trends.json"), JSON.stringify(trends) + "\n", "news/trends.json");

  // ---- Signals: emerging ideas, topic momentum, market mood, cross-outlet stories
  const baseline = signals.baselineStats(arch, NOW);
  const emerging = baseline.ready ? signals.computeEmerging(arch, NOW) : [];
  const discussed = baseline.ready ? [] : signals.mostDiscussed(arch, NOW);
  const mood = signals.computeMood(arch, NOW);
  const scored = itemsOut.filter((i) => i.category === "business" && NOW - Date.parse(i.published) < 7 * 864e5)
    .map((i) => ({ id: i.id, m: signals.moodScore(i.title + " " + i.summary) })).filter((x) => x.m != null);
  mood.up = scored.filter((x) => x.m > 0).sort((a, b) => b.m - a.m).slice(0, 3).map((x) => x.id);
  mood.down = scored.filter((x) => x.m < 0).sort((a, b) => a.m - b.m).slice(0, 3).map((x) => x.id);
  const agreement = signals.clusterStories(itemsOut).map((g) => ({
    title: g[0].title, outlets: new Set(g.map((x) => x.sourceId)).size, items: g.map((x) => ({ id: x.id, source: x.sourceId, lean: (sourcesFile.sources.find((s) => s.id === x.sourceId) || { lean: { label: "Not rated" } }).lean.label })),
  }));
  // every story id the page may need to show, with its title, link, outlet and date
  const byId = new Map([...arch.map((i) => [i.id, { title: i.n, url: i.u, source: i.s, category: i.c, published: i.p }]), ...itemsOut.map((i) => [i.id, { title: i.title, url: i.url, source: i.sourceId, category: i.category, published: i.published }])]);
  const wanted = new Set([...emerging.concat(discussed).flatMap((e) => e.examples), ...mood.up, ...mood.down, ...agreement.flatMap((a) => a.items.map((x) => x.id))]);
  const refs = Object.fromEntries([...wanted].filter((id) => byId.has(id)).map((id) => [id, byId.get(id)]));
  const signalsOut = {
    as_of: today, baseline, provisional: !baseline.ready,
    method: {
      emerging: "Needs about three weeks of history. A term is flagged when it appears in at least 5 stories from at least 3 outlets in the last 7 days and at least 1.8 times as often as in the 3 weeks before. Until then the page lists the most discussed two-word phrases instead. Stage: early = only research sources, spreading = research plus tech or business, mainstream = no research mentions.",
      momentum: "Stories per topic in the last 7 days compared with the average week in the 3 weeks before.",
      mood: "Share of upbeat vs worried words in business headlines (word lists are published). A reading of the words, not of the market.",
      agreement: "Headlines from different outlets that share most of their key words.",
    },
    sources: Object.fromEntries(sourcesFile.sources.map((x) => [x.id, { name: x.name, lean: x.lean.label }])), emerging, most_discussed: discussed, momentum: signals.computeMomentum(arch, NOW), mood, agreement, refs,
  };
  written(path.join(NEWS, "signals.json"), JSON.stringify(signalsOut) + "\n", "news/signals.json");

  // ---- Forecast ledger: questions are written once and never edited; only outcomes are filled in later
  const fFile = path.join(NEWS, "forecasts.json");
  const ledger = fs.existsSync(fFile) ? JSON.parse(fs.readFileSync(fFile, "utf8")) : { model: signals.MODEL, forecasts: [] };
  signals.resolveForecasts(ledger.forecasts, arch, NOW);
  ledger.forecasts.push(...(baseline.ready ? signals.makeForecasts(emerging, ledger.forecasts, NOW, "emerging") : signals.makeForecasts(discussed, ledger.forecasts, NOW, "most-discussed")));
  ledger.summary = signals.scoreboard(ledger.forecasts);
  ledger.note = "Forecasts are made at most once a week from the emerging-ideas list and scored with the Brier score against a 50% benchmark (0.25). The git history of this file is the audit trail.";
  written(fFile, JSON.stringify(ledger, null, 1) + "\n", "news/forecasts.json");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
