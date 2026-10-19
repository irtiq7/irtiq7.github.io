// Art Deco World Map: pins for buildings, stations and posters, a gallery of the same items, a details panel
// and a pan-and-zoom viewer. Data comes from artdeco/places.json. Previews load from Wikimedia Commons and link back to their source.
// All text from the data is inserted with textContent, and only https links are used.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var DATA_URL = "artdeco/places.json";
  var CATS = {
    tower: { label: "Skyscrapers & offices", color: "#00f0ff" },
    station: { label: "Stations & transport", color: "#fcee0a" },
    theatre: { label: "Theatres & cinemas", color: "#ff2bd6" },
    hotel: { label: "Hotels & leisure", color: "#ff8a3d" },
    shop: { label: "Shops & markets", color: "#ff6b81" },
    civic: { label: "Civic & cultural", color: "#7cff6b" },
    religious: { label: "Places of worship", color: "#a78bfa" },
    bridge: { label: "Bridges & engineering", color: "#4da3ff" },
    monument: { label: "Monuments & landmarks", color: "#2dd4bf" },
    home: { label: "Homes & apartments", color: "#c4b5fd" },
    district: { label: "Districts & cities", color: "#e8d28a" },
    poster: { label: "Posters", color: "#ffd479", poster: true },
    other: { label: "Other", color: "#9ba8cc" }
  };
  var data = [], byId = {}, filtered = [], on = {}, query = "", view = "map", current = null;
  var map = null, cluster = null, markers = {}, firstFit = true;

  // ---------- small helpers
  function h(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function safe(u) { return typeof u === "string" && /^https:\/\/[a-z0-9.\-]+\//i.test(u) ? u : ""; }
  function link(text, url) { var u = safe(url); return u ? h("a", { href: u, rel: "noopener", target: "_blank", text: text }) : null; }
  // Wikimedia serves the file at the width asked for (or the original when it is smaller)
  function imgUrl(file, w) { return "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(file.replace(/ /g, "_")) + "?width=" + w; }
  function catOf(it) { return CATS[it.cat] || CATS.other; }
  function sub(it) { return [it.place, it.country].filter(Boolean).join(", "); }

  // ---------- load and check the data
  function clean(list) {
    var out = [], seen = {};
    list.forEach(function (it, i) {
      if (!it || typeof it.title !== "string" || !isFinite(it.lat) || !isFinite(it.lon) || !it.image || typeof it.image.file !== "string") return;
      if (Math.abs(it.lat) > 90 || Math.abs(it.lon) > 180) return;
      var id = String(it.id || "item-" + i).replace(/[^a-z0-9\-_]/gi, "-"); while (seen[id]) id += "-2"; seen[id] = 1; it.id = id;
      if (!CATS[it.cat]) it.cat = "other";
      it.facts = Array.isArray(it.facts) ? it.facts.filter(function (f) { return Array.isArray(f) && f.length === 2 && f[1]; }) : [];
      out.push(it);
    });
    return out;
  }

  // ---------- filters
  function haystack(it) { return (it.title + " " + sub(it) + " " + (it.by || "") + " " + (it.summary || "") + " " + it.facts.map(function (f) { return f[1]; }).join(" ")).toLowerCase(); }
  function applyFilter() {
    var q = query.trim().toLowerCase(), terms = q ? q.split(/\s+/) : [];
    filtered = data.filter(function (it) {
      if (!on[it.cat]) return false;
      if (!terms.length) return true;
      var hs = it._hs || (it._hs = haystack(it));
      return terms.every(function (t) { return hs.indexOf(t) >= 0; });
    });
    var posters = filtered.filter(function (it) { return it.kind === "poster"; }).length, places = filtered.length - posters;
    $("ad-count").textContent = places + " places and " + posters + " posters shown" + (filtered.length === data.length ? "" : " (of " + data.length + ")") + ".";
    $("ad-empty").hidden = filtered.length > 0;
    renderGallery(); updateMarkers();
    if (current && filtered.indexOf(current) < 0) { current = null; clear($("ad-panel")).appendChild(h("p", { class: "ad-hint", text: "Select a pin on the map, or a card in the gallery, to see its details here." })); }
  }
  function buildChips() {
    var box = clear($("ad-chips")), counts = {};
    data.forEach(function (it) { counts[it.cat] = (counts[it.cat] || 0) + 1; });
    Object.keys(CATS).filter(function (k) { return counts[k]; }).forEach(function (k) {
      on[k] = true;
      var b = h("button", { type: "button", class: "ad-chip" + (CATS[k].poster ? " poster" : ""), "aria-pressed": "true", style: "--c:" + CATS[k].color, onclick: function () {
        on[k] = !on[k]; b.setAttribute("aria-pressed", on[k] ? "true" : "false"); applyFilter();
      } }, [h("span", { class: "sw" }), CATS[k].label + " " + counts[k]]);
      box.appendChild(b);
    });
  }

  // ---------- map
  function pinIcon(it, active) {
    var c = catOf(it);
    return L.divIcon({ className: "ad-pin" + (c.poster ? " poster" : "") + (active ? " on" : ""), html: '<span style="--c:' + c.color + '"></span>', iconSize: [28, 28], iconAnchor: [14, 14] });
  }
  function initMap() {
    if (!window.L || !L.markerClusterGroup) return false;
    try {
      map = L.map("ad-map", { worldCopyJump: true, minZoom: 2, maxZoom: 18, zoomSnap: 0.5 }).setView([28, 12], 2);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
      cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 42, spiderfyOnMaxZoom: true });
      map.addLayer(cluster);
      data.forEach(function (it) {
        var m = L.marker([it.lat, it.lon], { icon: pinIcon(it, false), title: it.title, alt: it.title, keyboard: true });
        m.on("click", function () { select(it, { fromMap: true }); });
        markers[it.id] = m;
      });
      return true;
    } catch (e) { map = null; return false; }
  }
  function updateMarkers() {
    if (!map) return;
    cluster.clearLayers();
    var layers = filtered.map(function (it) { return markers[it.id]; }).filter(Boolean);
    cluster.addLayers(layers);
    if (firstFit && layers.length) { firstFit = false; fitAll(); }
  }
  function fitAll() { if (!map || !filtered.length) return; map.fitBounds(L.latLngBounds(filtered.map(function (it) { return [it.lat, it.lon]; })).pad(0.05), { maxZoom: 5 }); }
  function showOnMap(it) {
    if (!map || !markers[it.id]) return;
    setView("map");
    if (cluster.hasLayer(markers[it.id])) cluster.zoomToShowLayer(markers[it.id], function () { map.panTo([it.lat, it.lon]); });
    else map.setView([it.lat, it.lon], Math.max(map.getZoom(), 9));
  }

  // ---------- gallery
  function renderGallery() {
    var ul = clear($("ad-gallery"));
    filtered.forEach(function (it) {
      var b = h("button", { type: "button", class: "ad-card" + (it === current ? " on" : ""), "data-id": it.id, "aria-label": it.title + ", " + sub(it), onclick: function () { select(it, { fromGallery: true }); } }, [
        h("span", { class: "th" }, [h("img", { src: imgUrl(it.image.file, 500), alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer", onerror: function (e) { e.target.style.visibility = "hidden"; } })]),
        h("span", { class: "tx" }, [h("span", { class: "ti", text: it.title }), h("span", { class: "su", text: sub(it) + (it.date ? " · " + it.date : "") })])
      ]);
      ul.appendChild(h("li", {}, [b]));
    });
  }
  function setView(v) {
    view = v;
    $("ad-view-map").setAttribute("aria-pressed", v === "map" ? "true" : "false"); $("ad-view-gallery").setAttribute("aria-pressed", v === "gallery" ? "true" : "false");
    $("ad-map").hidden = v !== "map" || !map; $("ad-gallery").hidden = v !== "gallery" && !!map;
    if (v === "map" && map) setTimeout(function () { map.invalidateSize(); }, 0);
  }

  // ---------- details panel
  function select(it, opts) {
    opts = opts || {};
    var prev = current; current = it;
    if (prev && markers[prev.id]) markers[prev.id].setIcon(pinIcon(prev, false));
    if (markers[it.id]) markers[it.id].setIcon(pinIcon(it, true));
    Array.prototype.forEach.call(document.querySelectorAll(".ad-card"), function (c) { c.classList.toggle("on", c.getAttribute("data-id") === it.id); });
    renderPanel(it);
    try { history.replaceState(null, "", "#" + it.id); } catch (e) {}
    if (opts.pan) showOnMap(it);
  }
  function renderPanel(it) {
    var p = clear($("ad-panel")), c = catOf(it), im = it.image, idx = filtered.indexOf(it);
    p.classList.add("open");
    p.appendChild(h("button", { type: "button", class: "close", "aria-label": "Close details", onclick: closePanel, text: "\u00d7" }));
    p.appendChild(h("button", { type: "button", class: "pi", "aria-label": "View " + it.title + " larger", onclick: function () { openViewer(it); } }, [
      h("img", { src: imgUrl(im.file, 960), alt: im.alt || it.title, referrerpolicy: "no-referrer" }), h("span", { class: "zoom", text: "View large" })]));
    p.appendChild(h("span", { class: "tag", style: "color:" + c.color + ";border:1px solid " + c.color + ";padding:0 0.4rem", text: c.label }));
    p.appendChild(h("h2", { text: it.title }));
    p.appendChild(h("p", { class: "sub", text: [sub(it), it.date].filter(Boolean).join(" · ") }));
    if (it.summary) p.appendChild(h("p", { text: it.summary }));
    if (it.summary_src && it.summary_src.name) p.appendChild(h("p", { class: "credit" }, ["Text: ", link(it.summary_src.name, it.summary_src.url) || it.summary_src.name, it.summary_src.license ? " (" + it.summary_src.license + ")" : ""]));
    if (it.facts.length) { var dl = h("dl"); it.facts.forEach(function (f) { dl.appendChild(h("dt", { text: f[0] })); dl.appendChild(h("dd", { text: f[1] })); }); p.appendChild(dl); }
    if (it.artist_note && it.artist_note.text) {
      p.appendChild(h("h3", { text: "About the artist" })); p.appendChild(h("p", { text: it.artist_note.text }));
      p.appendChild(h("p", { class: "credit" }, ["Text: ", link(it.artist_note.name || "source", it.artist_note.url) || "", it.artist_note.license ? " (" + it.artist_note.license + ")" : ""]));
    }
    if (it.loc_note) p.appendChild(h("p", { class: "credit", text: "Pin: " + it.loc_note }));
    p.appendChild(h("h3", { text: "Image credit" }));
    p.appendChild(h("p", { class: "credit" }, [(im.author ? im.author + " · " : ""), link(im.license || "licence", im.license_url) || (im.license || ""), " · ", link("File page on Wikimedia Commons", im.page) || "Wikimedia Commons"]));
    var links = h("div", { class: "links" });
    (it.links || []).forEach(function (l) { var a = link(l.label, l.url); if (a) links.appendChild(a); });
    if (links.firstChild) p.appendChild(links);
    p.appendChild(h("div", { class: "nav" }, [
      h("button", { type: "button", class: "ad-btn", onclick: function () { select(it, { pan: true }); if (narrow()) closePanel(); }, text: "Show on map" }),
      h("button", { type: "button", class: "ad-btn", onclick: function () { step(-1); }, "aria-label": "Previous item", text: "←" }),
      h("button", { type: "button", class: "ad-btn", onclick: function () { step(1); }, "aria-label": "Next item", text: "→" })
    ]));
    if (idx >= 0) p.appendChild(h("p", { class: "credit", text: "Item " + (idx + 1) + " of " + filtered.length + " in this selection." }));
  }
  function narrow() { return !!(window.matchMedia && window.matchMedia("(max-width: 960px)").matches); }
  function closePanel() { $("ad-panel").classList.remove("open"); }
  function step(d) {
    if (!filtered.length) return;
    var i = filtered.indexOf(current), n = i < 0 ? (d > 0 ? 0 : filtered.length - 1) : (i + d + filtered.length) % filtered.length;
    select(filtered[n], { pan: view === "map" && !!map });
  }

  // ---------- viewer with pan and zoom
  var vw = { open: false, it: null, scale: 1, x: 0, y: 0, nw: 0, nh: 0, fit: 1, ptr: {}, pinch: 0, pinchScale: 1, opener: null, token: 0 };
  var stage, vimg;
  function applyT() { vimg.style.transform = "translate(" + vw.x + "px," + vw.y + "px) scale(" + vw.scale + ")"; }
  function fitView() {
    var r = stage.getBoundingClientRect(); if (!vw.nw) return;
    vw.fit = Math.min(r.width / vw.nw, r.height / vw.nh); vw.scale = vw.fit;
    vw.x = (r.width - vw.nw * vw.scale) / 2; vw.y = (r.height - vw.nh * vw.scale) / 2; applyT();
  }
  function zoomAt(cx, cy, f) {
    var s = Math.max(vw.fit * 0.6, Math.min(vw.fit * 12, vw.scale * f)), k = s / vw.scale;
    vw.x = cx - (cx - vw.x) * k; vw.y = cy - (cy - vw.y) * k; vw.scale = s; applyT();
  }
  function stageCenter() { var r = stage.getBoundingClientRect(); return [r.width / 2, r.height / 2]; }
  function loadInto(it, w, first) {
    var token = ++vw.token, im = new Image();
    im.onload = function () {
      if (token !== vw.token || !vw.open) return;
      var ratio = vw.nw ? vw.nw / im.naturalWidth : 1, had = !!vw.nw;
      vimg.src = im.src; vw.nw = im.naturalWidth; vw.nh = im.naturalHeight;
      vimg.style.width = vw.nw + "px"; vimg.style.height = vw.nh + "px";
      if (!had) fitView(); else { vw.scale *= ratio; vw.fit = Math.min(stage.clientWidth / vw.nw, stage.clientHeight / vw.nh); applyT(); }
      if (w >= 1920 || !first) $("vw-loading").hidden = true;
    };
    im.onerror = function () { if (token === vw.token) $("vw-loading").textContent = "The image could not be loaded here. Use the link to open it on Wikimedia Commons."; };
    im.referrerPolicy = "no-referrer"; im.src = imgUrl(it.image.file, w);
  }
  function openViewer(it) {
    vw.opener = document.activeElement; vw.open = true; vw.it = it; vw.nw = 0; vw.nh = 0; vw.ptr = {};
    var v = $("ad-viewer"); v.hidden = false; document.body.classList.add("vw-open");
    $("ad-vw-title").textContent = it.title + (sub(it) ? " (" + sub(it) + ")" : "");
    $("vw-orig").href = safe(it.image.page) || "https://commons.wikimedia.org/";
    clear($("vw-credit")).appendChild(h("span", {}, [(it.image.author ? it.image.author + " · " : ""), link(it.image.license || "licence", it.image.license_url) || (it.image.license || ""), " · ", link("Source", it.image.page) || ""]));
    vimg.removeAttribute("src"); vimg.alt = it.image.alt || it.title; $("vw-loading").hidden = false; $("vw-loading").textContent = "Loading the high-resolution image…";
    loadInto(it, 1280, true); loadInto(it, 1920, false);
    stage.focus();
  }
  function closeViewer() {
    if (!vw.open) return; vw.open = false; vw.token++; $("ad-viewer").hidden = true; document.body.classList.remove("vw-open");
    if (vw.opener && vw.opener.focus) vw.opener.focus();
  }
  function viewerStep(d) {
    if (!filtered.length) return; var i = filtered.indexOf(vw.it), n = i < 0 ? 0 : (i + d + filtered.length) % filtered.length;
    var it = filtered[n]; select(it, {}); var opener = vw.opener; openViewer(it); vw.opener = opener;
  }
  function initViewer() {
    stage = $("vw-stage"); vimg = $("vw-img");
    $("vw-close").addEventListener("click", closeViewer);
    $("vw-prev").addEventListener("click", function () { viewerStep(-1); }); $("vw-next").addEventListener("click", function () { viewerStep(1); });
    $("vw-in").addEventListener("click", function () { var c = stageCenter(); zoomAt(c[0], c[1], 1.4); });
    $("vw-out").addEventListener("click", function () { var c = stageCenter(); zoomAt(c[0], c[1], 1 / 1.4); });
    $("vw-fit").addEventListener("click", fitView);
    stage.addEventListener("wheel", function (e) { e.preventDefault(); var r = stage.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    stage.addEventListener("dblclick", function (e) { var r = stage.getBoundingClientRect(); if (vw.scale > vw.fit * 1.05) fitView(); else zoomAt(e.clientX - r.left, e.clientY - r.top, 2.5); });
    stage.addEventListener("pointerdown", function (e) {
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
      vw.ptr[e.pointerId] = { x: e.clientX, y: e.clientY }; stage.classList.add("drag");
      var ids = Object.keys(vw.ptr); if (ids.length === 2) { var a = vw.ptr[ids[0]], b = vw.ptr[ids[1]]; vw.pinch = Math.hypot(a.x - b.x, a.y - b.y); vw.pinchScale = vw.scale; }
    });
    stage.addEventListener("pointermove", function (e) {
      var p = vw.ptr[e.pointerId]; if (!p) return; var ids = Object.keys(vw.ptr);
      if (ids.length === 1) { vw.x += e.clientX - p.x; vw.y += e.clientY - p.y; applyT(); }
      else if (ids.length === 2) {
        vw.ptr[e.pointerId] = { x: e.clientX, y: e.clientY }; var a = vw.ptr[ids[0]], b = vw.ptr[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y), r = stage.getBoundingClientRect();
        if (vw.pinch) zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, (vw.pinchScale * d / vw.pinch) / vw.scale);
        return;
      }
      vw.ptr[e.pointerId] = { x: e.clientX, y: e.clientY };
    });
    function up(e) { delete vw.ptr[e.pointerId]; vw.pinch = 0; if (!Object.keys(vw.ptr).length) stage.classList.remove("drag"); }
    stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
    window.addEventListener("resize", function () { if (vw.open) fitView(); });
    document.addEventListener("keydown", function (e) {
      if (!vw.open) { if (e.key === "Escape" && narrow()) closePanel(); return; }
      var k = e.key;
      if (k === "Escape") { e.preventDefault(); closeViewer(); }
      else if (k === "ArrowLeft") { e.preventDefault(); viewerStep(-1); } else if (k === "ArrowRight") { e.preventDefault(); viewerStep(1); }
      else if (k === "+" || k === "=") { var c = stageCenter(); zoomAt(c[0], c[1], 1.4); } else if (k === "-" || k === "_") { var d = stageCenter(); zoomAt(d[0], d[1], 1 / 1.4); }
      else if (k === "0") fitView();
      else if (k === "Tab") { // keep focus inside the viewer
        var f = Array.prototype.slice.call($("ad-viewer").querySelectorAll("button, a[href], [tabindex='0']")).filter(function (n) { return !n.hidden; });
        if (!f.length) return; var i = f.indexOf(document.activeElement);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
  }

  // ---------- start
  function fromHash() { var id = decodeURIComponent((location.hash || "").slice(1)); if (id && byId[id]) { if (filtered.indexOf(byId[id]) < 0) { on[byId[id].cat] = true; query = ""; $("ad-q").value = ""; applyFilter(); } select(byId[id], { pan: view === "map" && !!map }); } }
  function start(list) {
    data = clean(list); data.forEach(function (it) { byId[it.id] = it; });
    initViewer(); buildChips(); var hasMap = initMap(); applyFilter();
    if (!hasMap) { $("ad-map").hidden = true; $("ad-map-note").hidden = false; $("ad-view-map").disabled = true; setView("gallery"); } else setView("map");
    $("ad-q").addEventListener("input", (function () { var t; return function () { var v = this.value; clearTimeout(t); t = setTimeout(function () { query = v; applyFilter(); }, 150); }; })());
    $("ad-view-map").addEventListener("click", function () { setView("map"); });
    $("ad-view-gallery").addEventListener("click", function () { setView("gallery"); });
    $("ad-reset").addEventListener("click", function () { query = ""; $("ad-q").value = ""; Object.keys(on).forEach(function (k) { on[k] = true; }); Array.prototype.forEach.call(document.querySelectorAll(".ad-chip"), function (b) { b.setAttribute("aria-pressed", "true"); }); applyFilter(); fitAll(); });
    window.addEventListener("hashchange", fromHash); fromHash();
  }
  fetch(DATA_URL, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) { start(Array.isArray(d) ? d : d.items || []); })
    .catch(function () { $("ad-count").textContent = "The collection could not be loaded right now. Please try again later."; });
})();
