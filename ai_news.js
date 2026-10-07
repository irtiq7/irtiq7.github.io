// AI news page: reads news/latest.json and news/trends.json (built by scripts/build-news.js).
// All feed text is inserted with textContent, never as HTML.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var LEAN_ORDER = ["Left", "Lean Left", "Center", "Lean Right", "Right", "Not rated"];
  var LEAN_CLASS = { "Left": "l2", "Lean Left": "l1", "Center": "c0", "Lean Right": "r1", "Right": "r2", "Not rated": "nr" };
  var PALETTE = ["#00f0ff", "#ff2bd6", "#fcee0a", "#7cff6b", "#ff8a3d", "#a78bfa", "#4da3ff", "#ff6b81", "#2dd4bf", "#c4b5fd"];
  var TAB_NAMES = { research: "Research", tech: "Technology", business: "Business" };

  var data = null, trends = null;
  var state = { cat: "tech", q: "", lean: "", sources: {}, topics: {}, view: "all", sort: "new", limit: 10, images: true, chart: "donut", trendDays: 7, hiddenSeries: {} };
  var store = { saved: {}, read: {} };

  // ---------- storage (every access guarded: it can throw in private windows)
  function load(key, fallback) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  store.saved = load("aiNews.saved", {});
  store.read = load("aiNews.read", {});
  var prefs = load("aiNews.prefs", {});
  ["cat", "limit", "images", "sort"].forEach(function (k) { if (prefs[k] !== undefined) state[k] = prefs[k]; });
  if (/^#(research|tech|business)$/.test(location.hash)) state.cat = location.hash.slice(1);
  function savePrefs() { save("aiNews.prefs", { cat: state.cat, limit: state.limit, images: state.images, sort: state.sort }); }
  function trim(map, max) { var k = Object.keys(map); if (k.length > max) k.slice(0, k.length - max).forEach(function (x) { delete map[x]; }); }

  // ---------- tiny DOM helper
  function h(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "class") n.className = props[k];
      else if (k === "text") n.textContent = props[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), props[k]);
      else if (props[k] !== false && props[k] != null) n.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function svg(tag, attrs, kids) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function ago(iso) {
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    if (s < 86400 * 14) return Math.round(s / 86400) + " d ago";
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }

  // ---------- data access and filtering
  function src(item) { return data.sources[item.sourceId] || { name: item.sourceId, lean: { label: "Not rated" }, category: item.category }; }
  function leanOf(item) { return src(item).lean.label; }
  function searchText(i) { return (i.title + " " + i.summary + " " + i.keywords.join(" ") + " " + src(i).name).toLowerCase(); }
  function active(map) { return Object.keys(map).filter(function (k) { return map[k]; }); }

  // skip: which filter to leave out, so chips / charts can show what is still available
  function filtered(skip) {
    var q = state.q.trim().toLowerCase(), terms = q ? q.split(/\s+/) : [], srcs = active(state.sources), tops = active(state.topics);
    return data.items.filter(function (i) {
      if (i.category !== state.cat) return false;
      if (skip !== "q" && terms.length) { var t = searchText(i); if (!terms.every(function (w) { return t.indexOf(w) >= 0; })) return false; }
      if (skip !== "lean" && state.lean && leanOf(i) !== state.lean) return false;
      if (skip !== "sources" && srcs.length && srcs.indexOf(i.sourceId) < 0) return false;
      if (skip !== "topics" && tops.length && !tops.every(function (t) { return i.topics.indexOf(t) >= 0; })) return false;
      if (state.view === "unread" && store.read[i.id]) return false;
      if (state.view === "saved" && !store.saved[i.id]) return false;
      return true;
    });
  }
  function sorter() {
    if (state.sort === "short") return function (a, b) { return (a.readingMin == null) - (b.readingMin == null) || (a.readingMin || 0) - (b.readingMin || 0) || (a.published < b.published ? 1 : -1); };
    return function (a, b) { return a.published < b.published ? 1 : -1; };
  }
  function limited(items) {
    var count = {}, cmp = sorter();
    return items.slice().sort(cmp).filter(function (i) { count[i.sourceId] = (count[i.sourceId] || 0) + 1; return count[i.sourceId] <= state.limit; });
  }

  // ---------- rendering
  var UW = "underwater sensing";
  function uwActive() { var t = active(state.topics); return state.cat === "research" && t.length === 1 && t[0] === UW; }
  function renderTracker() {
    var week = Date.now() - 7 * 864e5, n = 0, total = 0;
    data.items.forEach(function (i) { if (i.topics.indexOf(UW) >= 0) { total++; if (Date.parse(i.published) >= week) n++; } });
    $("uw-count").textContent = "(" + n + " this week, " + total + " total)";
    $("uw-tracker").setAttribute("aria-pressed", uwActive() ? "true" : "false");
    $("uw-tracker").classList.toggle("on", uwActive());
  }
  function renderAll() { renderTabs(); renderChips(); renderSpectrum(); renderCharts(); renderList(); renderTracker(); }

  function renderTabs() {
    var tabs = document.querySelectorAll("[data-cat]");
    Array.prototype.forEach.call(tabs, function (t) {
      var on = t.getAttribute("data-cat") === state.cat;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      var n = data.items.filter(function (i) { return i.category === t.getAttribute("data-cat"); }).length;
      t.textContent = TAB_NAMES[t.getAttribute("data-cat")] + " (" + n + ")";
    });
  }

  function chip(label, count, on, onclick, extra) {
    return h("button", { type: "button", class: "chip" + (on ? " on" : "") + (extra ? " " + extra : ""), "aria-pressed": on ? "true" : "false", onclick: onclick }, [label + (count != null ? " " + count : "")]);
  }
  function renderChips() {
    // sources
    var base = filtered("sources"), counts = {};
    base.forEach(function (i) { counts[i.sourceId] = (counts[i.sourceId] || 0) + 1; });
    var ids = Object.keys(data.sources).filter(function (id) { return data.sources[id].category === state.cat && (counts[id] || state.sources[id]); }).sort(function (a, b) { return (counts[b] || 0) - (counts[a] || 0); });
    var box = clear($("source-chips"));
    ids.forEach(function (id) { box.appendChild(chip(data.sources[id].name, counts[id] || 0, !!state.sources[id], function () { state.sources[id] = !state.sources[id]; renderAll(); })); });
    // topics
    var tc = {};
    filtered("topics").forEach(function (i) { i.topics.forEach(function (t) { tc[t] = (tc[t] || 0) + 1; }); });
    var tb = clear($("topic-chips"));
    Object.keys(tc).concat(active(state.topics).filter(function (t) { return !(t in tc); })).sort(function (a, b) { return (tc[b] || 0) - (tc[a] || 0); }).slice(0, 14).forEach(function (t) {
      tb.appendChild(chip(t, tc[t] || 0, !!state.topics[t], function () { state.topics[t] = !state.topics[t]; renderAll(); }));
    });
  }

  function renderSpectrum() {
    var items = filtered("lean"), counts = {};
    items.forEach(function (i) { var l = leanOf(i); counts[l] = (counts[l] || 0) + 1; });
    var total = items.length, bar = clear($("spectrum-bar")), legend = clear($("spectrum-legend"));
    if (!total) { bar.appendChild(h("span", { class: "sp-empty", text: "No stories match." })); return; }
    LEAN_ORDER.forEach(function (l) {
      if (!counts[l]) return;
      var pct = (counts[l] / total) * 100;
      var seg = h("button", { type: "button", class: "sp-seg " + LEAN_CLASS[l] + (state.lean === l ? " on" : ""), style: "flex-basis:" + pct + "%", "aria-pressed": state.lean === l ? "true" : "false", title: l + ": " + counts[l] + " stories (" + Math.round(pct) + "%). Click to filter.", onclick: function () { state.lean = state.lean === l ? "" : l; $("lean-select").value = state.lean; renderAll(); } });
      bar.appendChild(seg);
      legend.appendChild(h("li", {}, [h("span", { class: "sw " + LEAN_CLASS[l], "aria-hidden": "true" }), l + " ", h("strong", { text: String(counts[l]) }), h("span", { class: "pct", text: " " + Math.round(pct) + "%" })]));
    });
  }

  // ----- topic mix: donut or bars (both clickable), plus 7/30-day trends
  function renderCharts() {
    var tc = {}, total = 0;
    filtered("topics").forEach(function (i) { i.topics.forEach(function (t) { tc[t] = (tc[t] || 0) + 1; total++; }); });
    var tops = Object.keys(tc).sort(function (a, b) { return tc[b] - tc[a]; }).slice(0, 8);
    var host = clear($("topic-chart"));
    if (!tops.length) { host.appendChild(h("p", { class: "muted", text: "No topics to chart for the current filters." })); }
    else if (state.chart === "donut") host.appendChild(donut(tops, tc, total)); else host.appendChild(bars(tops, tc));
    Array.prototype.forEach.call(document.querySelectorAll("[data-chart]"), function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-chart") === state.chart ? "true" : "false"); });
    renderTrends();
  }
  function donut(tops, tc, total) {
    var sum = tops.reduce(function (a, t) { return a + tc[t]; }, 0), R = 15.9155, off = 25;
    var s = svg("svg", { viewBox: "0 0 42 42", class: "donut", role: "img", "aria-label": "Topic mix of the current stories" });
    tops.forEach(function (t, k) {
      var pct = tc[t] / sum * 100;
      var c = svg("circle", { cx: 21, cy: 21, r: R, fill: "none", "stroke-width": 6, stroke: PALETTE[k % PALETTE.length], "stroke-dasharray": pct.toFixed(2) + " " + (100 - pct).toFixed(2), "stroke-dashoffset": off.toFixed(2), class: "donut-seg" + (state.topics[t] ? " on" : "") });
      c.appendChild(svg("title", {}, [document.createTextNode(t + ": " + tc[t])]));
      c.addEventListener("click", function () { state.topics[t] = !state.topics[t]; renderAll(); });
      s.appendChild(c); off -= pct;
    });
    var t = svg("text", { x: 21, y: 22.4, "text-anchor": "middle", class: "donut-total" }); t.textContent = String(total); s.appendChild(t);
    var legend = h("ul", { class: "legend" }, tops.map(function (tp, k) {
      return h("li", {}, [h("button", { type: "button", class: "legend-btn" + (state.topics[tp] ? " on" : ""), "aria-pressed": state.topics[tp] ? "true" : "false", onclick: function () { state.topics[tp] = !state.topics[tp]; renderAll(); } }, [h("span", { class: "sw", style: "background:" + PALETTE[k % PALETTE.length] }), tp + " ", h("strong", { text: String(tc[tp]) })])]);
    }));
    return h("div", { class: "donut-wrap" }, [s, legend]);
  }
  function bars(tops, tc) {
    var max = tc[tops[0]];
    return h("div", { class: "bars" }, tops.map(function (t) {
      return h("button", { type: "button", class: "bar-row" + (state.topics[t] ? " on" : ""), "aria-pressed": state.topics[t] ? "true" : "false", onclick: function () { state.topics[t] = !state.topics[t]; renderAll(); } },
        [h("span", { class: "bar-label", text: t }), h("span", { class: "bar-track" }, [h("span", { class: "bar-fill", style: "width:" + (tc[t] / max * 100) + "%" })]), h("strong", { text: String(tc[t]) })]);
    }));
  }
  function renderTrends() {
    var host = clear($("trend-chart"));
    var cat = trends && trends.categories && trends.categories[state.cat];
    if (!cat || !Object.keys(cat).length) { host.appendChild(h("p", { class: "muted", text: "Trend data builds up as the daily snapshots accumulate." })); return; }
    var n = state.trendDays, days = trends.days.slice(-n), names = Object.keys(cat).slice(0, 6);
    var series = names.map(function (t) { return { name: t, v: cat[t].slice(-n) }; });
    var shown = series.filter(function (s) { return !state.hiddenSeries[s.name]; });
    var max = Math.max(1, Math.max.apply(null, shown.map(function (s) { return Math.max.apply(null, s.v); }).concat([1])));
    var W = 520, H = 190, L = 28, B = 22, T = 8, Rr = 8, iw = W - L - Rr, ih = H - T - B;
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, class: "trend", role: "img", "aria-label": "Topic mentions per day, last " + n + " days" });
    [0, 0.5, 1].forEach(function (f) {
      var y = T + ih - f * ih;
      s.appendChild(svg("line", { x1: L, x2: W - Rr, y1: y, y2: y, class: "grid" }));
      var tx = svg("text", { x: L - 4, y: y + 3, "text-anchor": "end", class: "axis" }); tx.textContent = String(Math.round(max * f)); s.appendChild(tx);
    });
    [0, Math.floor((n - 1) / 2), n - 1].forEach(function (k) {
      var tx = svg("text", { x: L + (n === 1 ? 0 : k / (n - 1)) * iw, y: H - 6, "text-anchor": k === 0 ? "start" : k === n - 1 ? "end" : "middle", class: "axis" });
      tx.textContent = days[k].slice(5); s.appendChild(tx);
    });
    series.forEach(function (se, idx) {
      if (state.hiddenSeries[se.name]) return;
      var pts = se.v.map(function (v, k) { return (L + (n === 1 ? 0 : k / (n - 1)) * iw).toFixed(1) + "," + (T + ih - v / max * ih).toFixed(1); });
      s.appendChild(svg("polyline", { points: pts.join(" "), fill: "none", stroke: PALETTE[idx % PALETTE.length], "stroke-width": 2, "stroke-linejoin": "round" }));
      se.v.forEach(function (v, k) {
        var c = svg("circle", { cx: L + (n === 1 ? 0 : k / (n - 1)) * iw, cy: T + ih - v / max * ih, r: 3, fill: PALETTE[idx % PALETTE.length], class: "pt" });
        c.appendChild(svg("title", {}, [document.createTextNode(se.name + ", " + days[k] + ": " + v)])); s.appendChild(c);
      });
    });
    var legend = h("ul", { class: "legend inline" }, series.map(function (se, idx) {
      return h("li", {}, [h("button", { type: "button", class: "legend-btn" + (state.hiddenSeries[se.name] ? " off" : ""), "aria-pressed": state.hiddenSeries[se.name] ? "false" : "true", onclick: function () { state.hiddenSeries[se.name] = !state.hiddenSeries[se.name]; renderTrends(); } }, [h("span", { class: "sw", style: "background:" + PALETTE[idx % PALETTE.length] }), se.name])]);
    }));
    host.appendChild(s); host.appendChild(legend);
    Array.prototype.forEach.call(document.querySelectorAll("[data-days]"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-days")) === String(state.trendDays) ? "true" : "false"); });
  }

  // ----- cards
  function card(i) {
    var s = src(i), lean = s.lean || { label: "Not rated" }, isRead = !!store.read[i.id], isSaved = !!store.saved[i.id];
    var meta = [h("span", { class: "src", text: s.name }), h("span", { class: "lean " + LEAN_CLASS[lean.label], title: "Rating of the outlet, not of this article" , text: lean.label })];
    if (s.paywalled) meta.push(h("span", { class: "tag", title: "May require a subscription; only the feed's own blurb is shown", text: "paywalled" }));
    var info = [h("time", { datetime: i.published, title: new Date(i.published).toLocaleString("en-GB"), text: ago(i.published) })];
    if (i.readingMin) info.push(h("span", { text: i.readingMin + " min read" }));
    var more = [];
    if (i.keywords.length) more.push(h("p", {}, [h("strong", { text: "Key terms: " }), i.keywords.join(", ")]));
    var basis = [h("strong", { text: "About this source: " }), lean.label + (lean.basis ? " — " + lean.basis : "") + ". "];
    if (lean.url) basis.push(h("a", { href: lean.url, rel: "noopener", target: "_blank", text: "See the rating" }));
    more.push(h("p", {}, basis));
    more.push(h("p", { class: "muted", text: "The lean label describes the outlet, not this article. The preview is an automatic extract of the first key sentences." + (s.paywalled ? " This outlet is paywalled, so the preview comes from its own feed blurb." : "") }));
    return h("article", { class: "nc" + (isRead ? " is-read" : ""), "data-id": i.id }, [
      state.images && i.image ? h("img", { class: "nc-img", src: i.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer", onerror: function (e) { e.target.remove(); } }) : null,
      h("div", { class: "nc-meta" }, meta),
      h("div", { class: "nc-info" }, info),
      h("h3", {}, [h("a", { href: i.url, rel: "noopener", target: "_blank", onclick: function () { markRead(i.id, true); }, text: i.title })]),
      h("p", { class: "nc-sum" + (i.summary ? "" : " muted"), text: i.summary || "No preview from this source. Open the story to read it." }),
      i.topics.length ? h("div", { class: "nc-topics" }, i.topics.slice(0, 4).map(function (t) { return chip(t, null, !!state.topics[t], function () { state.topics[t] = !state.topics[t]; renderAll(); }, "small"); })) : null,
      h("details", { class: "nc-more" }, [h("summary", { text: "Quick look" })].concat(more)),
      h("div", { class: "nc-actions" }, [
        h("button", { type: "button", class: "mini" + (isSaved ? " on" : ""), "aria-pressed": isSaved ? "true" : "false", onclick: function () { toggleSaved(i.id); }, text: isSaved ? "★ Saved" : "☆ Save" }),
        h("button", { type: "button", class: "mini", "aria-pressed": isRead ? "true" : "false", onclick: function () { markRead(i.id, !store.read[i.id]); }, text: isRead ? "Mark unread" : "Mark read" }),
        h("a", { class: "mini", href: i.url, rel: "noopener", target: "_blank", text: "Open ↗" })
      ])
    ]);
  }
  function toggleSaved(id) { if (store.saved[id]) delete store.saved[id]; else store.saved[id] = 1; trim(store.saved, 1000); save("aiNews.saved", store.saved); renderList(); }
  function markRead(id, on) { if (on) store.read[id] = 1; else delete store.read[id]; trim(store.read, 3000); save("aiNews.read", store.read); if (state.view === "unread" || !on) renderList(); else { var el = document.querySelector('[data-id="' + id + '"]'); if (el) el.classList.add("is-read"); } }

  function renderList() {
    var list = limited(filtered()), box = clear($("news-list"));
    var shownLabel = list.length + " of " + filtered().length + " stories";
    $("result-count").textContent = shownLabel + (state.view === "saved" ? " saved" : "");
    if (!list.length) {
      box.appendChild(h("p", { class: "empty" }, [state.view === "saved" ? "You have not saved any stories in this section yet." : "No stories match these filters. ", h("button", { type: "button", class: "mini", onclick: resetFilters, text: "Reset filters" })]));
      return;
    }
    list.forEach(function (i) { box.appendChild(card(i)); });
  }

  // ---------- read aloud (replaces the old static audio files)
  var speaking = false;
  function speak() {
    var syn = window.speechSynthesis;
    if (!syn) return;
    if (speaking) { syn.cancel(); speaking = false; $("tts").textContent = "▶ Read top headlines"; return; }
    var list = limited(filtered()).slice(0, 8);
    if (!list.length) return;
    speaking = true; $("tts").textContent = "■ Stop reading";
    list.forEach(function (i, k) {
      var first = (i.summary.match(/^.*?[.!?](\s|$)/) || [""])[0];
      var u = new SpeechSynthesisUtterance("Story " + (k + 1) + ". " + src(i).name + ". " + i.title + ". " + first);
      u.rate = 1.02; if (k === list.length - 1) u.onend = function () { speaking = false; $("tts").textContent = "▶ Read top headlines"; };
      syn.speak(u);
    });
  }

  function resetFilters() {
    state.q = ""; state.lean = ""; state.sources = {}; state.topics = {}; state.view = "all";
    $("q").value = ""; $("lean-select").value = ""; setView("all"); renderAll();
  }
  function setView(v) { state.view = v; Array.prototype.forEach.call(document.querySelectorAll("[data-view]"), function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-view") === v ? "true" : "false"); }); }

  // ---------- wiring
  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-cat]"), function (t) {
      t.addEventListener("click", function () { state.cat = t.getAttribute("data-cat"); state.sources = {}; state.topics = {}; state.lean = ""; $("lean-select").value = ""; savePrefs(); history.replaceState(null, "", "#" + state.cat); renderAll(); });
      t.addEventListener("keydown", function (e) {
        var order = ["research", "tech", "business"], k = order.indexOf(state.cat);
        if (e.key === "ArrowRight") k = (k + 1) % 3; else if (e.key === "ArrowLeft") k = (k + 2) % 3; else return;
        state.cat = order[k]; state.sources = {}; state.topics = {}; savePrefs(); renderAll(); document.querySelector('[data-cat="' + state.cat + '"]').focus();
      });
    });
    var qTimer; $("q").addEventListener("input", function () { clearTimeout(qTimer); var v = this.value; qTimer = setTimeout(function () { state.q = v; renderAll(); }, 150); });
    $("lean-select").addEventListener("change", function () { state.lean = this.value; renderAll(); });
    $("sort-select").value = state.sort; $("sort-select").addEventListener("change", function () { state.sort = this.value; savePrefs(); renderList(); });
    $("limit-select").value = String(state.limit); $("limit-select").addEventListener("change", function () { state.limit = parseInt(this.value, 10); savePrefs(); renderAll(); });
    $("toggle-images").checked = state.images; $("toggle-images").addEventListener("change", function () { state.images = this.checked; savePrefs(); renderList(); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-view]"), function (b) { b.addEventListener("click", function () { setView(b.getAttribute("data-view")); renderAll(); }); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-chart]"), function (b) { b.addEventListener("click", function () { state.chart = b.getAttribute("data-chart"); renderCharts(); }); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-days]"), function (b) { b.addEventListener("click", function () { state.trendDays = parseInt(b.getAttribute("data-days"), 10); renderTrends(); }); });
    $("uw-tracker").addEventListener("click", function () {
      if (uwActive()) { state.topics = {}; }
      else { state.cat = "research"; state.sources = {}; state.lean = ""; state.q = ""; state.sort = "new"; state.view = "all"; state.topics = {}; state.topics[UW] = true; $("q").value = ""; $("lean-select").value = ""; $("sort-select").value = "new"; setView("all"); savePrefs(); history.replaceState(null, "", "#research"); }
      renderAll();
    });
    $("reset-filters").addEventListener("click", resetFilters);
    if (window.speechSynthesis) $("tts").addEventListener("click", speak); else $("tts").hidden = true;
    window.addEventListener("beforeunload", function () { if (window.speechSynthesis) speechSynthesis.cancel(); });
  }

  function fetchJson(url) { return fetch(url + "?v=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function stamp() {
    var n = data.items.length, s = Object.keys(data.sources).length;
    $("updated").textContent = "Updated " + ago(data.generated_at) + " · " + n + " stories from " + s + " sources";
    $("lean-note").textContent = data.lean_note || "";
  }
  function init() {
    $("today").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    setView("all"); wire();
    Promise.all([fetchJson("news/latest.json"), fetchJson("news/trends.json").catch(function () { return null; })]).then(function (r) {
      data = r[0]; trends = r[1];
      $("app-loading").hidden = true; $("app-body").hidden = false;
      data.items.forEach(function (i) { i.keywords = i.keywords || []; i.topics = i.topics || []; i.summary = i.summary || ""; });
      stamp(); renderAll();
      // refresh quietly every 30 minutes; only re-render when the snapshot changed
      setInterval(function () {
        fetchJson("news/latest.json").then(function (d) { if (d.generated_at !== data.generated_at) { d.items.forEach(function (i) { i.keywords = i.keywords || []; i.topics = i.topics || []; i.summary = i.summary || ""; }); data = d; stamp(); renderAll(); } }).catch(function () {});
      }, 30 * 60 * 1000);
    }).catch(function () {
      $("app-loading").textContent = "The news snapshot is not available right now. It is rebuilt daily; please try again later.";
    });
  }
  init();
})();
