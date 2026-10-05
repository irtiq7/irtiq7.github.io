// Signals page: reads news/signals.json and news/forecasts.json (built by scripts/build-news.js).
// All text is inserted with textContent, never as HTML.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var STAGE = { early: ["Research only", "Appears in research sources, not yet in industry press"], spreading: ["Research + industry press", "Appears in research sources and in tech or business coverage"], mainstream: ["Industry press only", "Appears in tech or business coverage, with no research mentions this fortnight"] };
  var LEAN_CLASS = { "Left": "l2", "Lean Left": "l1", "Center": "c0", "Lean Right": "r1", "Right": "r2", "Not rated": "nr" };
  var LEAN_ORDER = ["Left", "Lean Left", "Center", "Lean Right", "Right", "Not rated"];
  var sig = null, fc = null, stageFilter = "all";

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
  function renderForecasts() {
    var s = fc.summary, list = fc.forecasts, box = clear($("forecasts"));
    var openF = list.filter(function (f) { return f.outcome === null && !f.void; }), done = list.filter(function (f) { return f.outcome !== null; }).reverse();
    var firstResult = openF.map(function (f) { return f.resolves; }).sort()[0];
    function tile(label, value, sub) { return h("div", { class: "stat-tile" }, [h("p", { class: "stat-label", text: label }), h("p", { class: "stat-value", text: value }), sub ? h("p", { class: "stat-sub", text: sub }) : null]); }
    box.appendChild(h("div", { class: "stat-tiles" }, [
      tile("Open questions", String(s.open), firstResult ? "first results after " + fmtDay(firstResult) : ""),
      tile("Resolved", String(s.resolved), s.voided ? s.voided + " voided (too little data)" : ""),
      tile("Brier score", s.mean_brier == null ? "—" : String(s.mean_brier), "lower is better; 0.25 = always saying 50%"),
      tile("Skill vs 50%", s.skill == null ? "—" : (s.skill > 0 ? "+" : "") + s.skill, "above 0 beats the benchmark")
    ]));
    box.appendChild(h("h3", { text: "Open questions" }));
    box.appendChild(table(["Question", "Probability", "Resolves", "Based on"], openF.map(function (f) { return [f.question, pct(f.p), fmtDay(f.resolves), f.basis === "emerging" ? "emerging list" : "most-discussed list"]; }), "No open questions."));
    box.appendChild(h("h3", { text: "Resolved" }));
    box.appendChild(table(["Question", "Probability", "Seen", "Outcome", "Brier"], done.map(function (f) { return f.void ? [f.question, pct(f.p), "—", "void", "—"] : [f.question, pct(f.p), f.observed + " (needed " + f.threshold + ")", f.outcome ? "Yes" : "No", f.brier]; }), "Nothing has resolved yet. Each question covers 7 days and is scored the day after."));
    if (s.resolved >= 12) {
      box.appendChild(h("h3", { text: "Calibration" }));
      box.appendChild(table(["Said", "Questions", "Average stated", "Happened"], s.calibration.map(function (c) { return [c.range, c.n, c.mean_p == null ? "—" : pct(c.mean_p), c.observed == null ? "—" : pct(c.observed)]; }), ""));
    } else box.appendChild(h("p", { class: "muted small", text: "A calibration table (did “70%” questions happen about 70% of the time?) appears after 12 questions have resolved." }));
  }

  function init() {
    $("asof").textContent = "Data as of " + fmtDay(sig.as_of) + (sig.provisional ? " · history still building" : "");
    renderIdeas(); renderMomentum(); renderMood(); renderAgreement(); renderForecasts();
    $("sig-loading").hidden = true; $("sig-body").hidden = false;
  }
  function getJson(u) { return fetch(u + "?v=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  Promise.all([getJson("news/signals.json"), getJson("news/forecasts.json")]).then(function (r) { sig = r[0]; fc = r[1]; init(); })
    .catch(function () { $("sig-loading").textContent = "The signals are not available right now. They are rebuilt daily; please try again later."; });
})();
