// Signals page: an outlook board built from news/outlook.json, news/signals.json and news/forecasts.json (all built by scripts/build-news.js).
// All text is inserted with textContent, never as HTML.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var STAGE = { early: ["Research only", "Appears in research sources, not yet in industry press"], spreading: ["Research + industry press", "Appears in research sources and in tech or business coverage"], mainstream: ["Industry press only", "Appears in tech or business coverage, with no research mentions this fortnight"] };
  var LEAN_CLASS = { "Left": "l2", "Lean Left": "l1", "Center": "c0", "Lean Right": "r1", "Right": "r2", "Not rated": "nr" };
  var LEAN_ORDER = ["Left", "Lean Left", "Center", "Lean Right", "Right", "Not rated"];
  var sig = null, fc = null, ol = null, stageFilter = "all", qDomain = "all";

  function h(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "class") n.className = props[k]; else if (k === "text") n.textContent = props[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), props[k]);
      else if (props[k] !== false && props[k] != null) n.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function svg(tag, attrs, kids) { var n = document.createElementNS("http://www.w3.org/2000/svg", tag); Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); }); (kids || []).forEach(function (c) { n.appendChild(c); }); return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function fmtDay(d) { return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); }
  function srcName(id) { return (sig.sources[id] && sig.sources[id].name) || id; }
  function storyLink(id) {
    var r = sig.refs[id]; if (!r) return null;
    return h("li", {}, [h("a", { href: r.url, rel: "noopener", target: "_blank", text: r.title }), h("span", { class: "muted small", text: " — " + srcName(r.source) })]);
  }
  function learnLink(term) { return h("a", { href: "https://en.wikipedia.org/wiki/Special:Search?search=" + encodeURIComponent(term), rel: "noopener", target: "_blank", text: "Learn the basics ↗" }); }

  function ideaCard(e, provisional) {
    var st = STAGE[e.stage];
    var why = provisional
      ? e.recent + " stories from " + e.outlets + " outlets in the last 7 days."
      : "Mentioned in " + e.recent + " stories from " + e.outlets + " outlets this week, about " + e.ratio + "× its usual rate (" + e.base_per_week + " a week before)" + (e.is_new ? ", and it was absent before." : ".");
    var seen = Object.keys(e.first_seen).map(function (c) { return { c: c, d: e.first_seen[c] }; }).sort(function (a, b) { return a.d < b.d ? -1 : 1; })
      .map(function (x) { return ({ research: "research", tech: "tech press", business: "business press" }[x.c]) + " " + fmtDay(x.d); }).join(" → ");
    var ex = (e.examples || []).map(storyLink).filter(Boolean);
    return h("article", { class: "idea" }, [
      h("div", { class: "idea-head" }, [h("h3", { text: e.term }), h("span", { class: "tag stage-" + e.stage, title: st[1], text: st[0] })]),
      h("p", { class: "idea-why", text: why }),
      h("p", { class: "muted small", text: "First seen in this data: " + seen + (e.lag_days != null ? " (" + e.lag_days + " days from research to industry press)" : "") + "." }),
      ex.length ? h("ul", { class: "idea-stories" }, ex) : null,
      h("p", { class: "small" }, [learnLink(e.term)])
    ]);
  }
  // ---------- market mood
  function renderMood(box) {
    var m = sig.mood, avg = m.last7_average;
    var label = avg == null ? "Not enough scored headlines yet" : avg >= 0.15 ? "More upbeat than worried words" : avg <= -0.15 ? "More worried than upbeat words" : "Mixed";
    box.appendChild(h("p", { class: "mood-now" }, [h("strong", { text: label }), h("span", { class: "muted small", text: avg == null ? "" : "  (average " + (avg > 0 ? "+" : "") + avg + " over " + m.last7_scored + " business headlines, last 7 days; scale −1 to +1)" })]));
    var pts = m.series.map(function (v, i) { return v == null ? null : [i, v]; }).filter(Boolean);
    if (pts.length >= 2) {
      var W = 520, H = 120, L = 6, R = 6, T = 8, B = 16, n = m.series.length;
      var x = function (i) { return L + i / (n - 1) * (W - L - R); }, y = function (v) { return T + (1 - (v + 1) / 2) * (H - T - B); };
      var s = svg("svg", { viewBox: "0 0 " + W + " " + H, class: "trend", role: "img", "aria-label": "Daily average of upbeat minus worried words in business headlines, last 30 days" });
      s.appendChild(svg("line", { x1: L, x2: W - R, y1: y(0), y2: y(0), class: "grid" }));
      s.appendChild(svg("polyline", { points: pts.map(function (p) { return x(p[0]).toFixed(1) + "," + y(p[1]).toFixed(1); }).join(" "), fill: "none", stroke: "#00f0ff", "stroke-width": 2 }));
      pts.forEach(function (p) { var c = svg("circle", { cx: x(p[0]), cy: y(p[1]), r: 3, fill: "#00f0ff" }); c.appendChild(svg("title", {}, [document.createTextNode(m.days[p[0]] + ": " + p[1])])); s.appendChild(c); });
      var t0 = svg("text", { x: L, y: H - 2, class: "axis" }); t0.textContent = m.days[0].slice(5); s.appendChild(t0);
      var t1 = svg("text", { x: W - R, y: H - 2, "text-anchor": "end", class: "axis" }); t1.textContent = m.days[n - 1].slice(5); s.appendChild(t1);
      box.appendChild(s);
    } else box.appendChild(h("p", { class: "muted small", text: "The daily line appears once at least two days have enough business headlines." }));
    function heads(ids, title) { var li = ids.map(storyLink).filter(Boolean); return li.length ? h("div", {}, [h("h4", { text: title }), h("ul", { class: "idea-stories" }, li)]) : null; }
    box.appendChild(h("div", { class: "mood-heads" }, [heads(m.up, "Most upbeat headlines"), heads(m.down, "Most worried headlines")]));
    box.appendChild(h("details", { class: "nc-more" }, [h("summary", { text: "Which words count?" }), h("p", { class: "small", text: "Upbeat: " + m.lexicon.pos.join(", ") }), h("p", { class: "small", text: "Worried: " + m.lexicon.neg.join(", ") }), h("p", { class: "muted small", text: "This counts words in headlines and summaries. It measures the tone of coverage, not the market, and a headline like “Fears ease” is scored as worried." })]));
  }

  // ---------- stories several outlets cover
  function renderAgreement(box) {
    if (!sig.agreement.length) { box.appendChild(h("p", { class: "muted", text: "No story is covered by two or more outlets in the current snapshot." })); return; }
    sig.agreement.forEach(function (a) {
      var counts = {}; a.items.forEach(function (i) { counts[i.lean] = (counts[i.lean] || 0) + 1; });
      var chips = LEAN_ORDER.filter(function (l) { return counts[l]; }).map(function (l) { return h("span", { class: "lean " + LEAN_CLASS[l], text: l + " ×" + counts[l] }); });
      box.appendChild(h("article", { class: "idea" }, [
        h("h3", { text: a.title }), h("p", { class: "muted small", text: "Covered by " + a.outlets + " outlets" }), h("div", { class: "nc-meta" }, chips),
        h("ul", { class: "idea-stories" }, a.items.map(function (i) { return storyLink(i.id); }).filter(Boolean))
      ]));
    });
  }

  // ---------- forecasts
  function pct(p) { return Math.round(p * 100) + "%"; }
  function table(head, rows, empty) {
    var t = h("table", { class: "data-table" }), tr = h("tr");
    head.forEach(function (x) { tr.appendChild(h("th", { text: x })); }); t.appendChild(h("thead", {}, [tr]));
    var tb = h("tbody");
    if (!rows.length) tb.appendChild(h("tr", {}, [h("td", { colspan: head.length, text: empty })]));
    rows.forEach(function (r) { tb.appendChild(h("tr", {}, r.map(function (c) { return h("td", { text: c == null ? "" : String(c) }); }))); });
    t.appendChild(tb); return h("div", { class: "table-wrap" }, [t]);
  }
  function snip(t, n) { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + "…" : t; }
  // Daily counts as small bars: the 21 days before the question, then (once resolved) the days it covered
  function spark(before, after, days) {
    var n = before.length + (after ? after.length + 1 : 0), W = 420, H = 64, bw = W / n, max = Math.max(1, Math.max.apply(null, before.concat(after || [])));
    var s = svg("svg", { viewBox: "0 0 " + W + " " + (H + 14), class: "spark", role: "img", "aria-label": "Stories per day: " + before.join(", ") + (after ? " then, during the question: " + after.join(", ") : "") });
    function bar(v, i, cls) { var hh = v ? Math.max(2, v / max * H) : 1; var r = svg("rect", { x: i * bw + 1, y: H - hh, width: Math.max(1, bw - 2), height: hh, class: cls }); r.appendChild(svg("title", {}, [document.createTextNode(String(v) + (v === 1 ? " story" : " stories"))])); s.appendChild(r); }
    before.forEach(function (v, i) { bar(v, i, i >= before.length - 7 ? "sp-week" : "sp-old"); });
    if (after) { s.appendChild(svg("line", { x1: before.length * bw + bw / 2, x2: before.length * bw + bw / 2, y1: 0, y2: H, class: "sp-div" })); after.forEach(function (v, i) { bar(v, before.length + 1 + i, "sp-after"); }); }
    var l = svg("text", { x: 0, y: H + 11, class: "axis" }); l.textContent = days && days[0] ? days[0].slice(5) : ""; s.appendChild(l);
    var r = svg("text", { x: W, y: H + 11, "text-anchor": "end", class: "axis" }); r.textContent = after ? "after the question" : (days && days.length ? days[days.length - 1].slice(5) : ""); s.appendChild(r);
    return s;
  }
  function sect(title, kids) { return h("section", { class: "q-sec" }, [h("h5", { text: title })].concat(kids.filter(Boolean))); }
  function bulletless(lines) { return lines.filter(Boolean).map(function (t) { return typeof t === "string" ? h("p", { text: t }) : t; }); }

  // ----- questions about real outcomes: economy, jobs and research
  var DOMAIN = { jobs: "Jobs", economy: "Economy", research: "New research" };
  function fmtVal(v, unit, dec) {
    if (v == null) return "";
    var n = Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(Math.round(v * 100) / 100);
    return unit === "%" ? n + "%" : unit && unit !== "points" ? n + " " + unit : n;
  }
  // A difference or a typical miss: percentage points for a rate, plain units otherwise
  function fmtDelta(v, unit) { if (v == null) return ""; var n = Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(Math.round(v * 100) / 100); return unit === "%" ? n + " points" : unit && unit !== "points" ? n + " " + unit : n; }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function fmtPeriod(d, freq) { return freq === "monthly" ? MONTHS[Number(d.slice(5, 7)) - 1] + " " + d.slice(0, 4) : fmtDay(d) + " " + d.slice(0, 4); }
  function line(hist, threshold, unit) {
    var W = 420, H = 90, L = 4, R = 4, T = 6, B = 16, vals = hist.map(function (x) { return x.v; }).concat(threshold != null ? [threshold] : []);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = hi - lo || 1, n = hist.length;
    var X = function (i) { return L + i / Math.max(1, n - 1) * (W - L - R); }, Y = function (v) { return T + (1 - (v - lo) / span) * (H - T - B); };
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, class: "spark", role: "img", "aria-label": "Recent values, from " + fmtVal(hist[0].v, unit) + " to " + fmtVal(hist[n - 1].v, unit) });
    if (threshold != null) { s.appendChild(svg("line", { x1: L, x2: W - R, y1: Y(threshold), y2: Y(threshold), class: "sp-div" })); }
    s.appendChild(svg("polyline", { points: hist.map(function (x, i) { return X(i).toFixed(1) + "," + Y(x.v).toFixed(1); }).join(" "), fill: "none", stroke: "#00f0ff", "stroke-width": 2, "stroke-linejoin": "round" }));
    var last = hist[n - 1], c = svg("circle", { cx: X(n - 1), cy: Y(last.v), r: 3.5, fill: "#00f0ff" }); c.appendChild(svg("title", {}, [document.createTextNode(last.d + ": " + fmtVal(last.v, unit))])); s.appendChild(c);
    var a = svg("text", { x: L, y: H - 3, class: "axis" }); a.textContent = hist[0].d.slice(0, 7); s.appendChild(a);
    var b = svg("text", { x: W - R, y: H - 3, "text-anchor": "end", class: "axis" }); b.textContent = last.d.slice(0, 7); s.appendChild(b);
    return s;
  }
  function indicatorParts(f) {
    var c = f.context, m = c.measure, r = c.reasoning, bt = r.backtest || {}, done = f.outcome !== null && !f.void, unit = m.unit;
    var per = m.freq === "monthly" ? "months" : "weeks", dirWord = r.q === "lower" ? "lower" : r.q === "above_avg" ? "above the bar" : "higher";
    var step1;
    if (r.method === "frequency") step1 = "Step 1, how often it happens. In the last " + (r.window_n || 12) + " comparable " + per + ", this fell in " + (r.window_hits == null ? "some" : r.window_hits) + " of them, which puts the chance at " + pct(r.model_p) + ". This series moves in steps, so it is mostly unchanged from one " + per.slice(0, -1) + " to the next.";
    else if (r.q === "above_avg") step1 = "Step 1, the pace. The bar is " + fmtVal(r.threshold, unit) + ", the average of the last " + r.win + " " + per + ". Recent values suggest about " + fmtVal(r.expected, unit) + " (the usual miss is about " + fmtDelta(r.sd, unit) + "), which gives a " + pct(r.model_p) + " chance of being above it.";
    else step1 = "Step 1, the trend. Over the last " + r.k + " " + per + " it has moved by " + fmtDelta(c.trend.change, unit) + ". Allowing for a little of that trend, the model expects about " + fmtVal(r.expected, unit) + " (the usual miss is about " + fmtDelta(r.sd, unit) + "), which gives a " + pct(r.model_p) + " chance that it ends " + dirWord + ".";
    var verdict = bt.skill > 0.1 ? "so it adds real information" : bt.skill >= 0 ? "so it adds only a little" : "so it did worse than the plain rate";
    var step2 = "Step 2, a test on history. The same method was run on " + (bt.n || 0).toLocaleString("en-US") + " earlier cases. It scored " + bt.brier_model + " (error score; lower is better) against " + bt.brier_base + " for simply saying the long-run rate of " + pct(bt.base) + ", " + verdict + ".";
    var step3 = r.weight <= 0.01 ? "Result: because the method showed no skill, this question uses the long-run rate, " + pct(r.final_p) + "." : "Result: the model's number is blended with the long-run rate (weight on the model " + r.weight + "), giving " + pct(r.final_p) + ".";
    var t = c.trend, stands = "Latest: " + fmtVal(c.latest.value, unit) + " (" + fmtPeriod(c.latest.date, m.freq) + "). Over the last " + t.over + " it changed by " + fmtDelta(t.change, unit) + ". Over the last year it ranged from " + fmtVal(t.low_52, unit) + " to " + fmtVal(t.high_52, unit) + ".";
    var body = [
      sect("What this measures", [h("p", { text: m.why }), h("p", { class: "muted small" }, ["Source: ", h("a", { href: m.source.url, rel: "noopener", target: "_blank", text: m.source.name }), m.lag ? ". New figures are " + m.lag + "." : "."])]),
      sect("Where it stands", [h("p", { text: stands }), line(c.history, r.q === "above_avg" ? f.threshold : null, unit)]),
      sect(done ? "How the probability was reached (written before the result)" : "How the probability was reached", bulletless([step1, step2, step3])),
      sect("What counts as yes", [h("p", { text: c.resolution })])
    ];
    if (done && f.result_note) body.unshift(sect("What happened", [h("p", { class: "q-result", text: (f.outcome ? "Yes. " : "No. ") + f.result_note }), h("p", { class: "muted small", text: "Probability said " + pct(f.p) + "; error score " + f.brier + " (0 is perfect, 0.25 is what always saying 50% would score)." })]));
    return { body: body, done: done, unit: unit };
  }
  function indicatorCard(f) {
    var P = indicatorParts(f), c = f.context, body = P.body, done = P.done, unit = P.unit;
    var head = h("div", { class: "q-head" }, [h("div", {}, [h("span", { class: "tag q-kind", text: DOMAIN[f.domain] || "Indicator" }), h("h4", { class: "q-title", text: f.question })]),
      h("div", { class: "q-prob" + (done ? (f.outcome ? " yes" : " no") : "") }, [h("strong", { text: done ? (f.outcome ? "Yes" : "No") : pct(f.p) }), h("span", { text: done ? "said " + pct(f.p) : "chance of yes" })])]);
    var meta = "Asked " + fmtDay(f.made) + (done ? ", resolved " + fmtDay(f.resolves) : ", expected to resolve around " + fmtDay(f.resolves)) + ". Latest: " + fmtVal(c.latest.value, unit);
    return h("article", { class: "q-card", id: f.id }, [head, h("p", { class: "q-meta", text: meta }), h("details", { class: "q-more" }, [h("summary", { text: "Show the data and reasoning" })].concat(body))]);
  }

  function questionCard(f) {
    if (f.kind === "indicator") return indicatorCard(f);
    var c = f.context, m = c.mentions, r = c.reasoning, done = f.outcome !== null && !f.void, spread = f.kind === "term-spread";
    var kind = spread ? "Will it reach industry press?" : "Will it keep making news?";
    var usual = m.base_per_week, rate = m.ratio;
    var run = "This week: " + m.recent + " stories from " + m.outlets + " outlets. " + (usual ? "A week this size would normally have about " + usual + ", so it is running at roughly " + rate + " times its usual level." : "It was almost absent in the weeks before.");
    var cats = m.by_category, where = ["research", "tech", "business"].map(function (k) { return ({ research: "research", tech: "tech", business: "business" }[k]) + " " + (cats[k] || 0); }).join(" · ");
    var seen = Object.keys(m.first_seen || {}).map(function (k) { return { k: k, d: m.first_seen[k] }; }).sort(function (a, b) { return a.d < b.d ? -1 : 1; }).map(function (x) { return ({ research: "research", tech: "tech press", business: "business press" }[x.k]) + " " + fmtDay(x.d); }).join(" → ");
    var peak = m.peak && m.peak.share != null && m.peak.share >= 0.4 && m.recent >= 4 ? h("p", { class: "q-note", text: Math.round(m.peak.share * 100) + "% of this week's mentions came on a single day (" + fmtDay(m.peak.day) + "), so this looks like one burst of coverage more than steady attention. Step 2 below shows how often phrases like this held their level." }) : null;
    // what it is
    var what = c.definition
      ? [h("p", { text: c.definition.text }), h("p", { class: "muted small" }, ["From Wikipedia: ", h("a", { href: c.definition.url, rel: "noopener", target: "_blank", text: c.definition.title }), " (CC BY-SA). It describes the name, not this week's news."])]
      : [h("p", { class: "muted", text: "No encyclopedia page matched this exact name, so the headlines below are the best description of what it is." })];
    // why we are asking
    var ex = (c.examples || []).map(function (e) { return h("li", {}, [h("a", { href: e.url, rel: "noopener", target: "_blank", text: e.title }), h("span", { class: "muted small", text: " — " + (sig.sources[e.source] ? sig.sources[e.source].name : e.source) + (e.published ? ", " + fmtDay(e.published.slice(0, 10)) : "") }), e.summary ? h("span", { class: "q-snip", text: snip(e.summary, 170) }) : null]); });
    var why = bulletless([run, "Where it appears: " + where + (seen ? ". First seen: " + seen + (m.lag_days != null ? " (" + m.lag_days + " days from research to industry press)" : "") + "." : "."), peak]).concat([spark(m.daily, done && f.daily_after ? f.daily_after : null, m.days), ex.length ? h("ul", { class: "idea-stories" }, ex) : null]);
    // how the probability was reached
    var how;
    if (spread) {
      var b = r.backtest || {};
      how = bulletless([
        "Research phrases only sometimes reach tech or business coverage, and how often is not well known yet. In the history collected so far, " + (b.cases || 0) + " comparable research-only phrases could be checked and " + (b.hits || 0) + " reached industry headlines within " + (b.horizon_days || 14) + " days.",
        "With so few cases the estimate leans on a stated starting guess of " + pct(b.prior || 0.25) + ", pulled toward that history. Result: " + pct(r.final_p) + ". This number will become more reliable as more weeks are collected."
      ]);
    } else {
      var bt = r.backtest || {}, adj = bt.shift == null ? 0 : bt.shift;
      how = bulletless([
        "Step 1, the pace. At this week's pace we would expect about " + r.expected + " stories next week and the bar is " + r.threshold + ". A simple model that assumes the pace roughly holds puts the chance of reaching the bar at " + pct(r.model_p) + ".",
        bt.cases ? "Step 2, a reality check. In the weeks already collected, " + bt.cases + " comparable phrases (at least 6 stories from 3 outlets in a week) were tested against the same kind of bar, over " + bt.origins + " overlapping starting days, so this is a small sample. " + pct(bt.rate) + " of them reached it, while the simple model had predicted " + pct(bt.mean_model) + " on average. " + (adj < -0.05 ? "The model was too optimistic, so this probability is lowered." : adj > 0.05 ? "The model was too cautious, so this probability is raised." : "The model was about right, so it is left almost unchanged.") : "Step 2 was skipped because there is not enough history yet.",
        "Result: " + pct(r.final_p) + " that it reaches " + r.threshold + " stories."
      ]);
    }
    var body = [sect("What it is", what), sect("Why this question", why), sect(done ? "How the probability was reached (written before the result)" : "How the probability was reached", how), sect("What counts as yes", [h("p", { text: c.resolution })])];
    if (done && f.result_note) body.unshift(sect("What happened", [h("p", { class: "q-result", text: (f.outcome ? "Yes. " : "No. ") + "It appeared in " + f.observed + (f.observed === 1 ? " story" : " stories") + " against a bar of " + f.threshold + ". " + f.result_note }), h("p", { class: "muted small", text: "Probability said " + pct(f.p) + "; Brier score " + f.brier + " (0 is perfect, 0.25 is what always saying 50% would score)." })]));
    var head = h("div", { class: "q-head" }, [h("div", {}, [h("span", { class: "tag q-kind", text: kind }), h("h4", { class: "q-title", text: f.question })]),
      h("div", { class: "q-prob" + (done ? (f.outcome ? " yes" : " no") : "") }, [h("strong", { text: done ? (f.outcome ? "Yes" : "No") : pct(f.p) }), h("span", { text: done ? "said " + pct(f.p) : "chance of yes" })])]);
    var summary = (done ? "Asked " : "Asked ") + fmtDay(f.made) + (done ? ", resolved " : ", resolves ") + fmtDay(f.resolves) + ". " + (m.recent + " stories this week" + (usual ? " vs about " + usual + " usual" : ", almost none before"));
    return h("article", { class: "q-card", id: f.id }, [head, h("p", { class: "q-meta", text: summary }), h("details", { class: "q-more" }, [h("summary", { text: "Show the evidence and reasoning" })].concat(body))]);
  }


  // ================= outlook layout =================
  var SECTIONS = [
    { id: "jobs", title: "Jobs", blurb: "Is hiring strong or weakening? Unemployment, layoffs and monthly job gains in the US, and unemployment in Denmark." },
    { id: "economy", title: "Economy", blurb: "Prices, interest rates, borrowing costs, the dollar against the krone, and oil." },
    { id: "investment", title: "Investment", blurb: "Stock market level, government bond yields and market fear. Short-term moves in these are close to a coin flip, so treat them as context." },
    { id: "technology", title: "Technology", blurb: "How much software hiring there is, and which ideas the tech press is suddenly writing about." },
    { id: "research", title: "Research", blurb: "How much researchers are publishing in the fields I follow, and which research topics are rising in the news." }
  ];
  var TABS = [{ id: "overview", title: "Overview" }].concat(SECTIONS).concat([{ id: "record", title: "Forecast record" }, { id: "about", title: "How it works" }]);
  var panels = {}, tabBtns = {};

  function unitText(v, it) {
    if (v == null) return "";
    var d = it.dec != null ? it.dec : 1, n = Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(Math.round(v * Math.pow(10, d)) / Math.pow(10, d));
    if (it.unit === "%") return n + "%";
    if (!it.unit || /,/.test(it.unit) || it.unit === "points") return n;
    return n + " " + it.unit;
  }
  function changeText(it) {
    var c = it.trend.change; if (it.direction === "flat") return "little changed over " + it.trend.over;
    var n = Math.abs(c) >= 1000 ? Math.round(Math.abs(c)).toLocaleString("en-US") : String(Math.round(Math.abs(c) * 100) / 100);
    return (c > 0 ? "up " : "down ") + n + (it.unit === "%" ? " pts" : "") + " over " + it.trend.over;
  }
  function chip(it) { var sym = it.direction === "up" ? "▲" : it.direction === "down" ? "▼" : "▬"; return h("span", { class: "dir dir-" + it.direction }, [h("span", { "aria-hidden": "true", text: sym + " " }), changeText(it)]); }
  function nextPhrase(n, it) {
    var thr = unitText(n.threshold, it), p = Math.round(n.p * 100) + "%";
    if (n.direction === "above_avg") return p + " chance it comes in above " + thr + ", its recent average";
    return p + " chance it ends " + (n.direction === "lower" ? "lower" : "higher") + " than " + thr;
  }
  function tiny(hist, cls) {
    var W = 120, H = 34, vals = hist.map(function (x) { return x.v; }), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), sp = hi - lo || 1, n = hist.length;
    var X = function (i) { return 2 + i / Math.max(1, n - 1) * (W - 4); }, Y = function (v) { return 3 + (1 - (v - lo) / sp) * (H - 6); };
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, class: "tiny " + (cls || ""), role: "img", "aria-label": "Trend over the period shown on the card" });
    s.appendChild(svg("polyline", { points: hist.map(function (x, i) { return X(i).toFixed(1) + "," + Y(x.v).toFixed(1); }).join(" "), fill: "none", "stroke-width": 1.8, "stroke-linejoin": "round" }));
    s.appendChild(svg("circle", { cx: X(n - 1), cy: Y(hist[n - 1].v), r: 2.6 }));
    return s;
  }
  function probBar(p) {
    return h("div", { class: "pbar", role: "img", "aria-label": Math.round(p * 100) + " percent chance" }, [h("span", { class: "fill", style: "width:" + Math.round(p * 100) + "%" }), h("span", { class: "mid", title: "50%" })]);
  }
  function go(id) {
    TABS.forEach(function (t) { var on = t.id === id; panels[t.id].hidden = !on; tabBtns[t.id].setAttribute("aria-selected", on ? "true" : "false"); tabBtns[t.id].tabIndex = on ? 0 : -1; });
    try { history.replaceState(null, "", "#" + id); } catch (e) {}
  }
  function itemsOf(sec) { return ol.items.filter(function (i) { return i.section === sec; }); }

  // ----- overview
  function snapshotTile(it) {
    return h("a", { class: "ol-tile", href: "#" + it.section, onclick: function (e) { e.preventDefault(); go(it.section); window.scrollTo({ top: $("sig-tabs").offsetTop - 8 }); } }, [
      h("span", { class: "t-title", text: it.title }),
      h("span", { class: "t-val", text: unitText(it.latest.value, it) }),
      chip(it), tiny(it.history, "d-" + it.direction),
      it.next ? h("span", { class: "t-next", text: nextPhrase(it.next, it) }) : null
    ]);
  }
  function renderOverview(box) {
    box.appendChild(h("h2", { class: "section-title", text: "Where things stand" }));
    box.appendChild(h("p", { class: "muted", text: "The latest reading of each indicator, how it has moved, and our estimate for the next figure. Select any tile for the full picture." }));
    SECTIONS.forEach(function (s) {
      var its = itemsOf(s.id); if (!its.length) return;
      box.appendChild(h("h3", { class: "ol-group", text: s.title }));
      box.appendChild(h("div", { class: "ol-tiles" }, its.map(snapshotTile)));
    });
    // coming up
    var up = ol.items.filter(function (i) { return i.next; }).sort(function (a, b) { return a.next.resolves < b.next.resolves ? -1 : 1; });
    box.appendChild(h("h2", { class: "section-title", text: "Coming up" }));
    box.appendChild(h("p", { class: "muted", text: "The next figures to be published, in order, with the probability written down before they arrive." }));
    box.appendChild(h("div", { class: "table-wrap" }, [h("table", { class: "data-table" }, [
      h("thead", {}, [h("tr", {}, ["Due about", "Indicator", "Our estimate"].map(function (x) { return h("th", { text: x }); }))]),
      h("tbody", {}, up.map(function (i) { return h("tr", {}, [h("td", { text: fmtDay(i.next.resolves) }), h("td", { text: i.title }), h("td", { text: nextPhrase(i.next, i) })]); }))
    ])]));
    // news
    box.appendChild(h("h2", { class: "section-title", text: "In the news this week" }));
    var cols = [];
    if (!sig.provisional) {
      var rows = [];
      [["research", "Research"], ["tech", "Technology"], ["business", "Business"]].forEach(function (c) { (sig.momentum[c[0]].rising || []).slice(0, 2).forEach(function (r) { rows.push(h("li", {}, [h("strong", { text: r.topic }), h("span", { class: "muted small", text: " (" + c[1].toLowerCase() + ") +" + r.change + "%" })])); }); });
      cols.push(h("div", { class: "ol-news" }, [h("h4", { text: "Topics getting more coverage" }), rows.length ? h("ul", { class: "plain" }, rows) : h("p", { class: "muted small", text: "No topic is clearly rising." })]));
    }
    var m = sig.mood, avg = m.last7_average;
    cols.push(h("div", { class: "ol-news" }, [h("h4", { text: "Tone of business headlines" }), h("p", { text: avg == null ? "Not enough scored headlines yet." : avg >= 0.15 ? "More upbeat than worried words." : avg <= -0.15 ? "More worried than upbeat words." : "Mixed." }), h("p", { class: "muted small" }, [h("a", { href: "#investment", onclick: function (e) { e.preventDefault(); go("investment"); }, text: "See the chart" })])]));
    var top = sig.agreement && sig.agreement[0];
    if (top) cols.push(h("div", { class: "ol-news" }, [h("h4", { text: "Most widely covered story" }), h("p", { text: top.title }), h("p", { class: "muted small", text: "Covered by " + top.outlets + " outlets" })]));
    box.appendChild(h("div", { class: "ol-newsgrid" }, cols));
    box.appendChild(h("h2", { class: "section-title", text: "Same story, different outlets" }));
    var ag = h("div", { class: "idea-grid" }); box.appendChild(ag); renderAgreement(ag);
  }

  // ----- sections
  function indicatorBlock(it) {
    var f = it.next && fc.forecasts.filter(function (x) { return x.id === it.next.id; })[0];
    var kids = [
      h("div", { class: "ol-head" }, [h("div", {}, [h("h3", { text: it.title }), h("p", { class: "muted small", text: "Latest figure for " + fmtPeriod(it.latest.date, it.freq) })]), h("div", { class: "ol-big" }, [h("strong", { text: unitText(it.latest.value, it) }), chip(it)])]),
      line(it.history, null, it.unit),
      h("p", { text: it.reading }),
      h("p", { class: "muted small" }, [it.why + " Source: ", h("a", { href: it.source.url, rel: "noopener", target: "_blank", text: it.source.name }), it.lag ? ". New figures are " + it.lag + "." : "."])
    ];
    if (it.next) {
      var skill = it.next.has_skill ? "On past data this method does better than guessing the long-run rate." : "On past data this method does no better than the long-run rate, so the number is close to that rate.";
      kids.push(h("div", { class: "ol-next" }, [
        h("h4", { text: "Next figure: what to expect" }), h("p", { text: it.next.question }),
        h("div", { class: "ol-prob" }, [h("strong", { text: Math.round(it.next.p * 100) + "%" }), probBar(it.next.p), h("span", { class: "muted small", text: "chance of yes" })]),
        h("p", { class: "muted small", text: "Due about " + fmtDay(it.next.resolves) + ". " + skill + (it.record.n ? " Right " + it.record.hits + " of " + it.record.n + " so far on this series." : " No result on this series yet.") })
      ]));
      if (f) kids.push(h("details", { class: "q-more" }, [h("summary", { text: "Show how this number was reached" })].concat(indicatorParts(f).body)));
    }
    return h("article", { class: "ol-card" }, kids);
  }
  function momentumBlock(cat, label) {
    var box = h("div", { class: "ol-mom" }, [h("h3", { text: label + ": topics in the news" })]);
    if (sig.provisional) { box.appendChild(h("p", { class: "muted", text: "This compares the last 7 days with the three weeks before, so it appears once the page has that history." })); return box; }
    var m = sig.momentum[cat], all = (m.rising || []).concat(m.falling || []);
    box.appendChild(h("p", { class: "muted small", text: "Stories per topic in the last 7 days against the average of the three weeks before." }));
    if (!all.length) { box.appendChild(h("p", { class: "muted", text: "No topic moved enough to report." })); return box; }
    var max = Math.max.apply(null, all.map(function (r) { return Math.abs(r.change); })) || 1;
    all.sort(function (a, b) { return b.change - a.change; }).forEach(function (r) {
      var w = Math.max(3, Math.round(Math.abs(r.change) / max * 100));
      box.appendChild(h("div", { class: "mbar " + (r.change > 0 ? "up" : "down") }, [
        h("span", { class: "m-topic", text: r.topic }),
        h("span", { class: "m-track", role: "img", "aria-label": (r.change > 0 ? "up " : "down ") + Math.abs(r.change) + " percent" }, [h("span", { class: "m-fill", style: "width:" + w + "%" })]),
        h("span", { class: "m-val", text: (r.change > 0 ? "+" : "") + r.change + "%" }),
        h("span", { class: "muted small m-note", text: r.recent + " vs " + r.base_per_week + " a week" })
      ]));
    });
    return box;
  }
  function renderIdeas(box) {
    var prov = sig.provisional, list = prov ? sig.most_discussed : sig.emerging;
    box.appendChild(h("h3", { text: prov ? "Most discussed phrases this week" : "Phrases suddenly in the news" }));
    box.appendChild(h("p", { class: "muted small", text: prov
      ? "Two-word phrases that several outlets used most this week. This is not yet a trend: spotting what is rising needs about three weeks of history, and the page has " + sig.baseline.items + " older stories on " + sig.baseline.days + " different days so far (it needs " + sig.baseline.needs + ")."
      : "Phrases used far more than usual by several independent outlets in the last 7 days. Many are product launches; the label says whether the phrase is also showing up in research." }));
    var filters = h("div", { class: "chips" }), grid = h("div", { class: "idea-grid" });
    function draw() {
      clear(filters); clear(grid);
      if (!prov) ["all", "early", "spreading", "mainstream"].forEach(function (s) { filters.appendChild(h("button", { type: "button", class: "chip" + (stageFilter === s ? " on" : ""), "aria-pressed": stageFilter === s ? "true" : "false", onclick: function () { stageFilter = s; draw(); }, text: s === "all" ? "All" : STAGE[s][0] })); });
      var shown = list.filter(function (e) { return prov || stageFilter === "all" || e.stage === stageFilter; });
      if (!shown.length) grid.appendChild(h("p", { class: "muted", text: prov ? "No phrase has been used by enough outlets yet." : "Nothing matches this filter right now." }));
      shown.forEach(function (e) { grid.appendChild(ideaCard(e, prov)); });
    }
    draw(); box.appendChild(filters); box.appendChild(grid);
  }
  function renderSection(sec, box) {
    box.appendChild(h("h2", { class: "section-title", text: sec.title }));
    box.appendChild(h("p", { class: "muted", text: sec.blurb }));
    var its = itemsOf(sec.id);
    if (its.length) box.appendChild(h("div", { class: "ol-cards" }, its.map(indicatorBlock)));
    if (sec.id === "economy") box.appendChild(momentumBlock("business", "Business"));
    if (sec.id === "investment") { var mb = h("div", { class: "ol-mom" }, [h("h3", { text: "Tone of business headlines" }), h("p", { class: "muted small", text: "A word count, not a market forecast: the balance of upbeat and worried words in business headlines." })]); box.appendChild(mb); renderMood(mb); }
    if (sec.id === "technology") { box.appendChild(momentumBlock("tech", "Technology")); var ib = h("div", {}); box.appendChild(ib); renderIdeas(ib); }
    if (sec.id === "research") box.appendChild(momentumBlock("research", "Research"));
    var qs = fc.forecasts.filter(function (f) { return f.kind === "indicator" && f.outcome !== null && !f.void && itemsOf(sec.id).some(function (i) { return i.id === f.indicator; }); }).reverse();
    if (qs.length) { box.appendChild(h("h3", { text: "Past questions on these indicators" })); box.appendChild(h("div", { class: "q-list" }, qs.map(indicatorCard))); }
  }

  // ----- record
  function correct(f) { return f.p >= 0.5 ? f.outcome === 1 : f.outcome === 0; }
  function renderRecord(box) {
    var s = fc.summary, list = fc.forecasts;
    var done = list.filter(function (f) { return f.outcome !== null && !f.void; }), right = done.filter(correct).length;
    var real = done.filter(function (f) { return f.kind === "indicator"; }), realRight = real.filter(correct).length;
    var openF = list.filter(function (f) { return f.outcome === null && !f.void; });
    box.appendChild(h("h2", { class: "section-title", text: "Forecast record" }));
    box.appendChild(h("p", { class: "muted", text: "Every probability on this site is written down before the answer is known and checked afterwards. This is the running score. If it is not better than guessing, the page says so." }));
    function tile(label, value, sub) { return h("div", { class: "stat-tile" }, [h("p", { class: "stat-label", text: label }), h("p", { class: "stat-value", text: value }), sub ? h("p", { class: "stat-sub", text: sub }) : null]); }
    var beat = s.skill == null ? "—" : s.skill > 0 ? "Yes" : "Not yet";
    box.appendChild(h("div", { class: "stat-tiles" }, [
      tile("Called the right side", done.length ? right + " of " + done.length : "—", done.length ? Math.round(right / done.length * 100) + "% of settled questions (50% or more counts as calling yes)" : ""),
      tile("Economy, jobs and research", real.length ? realRight + " of " + real.length : "none yet", "questions settled from public data"),
      tile("Better than coin-flipping?", beat, s.mean_brier == null ? "" : "error score " + s.mean_brier + " against 0.25 for always saying 50% (lower is better)"),
      tile("Still open", String(openF.length), openF.length ? "next result about " + fmtDay(openF.map(function (f) { return f.resolves; }).sort()[0]) : "")
    ]));
    box.appendChild(h("p", { class: "muted small", text: "Early on, a handful of questions says little. A score worse than 0.25 over so few cases may be luck, but it is shown honestly." }));
    if (s.by_model) {
      var names = { "poisson-persistence-v1": "News attention, method 1 (until 19 Oct 2026)", "burst-persistence-v2": "News attention, method 2 (from 19 Oct 2026)", "indicator-v1": "Economy, jobs and research (from 20 Oct 2026)" };
      box.appendChild(table(["Method", "Open", "Settled", "Error score (lower is better)"], Object.keys(s.by_model).map(function (k) { var m = s.by_model[k]; return [names[k] || k, m.open, m.resolved, m.mean_brier == null ? "—" : m.mean_brier]; }), ""));
    }
    var openNew = openF.filter(function (f) { return f.context; });
    var chips = h("div", { class: "chips", role: "group", "aria-label": "Filter questions" });
    var list2 = h("div", { class: "q-list" });
    function draw() {
      clear(chips); clear(list2);
      [["all", "All"], ["economy", "Economy"], ["jobs", "Jobs"], ["research", "New research"], ["news", "News attention"]].forEach(function (d) { chips.appendChild(h("button", { type: "button", class: "chip" + (qDomain === d[0] ? " on" : ""), "aria-pressed": qDomain === d[0] ? "true" : "false", onclick: function () { qDomain = d[0]; draw(); }, text: d[1] })); });
      var shown = openNew.filter(function (f) { return qDomain === "all" || (qDomain === "news" ? f.kind !== "indicator" : f.domain === qDomain); });
      if (!shown.length) list2.appendChild(h("p", { class: "muted", text: "No open questions match." })); else shown.forEach(function (f) { list2.appendChild(questionCard(f)); });
    }
    draw();
    box.appendChild(h("h3", { text: "Open questions" })); box.appendChild(chips); box.appendChild(list2);
    var doneNew = done.filter(function (f) { return f.context; }).reverse(), doneOld = done.filter(function (f) { return !f.context; }), openOld = openF.filter(function (f) { return !f.context; });
    box.appendChild(h("h3", { text: "Settled" }));
    box.appendChild(doneNew.length ? h("div", { class: "q-list" }, doneNew.map(questionCard)) : h("p", { class: "muted", text: "Nothing settled yet from the current methods." }));
    if (doneOld.length || openOld.length) box.appendChild(h("details", { class: "agent-box" }, [h("summary", { text: "Earlier questions from method 1 (" + (doneOld.length + openOld.length) + ")" }),
      h("p", { class: "muted small", text: "Written before the method changed. They counted any word in the headline or summary, so several are ordinary words that appear every week. They stay in the record and are scored like the rest." }),
      table(["Question", "Probability", "Seen", "Outcome", "Error"], doneOld.map(function (f) { return [f.question, pct(f.p), f.void ? "—" : f.observed + " (needed " + f.threshold + ")", f.void ? "void" : f.outcome ? "Yes" : "No", f.void ? "—" : f.brier]; }), "None.")]));
    if (done.length >= 12) { box.appendChild(h("h3", { text: "Do the percentages mean what they say?" })); box.appendChild(table(["Said", "Questions", "Average stated", "Happened"], s.calibration.map(function (c) { return [c.range, c.n, c.mean_p == null ? "—" : pct(c.mean_p), c.observed == null ? "—" : pct(c.observed)]; }), "")); box.appendChild(h("p", { class: "muted small", text: "If “70%” questions happen about 70% of the time, the numbers are trustworthy." })); }
    else box.appendChild(h("p", { class: "muted small", text: "A check of whether “70%” questions happen about 70% of the time appears after 12 questions have settled." }));
  }

  // ----- about
  function renderAbout(box) {
    box.appendChild(h("h2", { class: "section-title", text: "How it works" }));
    box.appendChild(h("p", { text: "I built this to keep myself informed about the things that shape my work and life: the job market, the economy, investing, technology and research. It pulls public numbers (US labour and price data, interest rates, markets and Danish unemployment from FRED and Eurostat; paper counts from arXiv) and about 450 news stories a day, shows where each stands, and writes down a probability for the next figure. Then it checks itself." }));
    [["Descriptive, not advice.", "It shows what has happened and how likely simple models think the next number is. It does not tell anyone what to do, and it is not investment, career or other advice."],
     ["Predictions are written before the answer.", "Each probability is recorded with its reasoning, never edited, and scored afterwards. The history of forecasts.json is the audit trail."],
     ["Honest about what cannot be predicted.", "Each method is first tested on the full history of its series. Where it does no better than the long-run rate (as with daily stock and bond moves), the page falls back to that rate and says so."],
     ["Attention is not truth.", "A phrase being everywhere shows what outlets chose to write about, not that it is important or correct. Outlet ratings describe the outlet, not the story."],
     ["Small data.", "The news side has only a few weeks of history and about 450 stories a day, so early readings are noisy."]]
      .forEach(function (x) { box.appendChild(h("p", {}, [h("strong", { text: x[0] + " " }), x[1]])); });
    box.appendChild(h("h3", { text: "How the score works" }));
    box.appendChild(h("p", { text: "Each probability is scored with the Brier score, (probability − outcome)², where the outcome is 1 for yes and 0 for no. Always saying 50% scores 0.25, so lower than that beats guessing. This is the idea of strictly proper scoring rules from my paper " }, [])); 
    var last = box.lastChild; last.appendChild(h("a", { href: "papers/you-should-be-properly-scoring-your-odometry.html", text: "You Should Be Properly Scoring Your Odometry" })); last.appendChild(document.createTextNode(", applied to forecasts."));
    box.appendChild(h("p", { class: "muted small" }, ["Raw data: ", h("a", { href: "news/outlook.json", text: "outlook.json" }), ", ", h("a", { href: "news/signals.json", text: "signals.json" }), ", ", h("a", { href: "news/forecasts.json", text: "forecasts.json" }), ". Rebuilt daily."]));
  }

  function init() {
    var asof = ol && ol.updated ? ol.updated : sig.as_of;
    $("asof").textContent = "Updated " + fmtDay(asof) + (sig.provisional ? " · news history still building" : "");
    var tabs = $("sig-tabs"), host = $("sig-panels");
    TABS.forEach(function (t, i) {
      var b = h("button", { type: "button", role: "tab", id: "tab-" + t.id, "aria-controls": "panel-" + t.id, "aria-selected": "false", class: "sig-tab", text: t.title, onclick: function () { go(t.id); } });
      b.addEventListener("keydown", function (e) {
        var j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : null; if (j == null) return;
        e.preventDefault(); var n = TABS[(j + TABS.length) % TABS.length].id; go(n); tabBtns[n].focus();
      });
      tabs.appendChild(b); tabBtns[t.id] = b;
      var p = h("section", { class: "sig-panel", id: "panel-" + t.id, role: "tabpanel", "aria-labelledby": "tab-" + t.id, hidden: "hidden" });
      host.appendChild(p); panels[t.id] = p; p.hidden = true;
    });
    renderOverview(panels.overview);
    SECTIONS.forEach(function (s) { renderSection(s, panels[s.id]); });
    renderRecord(panels.record); renderAbout(panels.about);
    var start = (location.hash || "").slice(1);
    go(TABS.some(function (t) { return t.id === start; }) ? start : "overview");
    window.addEventListener("hashchange", function () { var x = location.hash.slice(1); if (panels[x]) go(x); });
    $("sig-loading").hidden = true; $("sig-body").hidden = false;
  }
  function getJson(u) { return fetch(u + "?v=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  Promise.all([getJson("news/signals.json"), getJson("news/forecasts.json"), getJson("news/outlook.json")]).then(function (r) { sig = r[0]; fc = r[1]; ol = r[2]; init(); })
    .catch(function () { $("sig-loading").textContent = "The outlook is not available right now. It is rebuilt daily; please try again later."; });
})();
