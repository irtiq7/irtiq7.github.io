// Signals page: reads news/signals.json and news/forecasts.json (built by scripts/build-news.js).
// All text is inserted with textContent, never as HTML.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var STAGE = { early: ["Research only", "Appears in research sources, not yet in industry press"], spreading: ["Research + industry press", "Appears in research sources and in tech or business coverage"], mainstream: ["Industry press only", "Appears in tech or business coverage, with no research mentions this fortnight"] };
  var LEAN_CLASS = { "Left": "l2", "Lean Left": "l1", "Center": "c0", "Lean Right": "r1", "Right": "r2", "Not rated": "nr" };
  var LEAN_ORDER = ["Left", "Lean Left", "Center", "Lean Right", "Right", "Not rated"];
  var sig = null, fc = null, stageFilter = "all", qDomain = "all";

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

  // ---------- emerging / most discussed
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
  function renderIdeas() {
    var prov = sig.provisional, list = prov ? sig.most_discussed : sig.emerging;
    $("ideas-title").textContent = prov ? "Most discussed ideas this week" : "Emerging ideas";
    $("ideas-lede").textContent = prov
      ? "Two-word phrases that several outlets used most this week. This is not yet a trend: spotting what is rising needs about three weeks of history, and the page has " + sig.baseline.items + " older stories on " + sig.baseline.days + " different days so far (it needs " + sig.baseline.needs + ")."
      : "Phrases used far more than usual by several independent outlets in the last 7 days, compared with the three weeks before.";
    var filters = clear($("stage-filters"));
    if (!prov) ["all", "early", "spreading", "mainstream"].forEach(function (s) {
      filters.appendChild(h("button", { type: "button", class: "chip" + (stageFilter === s ? " on" : ""), "aria-pressed": stageFilter === s ? "true" : "false", onclick: function () { stageFilter = s; renderIdeas(); }, text: s === "all" ? "All" : STAGE[s][0] }));
    });
    var box = clear($("ideas"));
    var shown = list.filter(function (e) { return prov || stageFilter === "all" || e.stage === stageFilter; });
    if (!shown.length) { box.appendChild(h("p", { class: "muted", text: prov ? "No phrase has been used by enough outlets yet." : "Nothing matches this filter right now." })); return; }
    shown.forEach(function (e) { box.appendChild(ideaCard(e, prov)); });
  }

  // ---------- momentum
  function renderMomentum() {
    var box = clear($("momentum"));
    if (sig.provisional) { box.appendChild(h("p", { class: "muted", text: "Topic momentum compares this week with the three weeks before, so it appears once the page has that history." })); return; }
    [["research", "Research"], ["tech", "Technology"], ["business", "Business"]].forEach(function (c) {
      var m = sig.momentum[c[0]];
      function list(rows, up) { return rows.length ? h("ul", { class: "mom-list" }, rows.map(function (r) { return h("li", {}, [h("strong", { text: (up ? "▲ " : "▼ ") + r.topic }), h("span", { class: "muted small", text: " " + (r.change > 0 ? "+" : "") + r.change + "% (" + r.recent + " vs " + r.base_per_week + " a week)" })]); })) : h("p", { class: "muted small", text: "None." }); }
      box.appendChild(h("div", { class: "mom-col" }, [h("h3", { text: c[1] }), h("h4", { text: "Rising" }), list(m.rising, true), h("h4", { text: "Falling" }), list(m.falling, false)]));
    });
  }

  // ---------- market mood
  function renderMood() {
    var m = sig.mood, box = clear($("mood")), avg = m.last7_average;
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
  function renderAgreement() {
    var box = clear($("agreement"));
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
  function indicatorCard(f) {
    var c = f.context, m = c.measure, r = c.reasoning, bt = r.backtest || {}, done = f.outcome !== null && !f.void, unit = m.unit;
    var per = m.freq === "monthly" ? "months" : "weeks", dirWord = r.q === "lower" ? "lower" : r.q === "above_avg" ? "above the bar" : "higher";
    var step1;
    if (r.method === "frequency") step1 = "Step 1, how often it happens. In the last " + (r.window_n || 12) + " comparable " + per + ", this fell in " + (r.window_hits == null ? "some" : r.window_hits) + " of them, which puts the chance at " + pct(r.model_p) + ". This series moves in steps, so it is mostly unchanged from one " + per.slice(0, -1) + " to the next.";
    else if (r.q === "above_avg") step1 = "Step 1, the pace. The bar is " + fmtVal(r.threshold, unit) + ", the average of the last " + r.win + " " + per + ". Recent values suggest about " + fmtVal(r.expected, unit) + " (the usual miss is about " + fmtDelta(r.sd, unit) + "), which gives a " + pct(r.model_p) + " chance of being above it.";
    else step1 = "Step 1, the trend. Over the last " + r.k + " " + per + " it has moved by " + fmtDelta(c.trend.change, unit) + ". Allowing for a little of that trend, the model expects about " + fmtVal(r.expected, unit) + " (the usual miss is about " + fmtDelta(r.sd, unit) + "), which gives a " + pct(r.model_p) + " chance that it ends " + dirWord + ".";
    var verdict = bt.skill > 0.1 ? "so it adds real information" : bt.skill >= 0 ? "so it adds only a little" : "so it did worse than the plain rate";
    var step2 = "Step 2, a test on history. The same method was run on " + (bt.n || 0).toLocaleString("en-US") + " earlier cases. It scored " + bt.brier_model + " (Brier score; lower is better) against " + bt.brier_base + " for simply saying the long-run rate of " + pct(bt.base) + ", " + verdict + ".";
    var step3 = r.weight <= 0.01 ? "Result: because the method showed no skill, this question uses the long-run rate, " + pct(r.final_p) + "." : "Result: the model's number is blended with the long-run rate (weight on the model " + r.weight + "), giving " + pct(r.final_p) + ".";
    var t = c.trend, stands = "Latest: " + fmtVal(c.latest.value, unit) + " (" + fmtPeriod(c.latest.date, m.freq) + "). Over the last " + t.over + " it changed by " + fmtDelta(t.change, unit) + ". Over the last year it ranged from " + fmtVal(t.low_52, unit) + " to " + fmtVal(t.high_52, unit) + ".";
    var body = [
      sect("What this measures", [h("p", { text: m.why }), h("p", { class: "muted small" }, ["Source: ", h("a", { href: m.source.url, rel: "noopener", target: "_blank", text: m.source.name }), m.lag ? ". New figures are " + m.lag + "." : "."])]),
      sect("Where it stands", [h("p", { text: stands }), line(c.history, r.q === "above_avg" ? f.threshold : null, unit)]),
      sect(done ? "How the probability was reached (written before the result)" : "How the probability was reached", bulletless([step1, step2, step3])),
      sect("What counts as yes", [h("p", { text: c.resolution })])
    ];
    if (done && f.result_note) body.unshift(sect("What happened", [h("p", { class: "q-result", text: (f.outcome ? "Yes. " : "No. ") + f.result_note }), h("p", { class: "muted small", text: "Probability said " + pct(f.p) + "; Brier score " + f.brier + " (0 is perfect, 0.25 is what always saying 50% would score)." })]));
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

  function renderForecasts() {
    var s = fc.summary, list = fc.forecasts, box = clear($("forecasts"));
    var isNew = function (f) { return (f.model === "burst-persistence-v2" || f.model === "indicator-v1") && f.context; };
    var inDomain = function (f) { return qDomain === "all" || (qDomain === "news" ? f.kind !== "indicator" : f.domain === qDomain); };
    var openF = list.filter(function (f) { return f.outcome === null && !f.void; }), done = list.filter(function (f) { return f.outcome !== null; }).reverse();
    var openNew = openF.filter(isNew).filter(inDomain), openOld = openF.filter(function (f) { return !isNew(f); }), doneNew = done.filter(isNew).filter(inDomain), doneOld = done.filter(function (f) { return !isNew(f); });
    var firstResult = openF.map(function (f) { return f.resolves; }).sort()[0];
    function tile(label, value, sub) { return h("div", { class: "stat-tile" }, [h("p", { class: "stat-label", text: label }), h("p", { class: "stat-value", text: value }), sub ? h("p", { class: "stat-sub", text: sub }) : null]); }
    box.appendChild(h("div", { class: "stat-tiles" }, [
      tile("Open questions", String(s.open), firstResult ? "first results after " + fmtDay(firstResult) : ""),
      tile("Resolved", String(s.resolved), s.voided ? s.voided + " voided (too little data)" : ""),
      tile("Brier score", s.mean_brier == null ? "—" : String(s.mean_brier), "lower is better; 0.25 = always saying 50%"),
      tile("Skill vs 50%", s.skill == null ? "—" : (s.skill > 0 ? "+" : "") + s.skill, "above 0 beats the benchmark")
    ]));
    if (s.by_model) {
      var names = { "poisson-persistence-v1": "News attention, method 1 (until 19 Oct 2026)", "burst-persistence-v2": "News attention, method 2 (from 19 Oct 2026)", "indicator-v1": "Economy, jobs and research (from 20 Oct 2026)" };
      box.appendChild(table(["Method", "Open", "Resolved", "Brier score"], Object.keys(s.by_model).map(function (k) { var m = s.by_model[k]; return [names[k] || k, m.open, m.resolved, m.mean_brier == null ? "—" : m.mean_brier]; }), ""));
    }
    if (fc.methods) {
      box.appendChild(h("details", { class: "agent-box" }, [h("summary", { text: "How the questions changed" })].concat(Object.keys(fc.methods).map(function (k) { return h("p", { class: "small" }, [h("strong", { text: (names2(k)) + ". " }), fc.methods[k]]); }))));
    }
    box.appendChild(h("h3", { text: "Open questions" }));
    var chips = h("div", { class: "chips", role: "group", "aria-label": "Filter questions" });
    [["all", "All"], ["economy", "Economy"], ["jobs", "Jobs"], ["research", "New research"], ["news", "News attention"]].forEach(function (d) {
      chips.appendChild(h("button", { type: "button", class: "chip" + (qDomain === d[0] ? " on" : ""), "aria-pressed": qDomain === d[0] ? "true" : "false", onclick: function () { qDomain = d[0]; renderForecasts(); }, text: d[1] }));
    });
    box.appendChild(chips);
    box.appendChild(h("p", { class: "muted small", text: "Open each question for what the phrase is, the stories behind it, how the probability was worked out, and exactly what counts as yes." }));
    box.appendChild(openNew.length ? h("div", { class: "q-list" }, openNew.map(questionCard)) : h("p", { class: "muted", text: "No open questions from the current method yet. A new set is written each week." }));
    if (openOld.length) box.appendChild(h("details", { class: "agent-box" }, [h("summary", { text: "Earlier questions from method 1 (" + openOld.length + " open)" }),
      h("p", { class: "muted small", text: "These were written before the method change. They counted any word in the headline or summary, so several are ordinary words that appear every week. They stay in the record and are scored like the rest." }),
      table(["Question", "Probability", "Resolves"], openOld.map(function (f) { return [f.question, pct(f.p), fmtDay(f.resolves)]; }), "None.")]));
    box.appendChild(h("h3", { text: "Resolved" }));
    box.appendChild(doneNew.length ? h("div", { class: "q-list" }, doneNew.map(questionCard)) : h("p", { class: "muted", text: "No question from the current method has resolved yet. Each covers 7 days (or 14 for research-to-industry questions) and is scored the day after." }));
    if (doneOld.length) box.appendChild(h("details", { class: "agent-box" }, [h("summary", { text: "Resolved questions from method 1 (" + doneOld.length + ")" }),
      table(["Question", "Probability", "Seen", "Outcome", "Brier"], doneOld.map(function (f) { return f.void ? [f.question, pct(f.p), "—", "void", "—"] : [f.question, pct(f.p), f.observed + " (needed " + f.threshold + ")", f.outcome ? "Yes" : "No", f.brier]; }), "None.")]));
    if (s.resolved >= 12) {
      box.appendChild(h("h3", { text: "Calibration" }));
      box.appendChild(table(["Said", "Questions", "Average stated", "Happened"], s.calibration.map(function (c) { return [c.range, c.n, c.mean_p == null ? "—" : pct(c.mean_p), c.observed == null ? "—" : pct(c.observed)]; }), ""));
    } else box.appendChild(h("p", { class: "muted small", text: "A calibration table (did “70%” questions happen about 70% of the time?) appears after 12 questions have resolved." }));
  }
  function names2(k) { return k === "poisson-persistence-v1" ? "News attention, method 1" : k === "burst-persistence-v2" ? "News attention, method 2" : k === "indicator-v1" ? "Economy, jobs and research" : k; }

  function init() {
    $("asof").textContent = "Data as of " + fmtDay(sig.as_of) + (sig.provisional ? " · history still building" : "");
    renderIdeas(); renderMomentum(); renderMood(); renderAgreement(); renderForecasts();
    $("sig-loading").hidden = true; $("sig-body").hidden = false;
  }
  function getJson(u) { return fetch(u + "?v=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  Promise.all([getJson("news/signals.json"), getJson("news/forecasts.json")]).then(function (r) { sig = r[0]; fc = r[1]; init(); })
    .catch(function () { $("sig-loading").textContent = "The signals are not available right now. They are rebuilt daily; please try again later."; });
})();
