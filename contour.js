// Contour Synth: a drawing instrument. Every line you draw is a voice in a looping piano roll:
// left to right is time, height is pitch on the chosen scale, and every grid cell a line passes
// through sounds. Shapes become chords (a circle plays its top and bottom together), lines become
// melodies, and the colour you draw with picks the instrument. A drum groove keeps time.
// Web Audio API only, no libraries.
(function () {
  "use strict";
  var FINE = 4, MAX_STROKES = 400, MAX_POINTS = 4000, MAX_CHORD = 3, MAX_PER_INST = 4, MAX_NOTES = 12, STORE = "contour.v2";
  var SCALES = {
    "Major pentatonic": [0, 2, 4, 7, 9], "Minor pentatonic": [0, 3, 5, 7, 10],
    "Major": [0, 2, 4, 5, 7, 9, 11], "Minor": [0, 2, 3, 5, 7, 8, 10], "Harmonic minor": [0, 2, 3, 5, 7, 8, 11],
    "Dorian": [0, 2, 3, 5, 7, 9, 10], "Phrygian": [0, 1, 3, 5, 7, 8, 10], "Lydian": [0, 2, 4, 6, 7, 9, 11],
    "Mixolydian": [0, 2, 4, 5, 7, 9, 10], "Blues": [0, 3, 5, 6, 7, 10]
  };
  var NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  // Instruments. decay > 0: struck, rings out on its own. decay = 0: held while the line stays on the note.
  var INSTRUMENTS = [
    { id: "keys", name: "Keys", color: "#1f8a70", attack: 0.006, decay: 1.5, peak: 0.34 },
    { id: "pluck", name: "Pluck", color: "#d4572a", attack: 0.004, decay: 0.8, peak: 0.32 },
    { id: "bell", name: "Bell", color: "#6c5ce7", attack: 0.004, decay: 2.4, peak: 0.24 },
    { id: "marimba", name: "Marimba", color: "#e89a1c", attack: 0.003, decay: 0.5, peak: 0.42 },
    { id: "flute", name: "Flute", color: "#2f5bb7", attack: 0.08, decay: 0, peak: 0.22 },
    { id: "strings", name: "Strings", color: "#c8558f", attack: 0.15, decay: 0, peak: 0.14 },
    { id: "chime", name: "Chime", color: "#3fa7d6", attack: 0.004, decay: 1.8, peak: 0.16 },
    { id: "bass", name: "Bass", color: "#2b2a26", attack: 0.02, decay: 0, peak: 0.3 },
    { id: "bit", name: "8-bit", color: "#d9a066", attack: 0.01, decay: 0, peak: 0.08 }
  ];
  var DEFAULT_COLORS = INSTRUMENTS.map(function (i) { return i.color; });
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) {}
  if (saved && Array.isArray(saved.colors)) INSTRUMENTS.forEach(function (ins, i) { if (/^#[0-9a-f]{6}$/i.test(saved.colors[i])) ins.color = saved.colors[i]; });
  var SHAPES = [
    function () { return [circle(0.3, 0.5, 0.22), wave(0.55, 0.45, 0.95, 0.12, 2)]; },
    function () { return [spiral(0.5, 0.5, 0.42)]; },
    function () { return [wave(0.03, 0.35, 0.97, 0.1, 3), line(0.03, 0.8, 0.97, 0.8)]; },
    function () { return [zig(0.05, 0.55, 0.95, 0.18, 12)]; },
    function () { return [arc(0.5, 0.75, 0.42, Math.PI, 2 * Math.PI), circle(0.5, 0.3, 0.08)]; },
    function () { return [line(0.05, 0.9, 0.5, 0.15), line(0.5, 0.15, 0.95, 0.9), line(0.2, 0.62, 0.8, 0.62)]; }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $("cs-canvas"), ctx = canvas.getContext("2d");
  var strokes = [], current = null, inst = 0, tool = "pen", erasing = false, pointer = null, history = [], future = [], ERASE_R = 16;
  var cfg = { scale: "Major pentatonic", root: 0, octaves: 2, shift: 0, bpm: 96, swing: 0, drums: true, length: 0, detail: 16, width: 5, paper: 0, follow: "glide", volume: 0.6,
    mix: INSTRUMENTS.map(function () { return { v: 1, m: false, s: false }; }) };
  var audio = null, bus, dry, verb, master, noise, instBus = [], exporting = false, pv = null;
  var playing = false, step = 0, nextTime = 0, timer = null, stepLog = [], flashes = [];

  // ---------- grid
  function bars() { return cfg.length || (canvas.clientWidth >= 700 ? 2 : 1); }
  function SPB() { return cfg.detail; }
  function STEPS() { return SPB() * bars(); }
  function scale() { return SCALES[cfg.scale]; }
  function ROWS() { return scale().length * cfg.octaves + 1; }
  function midiOf(row) { var sc = scale(), o = Math.floor(row / sc.length); return 48 + cfg.root + 12 * (o + cfg.shift) + sc[row % sc.length]; }
  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function noteName(m) { return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1); }
  function rowAt(v) { return Math.max(0, Math.min(ROWS() - 1, Math.round((1 - v) * (ROWS() - 1)))); }
  function rowY(row, h) { return (1 - row / (ROWS() - 1)) * h; }

  // Each stroke becomes, per step, the set of rows it touches. Touching rows merge into one note
  // (their middle), so a thick or wobbly line is one note but a circle is two.
  function analyse(s) {
    var n = STEPS(), sets = [];
    for (var i = 0; i < n; i++) sets.push({});
    var prev = null;
    s.pts.forEach(function (p) {
      var st = Math.max(0, Math.min(n - 1, Math.floor(p.u * n))), row = rowAt(p.v);
      sets[st][row] = 1;
      if (prev && Math.abs(st - prev.st) > 1) {
        var lo = Math.min(prev.st, st), hi = Math.max(prev.st, st);
        for (var k = lo + 1; k < hi; k++) sets[k][Math.round(prev.row + (k - prev.st) / (st - prev.st) * (row - prev.row))] = 1;
      }
      prev = { st: st, row: row };
    });
    s.chords = sets.map(function (set) {
      var rows = Object.keys(set).map(Number).sort(function (a, b) { return a - b; }), out = [], start = null;
      rows.forEach(function (r, i) {
        if (start === null) start = r;
        if (rows[i + 1] !== r + 1) { out.push(Math.round((start + r) / 2)); start = null; }
      });
      return out.slice(0, MAX_CHORD);
    });
    // Continuous voices: sample the line FINE times per step and follow each part of it (up to MAX_CHORD
    // at once, bottom to top) for as long as it lasts, with its exact height in rows.
    var N = n * FINE, cols = [];
    for (var c = 0; c < N; c++) cols.push([]);
    var last = null, top = ROWS() - 1;
    s.pts.forEach(function (p) {
      var col = Math.max(0, Math.min(N - 1, Math.floor(p.u * N))), rf = (1 - p.v) * top;
      cols[col].push(rf);
      if (last && !p.brk && Math.abs(col - last.col) > 1) {
        var lo2 = Math.min(last.col, col), hi2 = Math.max(last.col, col);
        for (var k2 = lo2 + 1; k2 < hi2; k2++) cols[k2].push(last.rf + (k2 - last.col) / (col - last.col) * (rf - last.rf));
      }
      last = { col: col, rf: rf };
    });
    var lanes = cols.map(function (vals) {
      vals.sort(function (a, b) { return a - b; });
      var out = [], group = [];
      vals.forEach(function (v, i) {
        group.push(v);
        if (i === vals.length - 1 || vals[i + 1] - v > 1) { out.push(group.reduce(function (a, b) { return a + b; }, 0) / group.length); group = []; }
      });
      return out.slice(0, MAX_CHORD);
    });
    s.runs = [];
    for (var lane = 0; lane < MAX_CHORD; lane++) {
      var run = null;
      for (var c2 = 0; c2 < N; c2++) {
        var v = lanes[c2][lane];
        if (v == null) { run = null; continue; }
        if (!run) { run = { col: c2, rf: [] }; s.runs.push(run); }
        run.rf.push(v);
      }
    }
    // A note starts where its row appears and lasts while the stroke stays on it.
    s.events = s.chords.map(function (rows, st) {
      return rows.filter(function (r) { return st === 0 || s.chords[st - 1].indexOf(r) < 0; }).map(function (r) {
        var len = 1; while (st + len < n && s.chords[st + len].indexOf(r) >= 0) len++;
        return { row: r, len: len };
      });
    });
  }

  // ---------- drawing
  function resize() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    strokes.forEach(analyse); draw();
  }
  function draw() {
    var w = canvas.clientWidth, h = canvas.clientHeight, n = STEPS(), rows = ROWS(), sc = scale();
    ctx.fillStyle = "#f5f0e6"; ctx.fillRect(0, 0, w, h);
    ctx.font = "10px ui-monospace, monospace"; ctx.textBaseline = "middle";
    for (var r = 0; r < rows; r++) {
      var y = Math.round(rowY(r, h)) + 0.5, root = r % sc.length === 0;
      ctx.strokeStyle = root ? "rgba(43,42,38,0.28)" : "rgba(43,42,38,0.09)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      if (root) { ctx.fillStyle = "rgba(43,42,38,0.55)"; ctx.fillText(noteName(midiOf(r)), 5, Math.min(h - 7, Math.max(7, y - 7))); }
    }
    for (var s = 0; s <= n; s++) {
      var x = Math.round(s * w / n) + 0.5;
      ctx.strokeStyle = s % SPB() === 0 ? "rgba(43,42,38,0.3)" : s % (SPB() / 4) === 0 ? "rgba(43,42,38,0.14)" : "rgba(43,42,38,0.05)";
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    var now = audio ? audio.currentTime : 0;
    // cells that just sounded glow briefly
    flashes = flashes.filter(function (f) { return now - f.t < 0.45; });
    flashes.forEach(function (f) {
      if (f.t > now) return;
      var a = 1 - (now - f.t) / 0.45;
      ctx.globalAlpha = 0.55 * a; ctx.fillStyle = f.color;
      ctx.beginPath(); ctx.arc((f.step + 0.5) * w / n, rowY(f.row, h), 7 + 10 * (1 - a), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    });
    strokes.concat(current ? [current] : []).forEach(function (st) {
      ctx.strokeStyle = INSTRUMENTS[st.inst].color; ctx.lineWidth = cfg.width; ctx.lineJoin = ctx.lineCap = "round";
      ctx.beginPath();
      st.pts.forEach(function (p, i) { if (i && !p.brk) ctx.lineTo(p.u * w, p.v * h); else ctx.moveTo(p.u * w, p.v * h); });
      ctx.stroke();
    });
    if (pointer && tool === "erase") { ctx.strokeStyle = "rgba(43,42,38,0.8)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(pointer.x, pointer.y, ERASE_R, 0, Math.PI * 2); ctx.stroke(); }
    var pos = playhead();
    if (pos >= 0) {
      var px = pos * w;
      ctx.strokeStyle = "rgba(43,42,38,0.75)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    }
    if (!strokes.length && !current) {
      ctx.fillStyle = "rgba(43,42,38,0.55)"; ctx.font = "15px ui-monospace, monospace"; ctx.textAlign = "center";
      ctx.fillText("Draw anything: a skyline, a river, a sun. Lines play melodies, shapes play chords.", w / 2, h / 2); ctx.textAlign = "start";
    }
  }
  function loop() { draw(); if (playing || flashes.length) requestAnimationFrame(loop); }

  function at(e) {
    var r = canvas.getBoundingClientRect();
    return { u: Math.max(0, Math.min(0.9999, (e.clientX - r.left) / r.width)), v: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  }
  function xy(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function pushHistory() { history.push(strokes.slice()); if (history.length > 60) history.shift(); future = []; }
  // The eraser removes ink inside its circle; a line it cuts in two becomes two lines.
  function eraseAt(x, y) {
    var w = canvas.clientWidth, h = canvas.clientHeight, out = [], changed = false;
    strokes.forEach(function (s) {
      var piece = [], pieces = [];
      s.pts.forEach(function (p) {
        var dx = p.u * w - x, dy = p.v * h - y;
        if (dx * dx + dy * dy <= ERASE_R * ERASE_R) { changed = true; if (piece.length) pieces.push(piece); piece = []; } else piece.push(p);
      });
      if (piece.length) pieces.push(piece);
      if (pieces.length === 1 && pieces[0].length === s.pts.length) { out.push(s); return; }
      pieces.forEach(function (pts) { if (pts.length >= 2) { var ns = { inst: s.inst, pts: pts }; analyse(ns); out.push(ns); } else changed = true; });
    });
    if (changed) strokes = out;
    return changed;
  }
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  canvas.addEventListener("pointerdown", function (e) {
    var p = xy(e); pointer = p;
    if (tool === "erase" || e.button === 2) {
      try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
      pushHistory(); erasing = true; eraseAt(p.x, p.y); draw(); return;
    }
    if (strokes.length >= MAX_STROKES) { status("That is a full canvas (" + MAX_STROKES + " lines). Erase or undo to draw more."); return; }
    try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
    start();
    current = { inst: inst, pts: [at(e)] };
    previewStart(current.pts[0]); draw();
  });
  canvas.addEventListener("pointermove", function (e) {
    var q = xy(e); pointer = q;
    if (erasing) { if (eraseAt(q.x, q.y)) update(); draw(); return; }
    if (!current) { if (tool === "erase") draw(); return; }
    var p = at(e), last = current.pts[current.pts.length - 1];
    if (Math.abs(p.u - last.u) + Math.abs(p.v - last.v) < 0.003 || current.pts.length >= MAX_POINTS) return;
    previewMove(p);
    current.pts.push(p); draw();
  });
  function finish() {
    if (erasing) { erasing = false; update(); persist(); draw(); return; }
    previewEnd();
    if (!current) return;
    analyse(current);
    if (current.events.some(function (e) { return e.length; })) { pushHistory(); strokes.push(current); }
    current = null; update(); persist(); draw();
  }
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("pointerleave", function () { if (!current && !erasing) { pointer = null; draw(); } });

  // ---------- audio engine
  // The sound chain: each instrument -> its mixer channel -> reverb and dry -> master -> soft clip.
  // Built once for live playback and again, identically, for each WAV export.
  function buildGraph(ac, volume) {
    var g = { master: ac.createGain(), bus: ac.createGain(), dry: ac.createGain(), verb: ac.createConvolver() };
    g.master.gain.value = volume;
    var clip = ac.createWaveShaper(), curve = new Float32Array(1024);
    for (var i = 0; i < 1024; i++) { var x = i / 511.5 - 1; curve[i] = Math.tanh(1.6 * x) / Math.tanh(1.6); }
    clip.curve = curve;
    g.dry.gain.value = 0.85;
    g.verb.buffer = impulse(ac, 2.4); var wet = ac.createGain(); wet.gain.value = 0.28;
    g.bus.connect(g.dry); g.bus.connect(g.verb); g.verb.connect(wet);
    g.dry.connect(g.master); wet.connect(g.master); g.master.connect(clip); clip.connect(ac.destination);
    g.noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    var d = g.noise.getChannelData(0); for (var j = 0; j < d.length; j++) d[j] = Math.random() * 2 - 1;
    g.inst = INSTRUMENTS.map(function () { var n = ac.createGain(); n.connect(g.bus); return n; });
    return g;
  }
  function useGraph(ac, g) { audio = ac; bus = g.bus; dry = g.dry; verb = g.verb; master = g.master; noise = g.noise; instBus = g.inst; }
  function start() {
    if (!audio) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { status("This browser does not support the Web Audio API."); return false; }
      var ac = new AC();
      useGraph(ac, buildGraph(ac, cfg.volume)); applyMix();
    }
    if (audio.state === "suspended") audio.resume();
    return true;
  }
  function impulse(ac, sec) {
    var len = Math.round(ac.sampleRate * sec), b = ac.createBuffer(2, len, ac.sampleRate);
    for (var c = 0; c < 2; c++) { var d = b.getChannelData(c); for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    return b;
  }
  // ---------- mixer
  function audible(i) { var any = cfg.mix.some(function (m) { return m.s; }), m = cfg.mix[i]; return !m.m && (!any || m.s); }
  function applyMix() {
    if (!audio) return;
    instBus.forEach(function (g, i) { var v = audible(i) ? cfg.mix[i].v : 0; if (exporting) g.gain.value = v; else g.gain.setTargetAtTime(v, audio.currentTime, 0.02); });
  }
  function osc(type, freq, t, end, dest, level, detune) {
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (detune) o.detune.value = detune;
    if (made) { o.baseFreq = freq; made.push(o); }
    g.gain.value = level == null ? 1 : level; o.connect(g); g.connect(dest); o.start(t); o.stop(end);
    return o;
  }
  var made = null; // set while building a voice that follows a line
  function lowpass(f, dest) { var b = audio.createBiquadFilter(); b.type = "lowpass"; b.frequency.value = f; b.connect(dest); return b; }

  // path (optional): { freqs: [...], dt: seconds between them, hits: [indexes where a new note starts] }.
  // With a path the voice lasts the whole line and its pitch follows it; struck instruments ring down to
  // a sustain and are struck again at every new note, so they never fall silent while the line goes on.
  function play(ins, freq, t, dur, vel, path) {
    var amp = audio.createGain(), p = ins.peak * (vel || 1), end;
    amp.connect(instBus[INSTRUMENTS.indexOf(ins)] || bus);
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(p, t + ins.attack);
    if (path) {
      var floor = ins.decay ? p * 0.4 : p, tau = ins.decay ? Math.min(0.35, ins.decay / 5) : 0.1;
      if (ins.decay) amp.gain.setTargetAtTime(floor, t + ins.attack, tau);
      path.hits.forEach(function (i) {
        if (!i || !ins.decay) return;
        var th = t + i * path.dt; amp.gain.setTargetAtTime(p, th, 0.004); amp.gain.setTargetAtTime(floor, th + 0.02, tau);
      });
      amp.gain.setTargetAtTime(0, t + dur, ins.decay ? Math.min(0.25, ins.decay / 6) : 0.07); end = t + dur + 1.2;
    } else if (ins.decay) { amp.gain.setTargetAtTime(0, t + ins.attack, ins.decay / 4); end = t + ins.decay * 1.6; }
    else { amp.gain.setValueAtTime(p, t + Math.max(ins.attack, dur - 0.03)); amp.gain.setTargetAtTime(0, t + dur, 0.07); end = t + dur + 0.6; }
    made = [];
    switch (ins.id) {
      case "keys":
        var kf = lowpass(3800, amp);
        osc("triangle", freq, t, end, kf, 0.7); osc("triangle", freq, t, end, kf, 0.35, 7); osc("sine", freq * 2, t, end, kf, 0.12);
        break;
      case "pluck":
        var pf = audio.createBiquadFilter(); pf.type = "lowpass"; pf.Q.value = 2; pf.connect(amp);
        pf.frequency.setValueAtTime(Math.min(9000, freq * 10), t); pf.frequency.setTargetAtTime(freq * 1.5, t, 0.08);
        osc("sawtooth", freq, t, end, pf, 0.6); osc("square", freq / 2, t, end, pf, 0.15);
        break;
      case "bell":
        var mod = audio.createGain(); mod.gain.setValueAtTime(freq * 2.2, t); mod.gain.setTargetAtTime(freq * 0.2, t, 0.4);
        var car = osc("sine", freq, t, end, amp, 0.9);
        var m = audio.createOscillator(); m.frequency.value = freq * 3.5; bellMod = m; m.connect(mod); mod.connect(car.frequency); m.start(t); m.stop(end);
        break;
      case "marimba":
        osc("sine", freq, t, end, amp, 0.85);
        var hi = audio.createGain(); hi.gain.setValueAtTime(0.35, t); hi.gain.setTargetAtTime(0, t, 0.03); hi.connect(amp);
        osc("sine", freq * 4, t, end, hi, 1);
        break;
      case "flute":
        var ff = lowpass(3000, amp), f1 = osc("sine", freq, t, end, ff, 0.8); osc("triangle", freq * 2, t, end, ff, 0.08);
        var lfo = audio.createOscillator(), depth = audio.createGain(); lfo.frequency.value = 5.2; depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(9, t + 0.4);
        lfo.connect(depth); depth.connect(f1.detune); lfo.start(t); lfo.stop(end);
        breath(t, Math.min(0.12, dur), amp, 0.05);
        break;
      case "strings":
        var sf = lowpass(1900, amp); osc("sawtooth", freq, t, end, sf, 0.5, -8); osc("sawtooth", freq, t, end, sf, 0.5, 8); osc("sawtooth", freq / 2, t, end, sf, 0.2);
        break;
      case "chime":
        osc("sine", freq * 2, t, end, amp, 0.8); osc("sine", freq * 2 * 2.76, t, end, amp, 0.25); osc("sine", freq * 2 * 5.4, t, end, amp, 0.08);
        break;
      case "bass":
        var bf = lowpass(700, amp); osc("sawtooth", freq / 2, t, end, bf, 0.55); osc("sine", freq / 2, t, end, amp, 0.6);
        break;
      default: // 8-bit
        osc("square", freq, t, end, lowpass(3200, amp), 1);
    }
    var handle = { amp: amp, oscs: made, mod: bellMod, f0: freq, p: p, ins: ins };
    if (path) {
      // every oscillator keeps its ratio to the fundamental and slides with the line
      made.forEach(function (o) {
        var ratio = o.baseFreq / freq, g = o.frequency;
        path.freqs.forEach(function (f, i) { if (i) g.linearRampToValueAtTime(f * ratio, t + i * path.dt); });
      });
      if (bellMod) path.freqs.forEach(function (f, i) { if (i) bellMod.frequency.linearRampToValueAtTime(f * 3.5, t + i * path.dt); });
    }
    made = null; bellMod = null;
    return handle;
  }
  var bellMod = null;
  function breath(t, dur, dest, level) {
    var s = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
    s.buffer = noise; f.type = "bandpass"; f.frequency.value = 2500; g.gain.setValueAtTime(level, t); g.gain.setTargetAtTime(0, t + dur * 0.5, 0.04);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t); s.stop(t + dur + 0.2);
  }
  // A soft drum kit: kick, snare and closed hat, quiet enough to sit under the drawing.
  function drum(kind, t) {
    var g = audio.createGain(); g.connect(dry);
    if (kind === "kick") {
      var o = audio.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(0.55, t); g.gain.setTargetAtTime(0, t + 0.02, 0.07); o.connect(g); o.start(t); o.stop(t + 0.5);
    } else {
      var s = audio.createBufferSource(), f = audio.createBiquadFilter(); s.buffer = noise;
      f.type = kind === "hat" ? "highpass" : "bandpass"; f.frequency.value = kind === "hat" ? 7000 : 1800;
      g.gain.setValueAtTime(kind === "hat" ? 0.09 : 0.32, t); g.gain.setTargetAtTime(0, t, kind === "hat" ? 0.018 : 0.05);
      s.connect(f); f.connect(g); s.start(t, Math.random() * 0.5); s.stop(t + 0.3);
      if (kind === "snare") { var tn = audio.createOscillator(), tg = audio.createGain(); tn.frequency.value = 190; tg.gain.setValueAtTime(0.18, t); tg.gain.setTargetAtTime(0, t, 0.03); tn.connect(tg); tg.connect(dry); tn.start(t); tn.stop(t + 0.2); }
    }
  }
  var KICK = [0, 7, 8], SNARE = [4, 12];

  function stepDur() { return 60 / cfg.bpm / (SPB() / 4); }
  function thin(arr, k) { // k evenly spaced items
    if (arr.length <= k) return arr;
    var out = []; for (var i = 0; i < k; i++) out.push(arr[Math.round(i * (arr.length - 1) / (k - 1))]); return out;
  }
  // A full picture can put many lines under the playhead at once: keep each instrument to a few notes and
  // the whole step to a handful, and turn the volume down a little as it gets busier.
  function notesAt(step) {
    var seen = {}, list = [], byInst = {};
    strokes.forEach(function (s) {
      (s.events[step] || []).forEach(function (ev) {
        var key = s.inst + ":" + ev.row;
        if (seen[key]) { if (ev.len > seen[key].len) seen[key].len = ev.len; return; }
        seen[key] = { inst: s.inst, row: ev.row, len: ev.len }; list.push(seen[key]);
      });
    });
    list.forEach(function (nt) { (byInst[nt.inst] = byInst[nt.inst] || []).push(nt); });
    var kept = [];
    Object.keys(byInst).forEach(function (k) { kept = kept.concat(thin(byInst[k].sort(function (a, b) { return a.row - b.row; }), MAX_PER_INST)); });
    kept.sort(function (a, b) { return a.row - b.row; });
    return thin(kept, MAX_NOTES);
  }
  // Everything that sounds on one step: drums, then the lines (as notes or as voices that follow them).
  function runStep(stp, base, sd) {
    var spb = SPB(), unit = spb / 16, s16 = (stp % spb) / unit, whole = s16 === Math.floor(s16);
    var t = base + (whole && s16 % 2 === 1 ? cfg.swing * unit * sd : 0);
    if (!exporting) { stepLog.push({ step: stp, t: base, n: STEPS() }); if (stepLog.length > 64) stepLog.shift(); }
    if (cfg.drums && whole) {
      if (KICK.indexOf(s16) >= 0) drum("kick", t);
      if (SNARE.indexOf(s16) >= 0) drum("snare", t);
      if (s16 % 2 === 0) drum("hat", t);
    }
    if (cfg.follow !== "notes") { followAt(stp, t, sd); return; }
    var list = notesAt(stp), vel = Math.min(1, Math.sqrt(5 / Math.max(1, list.length)));
    list.forEach(function (nt) {
      var ins = INSTRUMENTS[nt.inst];
      play(ins, hz(midiOf(nt.row)), t, nt.len * sd, vel * (0.85 + Math.random() * 0.15));
      flash({ t: t, step: stp, row: nt.row, color: ins.color });
    });
  }
  function flash(f) { if (!exporting) flashes.push(f); }
  function schedule() {
    var n = STEPS();
    while (nextTime < audio.currentTime + 0.12) {
      var sd = stepDur();
      runStep(step, nextTime, sd);
      nextTime += sd; step = (step + 1) % n;
    }
  }
  // Pitch of a height in rows: snapped to the scale ("glide"), or exactly between scale notes ("exact").
  function freqAt(rf) {
    var top = ROWS() - 1; rf = Math.max(0, Math.min(top, rf));
    if (cfg.follow !== "exact") return hz(midiOf(Math.round(rf)));
    var lo = Math.floor(rf), hi = Math.min(top, lo + 1);
    return hz(midiOf(lo) + (midiOf(hi) - midiOf(lo)) * (rf - lo));
  }
  // Start every line that begins in this step as one voice that follows it to its end.
  function followAt(st, t, sd) {
    var dt = sd / FINE, starting = [];
    strokes.forEach(function (s) {
      (s.runs || []).forEach(function (r) { if (Math.floor(r.col / FINE) === st) starting.push({ s: s, r: r }); });
    });
    var vel = Math.min(1, Math.sqrt(6 / Math.max(1, starting.length + liveVoices(t))));
    thin(starting, MAX_NOTES).forEach(function (x) {
      var ins = INSTRUMENTS[x.s.inst], r = x.r, t0 = t + (r.col % FINE) * dt, freqs = [], hits = [0], prevRow = Math.round(r.rf[0]);
      r.rf.forEach(function (rf, i) {
        freqs.push(freqAt(rf));
        var row = Math.round(rf);
        if (row !== prevRow) { hits.push(i); prevRow = row; }
        if (i === 0 || row !== Math.round(r.rf[i - 1])) flash({ t: t0 + i * dt, step: Math.floor((r.col + i) / FINE) % STEPS(), row: Math.max(0, Math.min(ROWS() - 1, row)), color: ins.color });
      });
      var dur = r.rf.length * dt;
      voiceEnds.push(t0 + dur);
      play(ins, freqs[0], t0, dur, vel * 0.9, { freqs: freqs, dt: dt, hits: hits });
    });
  }
  var voiceEnds = [];
  function liveVoices(t) { voiceEnds = voiceEnds.filter(function (e) { return e > t; }); return voiceEnds.length; }
  function playhead() {
    if (!playing || !audio) return -1;
    var now = audio.currentTime, last = null;
    for (var i = stepLog.length - 1; i >= 0; i--) if (stepLog[i].t <= now) { last = stepLog[i]; break; }
    if (!last) return -1;
    return Math.min(1, (last.step + Math.min(1, (now - last.t) / stepDur())) / last.n);
  }
  // While drawing in a Follow-line mode, one voice follows the pen, as the line will sound when played.
  function rf(p) { return (1 - p.v) * (ROWS() - 1); }
  function previewStart(p) {
    if (cfg.follow === "notes") { preview(p); return; }
    if (!audio || playing) return;
    var ins = INSTRUMENTS[current.inst], f = freqAt(rf(p));
    pv = { h: play(ins, f, audio.currentTime + 0.01, 60, 0.8, { freqs: [f], dt: 1, hits: [0] }), row: rowAt(p.v) };
    flash({ t: audio.currentTime, step: Math.floor(p.u * STEPS()), row: pv.row, color: ins.color }); requestAnimationFrame(loop);
  }
  function previewMove(p) {
    if (!pv) { if (cfg.follow === "notes" && current && rowAt(p.v) !== rowAt(current.pts[current.pts.length - 1].v)) preview(p); return; }
    var h = pv.h, now = audio.currentTime, f = freqAt(rf(p)), row = rowAt(p.v);
    h.oscs.forEach(function (o) { o.frequency.setTargetAtTime(o.baseFreq / h.f0 * f, now, 0.015); });
    if (h.mod) h.mod.frequency.setTargetAtTime(f * 3.5, now, 0.015);
    if (row !== pv.row) {
      pv.row = row;
      if (h.ins.decay) { var g = h.amp.gain, tau = Math.min(0.35, h.ins.decay / 5); g.cancelScheduledValues(now); g.setTargetAtTime(h.p, now, 0.004); g.setTargetAtTime(h.p * 0.4, now + 0.02, tau); }
      flash({ t: now, step: Math.floor(p.u * STEPS()), row: row, color: h.ins.color }); requestAnimationFrame(loop);
    }
  }
  function previewEnd() {
    if (!pv) return;
    var h = pv.h, now = audio.currentTime, g = h.amp.gain; pv = null;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.setTargetAtTime(0, now, 0.06);
    h.oscs.forEach(function (o) { try { o.stop(now + 0.6); } catch (e) {} });
    setTimeout(function () { h.amp.disconnect(); }, 900);
  }
  function preview(p) {
    if (!audio || playing) return;
    var ins = INSTRUMENTS[current ? current.inst : inst], t = audio.currentTime + 0.01;
    play(ins, hz(midiOf(rowAt(p.v))), t, 0.25, 0.8);
    flash({ t: t, step: Math.floor(p.u * STEPS()), row: rowAt(p.v), color: ins.color });
    requestAnimationFrame(loop);
  }
  function toggle() {
    if (playing) { playing = false; clearInterval(timer); update(); draw(); return; }
    if (!start()) return;
    playing = true; step = 0; stepLog = []; nextTime = audio.currentTime + 0.06;
    schedule(); timer = setInterval(schedule, 25); update(); requestAnimationFrame(loop);
  }

  // ---------- the notes of one loop, as heard (used for the status line and MIDI export)
  // Follow-line voices are split into notes wherever they move to a new scale note.
  function noteList() {
    var out = [], top = ROWS() - 1, seen = {};
    function add(i, start, len, row) {
      row = Math.max(0, Math.min(top, row));
      var key = i + ":" + start + ":" + row; if (seen[key]) return; seen[key] = 1;
      out.push({ inst: i, start: start, len: len, midi: midiOf(row) });
    }
    strokes.forEach(function (s) {
      if (!audible(s.inst)) return;
      if (cfg.follow === "notes") { s.events.forEach(function (evs, st) { evs.forEach(function (ev) { add(s.inst, st, ev.len, ev.row); }); }); return; }
      (s.runs || []).forEach(function (r) {
        var from = 0, row = Math.round(r.rf[0]);
        for (var i = 1; i <= r.rf.length; i++) {
          var next = i < r.rf.length ? Math.round(r.rf[i]) : null;
          if (next !== row) { add(s.inst, (r.col + from) / FINE, (i - from) / FINE, row); from = i; row = next; }
        }
      });
    });
    return out.sort(function (a, b) { return a.start - b.start || a.midi - b.midi; });
  }

  // ---------- export: WAV (rendered offline with the same engine) and MIDI
  var WAV_LOOPS = 2;
  function exportWav() {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) { status("This browser cannot render audio files."); return; }
    if (!strokes.length) { status("Draw something first."); return; }
    var n = STEPS(), sd = stepDur(), sr = 44100, oac = new OAC(2, Math.ceil((WAV_LOOPS * n * sd + 3) * sr), sr);
    var keep = { audio: audio, bus: bus, dry: dry, verb: verb, master: master, noise: noise, inst: instBus, ends: voiceEnds };
    exporting = true; voiceEnds = [];
    try {
      useGraph(oac, buildGraph(oac, cfg.volume)); applyMix();
      for (var L = 0; L < WAV_LOOPS; L++) for (var st = 0; st < n; st++) runStep(st, 0.05 + (L * n + st) * sd, sd);
    } finally {
      audio = keep.audio; bus = keep.bus; dry = keep.dry; verb = keep.verb; master = keep.master; noise = keep.noise; instBus = keep.inst; voiceEnds = keep.ends;
      exporting = false;
    }
    $("cs-wav").disabled = true; status("Rendering the WAV file…");
    oac.startRendering().then(function (buf) {
      download(new Blob([wav(buf)], { type: "audio/wav" }), "contour-loop.wav");
      status("Saved contour-loop.wav (" + WAV_LOOPS + " loops, " + Math.round(buf.duration) + " seconds).");
    }).catch(function () { status("Could not render the audio in this browser."); })
      .then(function () { $("cs-wav").disabled = false; });
  }
  function wav(buf) { // 16-bit PCM
    var ch = buf.numberOfChannels, len = buf.length, out = new DataView(new ArrayBuffer(44 + len * ch * 2)), data = [], o = 44;
    function str(at, t) { for (var i = 0; i < t.length; i++) out.setUint8(at + i, t.charCodeAt(i)); }
    str(0, "RIFF"); out.setUint32(4, 36 + len * ch * 2, true); str(8, "WAVE"); str(12, "fmt "); out.setUint32(16, 16, true);
    out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true);
    out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); str(36, "data"); out.setUint32(40, len * ch * 2, true);
    for (var c = 0; c < ch; c++) data.push(buf.getChannelData(c));
    for (var i = 0; i < len; i++) for (var k = 0; k < ch; k++) { var v = Math.max(-1, Math.min(1, data[k][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
    return out.buffer;
  }
  // General MIDI sound and octave for each instrument (chime sounds an octave up, bass an octave down).
  var GM = { keys: [0, 0], pluck: [25, 0], bell: [14, 0], marimba: [12, 0], flute: [73, 0], strings: [48, 0], chime: [9, 12], bass: [33, -12], bit: [80, 0] };
  function exportMidi() {
    if (!strokes.length) { status("Draw something first."); return; }
    var PPQ = 480, tps = PPQ * 4 / SPB(), spb = SPB(), unit = spb / 16, n = STEPS();
    var tick = function (step) { // step may be fractional; swing moves the off-beat sixteenths, as in playback
      var s16 = (step % spb) / unit, sw = step === Math.floor(step) && s16 === Math.floor(s16) && s16 % 2 === 1 ? cfg.swing * unit : 0;
      return Math.round((step + sw) * tps);
    };
    function vlq(v) { var b = [v & 0x7f]; while ((v >>= 7)) b.unshift((v & 0x7f) | 0x80); return b; }
    function track(evs, head) { // evs: [tick, bytes...]
      evs.sort(function (a, b) { return a[0] - b[0] || (a[1] & 0xf0) - (b[1] & 0xf0); }); // note-offs (0x80) before note-ons at the same tick
      var bytes = head || [], last = 0;
      evs.forEach(function (e) { bytes = bytes.concat(vlq(e[0] - last), e.slice(1)); last = e[0]; });
      bytes = bytes.concat([0, 0xff, 0x2f, 0]);
      return [0x4d, 0x54, 0x72, 0x6b, (bytes.length >>> 24) & 255, (bytes.length >>> 16) & 255, (bytes.length >>> 8) & 255, bytes.length & 255].concat(bytes);
    }
    function name(t) { var b = [0, 0xff, 0x03, t.length]; for (var i = 0; i < t.length; i++) b.push(t.charCodeAt(i) & 0x7f); return b; }
    var us = Math.round(60000000 / cfg.bpm), tracks = [track([], name("Contour Synth").concat([0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255, 0, 0xff, 0x58, 4, 4, 2, 24, 8]))];
    var notes = noteList();
    INSTRUMENTS.forEach(function (ins, i) {
      var mine = notes.filter(function (nt) { return nt.inst === i; }); if (!mine.length) return;
      var ch = i, gm = GM[ins.id], evs = [];
      mine.forEach(function (nt) {
        var key = Math.max(0, Math.min(127, nt.midi + gm[1])), a = tick(nt.start), b = Math.max(a + 1, Math.round((nt.start + nt.len) * tps));
        evs.push([a, 0x90 | ch, key, 92], [b, 0x80 | ch, key, 0]);
      });
      tracks.push(track(evs, name(ins.name).concat([0, 0xc0 | ch, gm[0]])));
    });
    if (cfg.drums) {
      var dv = [];
      for (var st = 0; st < n; st++) {
        var s16 = (st % spb) / unit; if (s16 !== Math.floor(s16)) continue;
        var hits = []; if (KICK.indexOf(s16) >= 0) hits.push([36, 100]); if (SNARE.indexOf(s16) >= 0) hits.push([38, 88]); if (s16 % 2 === 0) hits.push([42, 56]);
        hits.forEach(function (h) { var a = tick(st); dv.push([a, 0x99, h[0], h[1]], [a + Math.round(tps / 2), 0x89, h[0], 0]); });
      }
      tracks.push(track(dv, name("Drums")));
    }
    var head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, (PPQ >> 8) & 255, PPQ & 255];
    var all = head; tracks.forEach(function (t) { all = all.concat(t); });
    download(new Blob([new Uint8Array(all)], { type: "audio/midi" }), "contour-loop.mid");
    status("Saved contour-loop.mid: one loop, " + notes.length + (notes.length === 1 ? " note" : " notes") + (cfg.drums ? " and drums" : "") + ", one track per instrument.");
  }

  // ---------- share links: the drawing and settings, compressed into the part of the link after #
  function simplify(pts, eps) { // Ramer-Douglas-Peucker, keeps the shape with far fewer points
    if (pts.length < 3) return pts;
    var a = pts[0], b = pts[pts.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9, far = 0, idx = 0;
    for (var i = 1; i < pts.length - 1; i++) { var d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / L; if (d > far) { far = d; idx = i; } }
    if (far <= eps) return [a, b];
    return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
  }
  function b64url(bytes) { var s = ""; for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64url(t) { var s = atob(t.replace(/-/g, "+").replace(/_/g, "/")), b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
  function squeeze(bytes, how) {
    var S = how === "in" ? window.CompressionStream : window.DecompressionStream;
    if (!S) return Promise.reject(new Error("no compression"));
    return new Response(new Blob([bytes]).stream().pipeThrough(new S("deflate-raw"))).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function shareLink() {
    var o = pack(), r = function (x) { return Math.round(x * 1000) / 1000; };
    o.strokes = o.strokes.map(function (s) { return { i: s.i, p: simplify(s.p, 0.0015).map(function (q) { return [r(q[0]), r(q[1])]; }) }; });
    var text = new TextEncoder().encode(JSON.stringify(o));
    return squeeze(text, "in").then(function (z) { return "z" + b64url(z); }, function () { return "j" + b64url(text); })
      .then(function (code) { return location.origin + location.pathname + "#d=" + code; });
  }
  function readShared() {
    var m = /^#d=([zj])([A-Za-z0-9_-]+)$/.exec(location.hash); if (!m) return Promise.resolve(null);
    var bytes = unb64url(m[2]);
    return (m[1] === "z" ? squeeze(bytes, "out") : Promise.resolve(bytes)).then(function (b) { return JSON.parse(new TextDecoder().decode(b)); });
  }
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
    return Promise.reject(new Error("no clipboard"));
  }

  // ---------- shapes for Shuffle
  function line(x0, y0, x1, y1) { var p = []; for (var i = 0; i <= 40; i++) { var t = i / 40; p.push({ u: x0 + (x1 - x0) * t, v: y0 + (y1 - y0) * t }); } return p; }
  function wave(x0, y, x1, amp, k) { var p = []; for (var i = 0; i <= 80; i++) { var t = i / 80; p.push({ u: x0 + (x1 - x0) * t, v: y + amp * Math.sin(t * k * 2 * Math.PI) }); } return p; }
  function arc(cx, cy, r, a0, a1) { var p = [], ar = canvas.clientHeight / canvas.clientWidth; for (var i = 0; i <= 50; i++) { var a = a0 + (a1 - a0) * i / 50; p.push({ u: cx + Math.cos(a) * r * ar, v: cy + Math.sin(a) * r }); } return p; }
  function circle(cx, cy, r) { return arc(cx, cy, r, 0, 2 * Math.PI); }
  function spiral(cx, cy, r) { var p = [], ar = canvas.clientHeight / canvas.clientWidth; for (var i = 0; i <= 140; i++) { var t = i / 140, a = t * 6 * Math.PI; p.push({ u: cx + Math.cos(a) * r * t * ar, v: cy + Math.sin(a) * r * t }); } return p; }
  function zig(x0, y, x1, amp, k) { var p = []; for (var i = 0; i <= k; i++) p.push({ u: x0 + (x1 - x0) * i / k, v: y + (i % 2 ? -amp : amp) }); return line2(p); }
  function line2(pts) { var out = []; for (var i = 0; i < pts.length - 1; i++) { var a = pts[i], b = pts[i + 1]; for (var k = 0; k < 10; k++) out.push({ u: a.u + (b.u - a.u) * k / 10, v: a.v + (b.v - a.v) * k / 10 }); } out.push(pts[pts.length - 1]); return out; }
  function poly(pts) { return line2(pts.map(function (p) { return { u: p[0], v: p[1] }; })); }
  // ---------- scenes for Shuffle: places drawn as line art, each part on the instrument that suits it
  // (water on flute, sun on chime, ground on bass ...). Instruments: 0 keys, 1 pluck, 2 bell, 3 marimba,
  // 4 flute, 5 strings, 6 chime, 7 bass, 8 8-bit.
  function bez(a, c, b, k) { // quadratic curve from a to b, pulled towards c
    var p = []; k = k || 30;
    for (var i = 0; i <= k; i++) { var t = i / k, m = 1 - t; p.push({ u: m * m * a[0] + 2 * m * t * c[0] + t * t * b[0], v: m * m * a[1] + 2 * m * t * c[1] + t * t * b[1] }); }
    return p;
  }
  function scene(parts) { var out = parts.map(function (x) { return { inst: x[0], pts: x[1] }; }); out.forEach(analyse); return out; }
  function sail(a, tip, b) { return bez(a, [a[0] + (tip[0] - a[0]) * 0.3, tip[1] + (a[1] - tip[1]) * 0.25], tip).concat(poly([tip, b])); }
  function beach() {
    var gull = function (x, y) { return bez([x, y], [x + 0.012, y - 0.03], [x + 0.025, y + 0.012], 12).concat(bez([x + 0.025, y + 0.012], [x + 0.038, y - 0.03], [x + 0.05, y], 12)); };
    return scene([
      [6, circle(0.8, 0.2, 0.09)],
      [4, wave(0.0, 0.55, 0.99, 0.02, 4)], [4, wave(0.0, 0.63, 0.99, 0.018, 5)],
      [3, bez([0, 0.78], [0.5, 0.66], [0.99, 0.8])],
      [1, bez([0.2, 0.9], [0.15, 0.6], [0.24, 0.36])],
      [0, bez([0.24, 0.36], [0.15, 0.3], [0.1, 0.43])], [0, bez([0.24, 0.36], [0.31, 0.28], [0.39, 0.41])],
      [0, bez([0.24, 0.36], [0.2, 0.24], [0.12, 0.28])], [0, bez([0.24, 0.36], [0.29, 0.23], [0.36, 0.27])],
      [2, gull(0.44, 0.22)], [2, gull(0.53, 0.3)],
      [5, arc(0.63, 0.73, 0.08, Math.PI, 2 * Math.PI)], [5, poly([[0.63, 0.73], [0.63, 0.87]])],
      [7, wave(0.01, 0.94, 0.98, 0.015, 1.5)]
    ]);
  }
  function mountains() {
    var pine = function (x) { return poly([[x, 0.88], [x + 0.03, 0.77], [x + 0.06, 0.88]]); };
    return scene([
      [2, circle(0.12, 0.17, 0.06)],
      [4, poly([[0, 0.6], [0.1, 0.42], [0.18, 0.52], [0.3, 0.29], [0.42, 0.5], [0.52, 0.38], [0.62, 0.55], [0.75, 0.27], [0.86, 0.48], [0.99, 0.4]])],
      [6, poly([[0.27, 0.34], [0.3, 0.29], [0.33, 0.35]])], [6, poly([[0.72, 0.32], [0.75, 0.27], [0.78, 0.33]])],
      [5, poly([[0, 0.82], [0.14, 0.6], [0.26, 0.76], [0.4, 0.57], [0.55, 0.79], [0.68, 0.63], [0.82, 0.8], [0.99, 0.68]])],
      [0, pine(0.58)], [0, pine(0.66)], [0, pine(0.85)],
      [7, wave(0.01, 0.94, 0.98, 0.012, 3)]
    ]);
  }
  function desert() {
    return scene([
      [6, circle(0.15, 0.2, 0.08)],
      [1, poly([[0.4, 0.72], [0.52, 0.38], [0.64, 0.72]])], [1, poly([[0.6, 0.72], [0.68, 0.5], [0.76, 0.72]])], [1, poly([[0.75, 0.72], [0.8, 0.59], [0.85, 0.72]])],
      [3, bez([0, 0.8], [0.25, 0.6], [0.5, 0.82])], [3, bez([0.45, 0.84], [0.75, 0.66], [0.99, 0.8])],
      [0, poly([[0.2, 0.88], [0.2, 0.6]])], [0, poly([[0.2, 0.73], [0.15, 0.73], [0.15, 0.65]])], [0, poly([[0.2, 0.69], [0.25, 0.69], [0.25, 0.61]])],
      [3, bez([0.2, 0.9], [0.45, 0.78], [0.7, 0.9])],
      [7, wave(0.01, 0.95, 0.98, 0.01, 1)]
    ]);
  }
  function newYork() {
    return scene([
      [3, poly([[0.02, 0.85], [0.02, 0.6], [0.1, 0.6], [0.1, 0.7], [0.18, 0.7], [0.18, 0.55], [0.25, 0.55], [0.25, 0.85]])],
      // Empire State Building: set-backs and the spire
      [0, poly([[0.28, 0.85], [0.28, 0.45], [0.3, 0.45], [0.3, 0.36], [0.32, 0.36], [0.32, 0.27], [0.335, 0.27], [0.34, 0.09], [0.345, 0.27], [0.36, 0.27], [0.36, 0.36], [0.38, 0.36], [0.38, 0.45], [0.4, 0.45], [0.4, 0.85]])],
      // Chrysler Building: the stacked arches of the crown and its needle
      [2, poly([[0.46, 0.85], [0.46, 0.42], [0.475, 0.42]])], [2, arc(0.5, 0.42, 0.05, Math.PI, 2 * Math.PI)], [2, arc(0.5, 0.385, 0.035, Math.PI, 2 * Math.PI)],
      [2, arc(0.5, 0.35, 0.02, Math.PI, 2 * Math.PI)], [2, poly([[0.5, 0.33], [0.5, 0.19]])], [2, poly([[0.525, 0.42], [0.54, 0.42], [0.54, 0.85]])],
      // One World Trade Center: the tapering tower and its antenna
      [6, poly([[0.62, 0.85], [0.62, 0.4], [0.66, 0.18], [0.7, 0.4], [0.7, 0.85]])], [6, poly([[0.66, 0.18], [0.66, 0.05]])],
      [3, poly([[0.74, 0.85], [0.74, 0.62], [0.82, 0.62], [0.82, 0.5], [0.88, 0.5], [0.88, 0.85]])],
      // Statue of Liberty with her torch
      [5, poly([[0.92, 0.86], [0.93, 0.62], [0.94, 0.62], [0.95, 0.86]])], [5, circle(0.935, 0.59, 0.02)], [5, poly([[0.94, 0.62], [0.956, 0.48]])], [1, circle(0.956, 0.455, 0.013)],
      [4, wave(0.01, 0.91, 0.98, 0.015, 3)],
      [7, wave(0.01, 0.97, 0.98, 0.008, 1.5)]
    ]);
  }
  function copenhagen() {
    var house = function (x, top) { // a Nyhavn house with a stepped gable
      return poly([[x, 0.76], [x, top], [x + 0.02, top], [x + 0.02, top - 0.05], [x + 0.04, top - 0.1], [x + 0.06, top - 0.05], [x + 0.06, top], [x + 0.08, top], [x + 0.08, 0.76]]);
    };
    return scene([
      [3, house(0.03, 0.5)], [1, house(0.11, 0.46)], [0, house(0.19, 0.52)], [5, house(0.27, 0.47)], [2, house(0.35, 0.5)],
      [1, poly([[0.12, 0.82], [0.15, 0.86], [0.27, 0.86], [0.3, 0.82]])],
      // Church of Our Saviour: the tower and its corkscrew spire
      [8, poly([[0.55, 0.76], [0.55, 0.46], [0.61, 0.46], [0.61, 0.76]])],
      [6, poly([[0.55, 0.46], [0.61, 0.42], [0.555, 0.38], [0.605, 0.34], [0.56, 0.3], [0.6, 0.26], [0.565, 0.22], [0.595, 0.18], [0.58, 0.1]])],
      // The Round Tower
      [2, poly([[0.68, 0.76], [0.68, 0.42], [0.71, 0.42], [0.71, 0.36], [0.73, 0.36], [0.73, 0.42], [0.76, 0.42], [0.76, 0.76]])],
      // The Little Mermaid on her rock
      [7, arc(0.89, 0.83, 0.05, Math.PI, 2 * Math.PI)], [5, bez([0.875, 0.79], [0.86, 0.71], [0.89, 0.67])], [5, circle(0.89, 0.645, 0.016)],
      [4, wave(0.01, 0.84, 0.8, 0.015, 4)],
      [7, wave(0.01, 0.95, 0.98, 0.012, 2)]
    ]);
  }
  function sydney() {
    return scene([
      [1, circle(0.88, 0.15, 0.06)],
      // Sydney Harbour Bridge: the two arches, the deck and the pylons
      [5, bez([0.05, 0.62], [0.3, 0.12], [0.55, 0.62])], [5, bez([0.09, 0.62], [0.3, 0.24], [0.51, 0.62])],
      [0, poly([[0.01, 0.55], [0.59, 0.55]])],
      [3, poly([[0.03, 0.7], [0.03, 0.49], [0.07, 0.49], [0.07, 0.7]])], [3, poly([[0.53, 0.7], [0.53, 0.49], [0.57, 0.49], [0.57, 0.7]])],
      // Sydney Opera House: the shells
      [2, sail([0.62, 0.72], [0.69, 0.45], [0.7, 0.72])], [6, sail([0.69, 0.72], [0.77, 0.4], [0.78, 0.72])],
      [2, sail([0.77, 0.72], [0.85, 0.48], [0.86, 0.72])], [6, sail([0.85, 0.72], [0.92, 0.55], [0.93, 0.72])],
      [3, poly([[0.6, 0.72], [0.97, 0.72]])],
      [4, wave(0.01, 0.82, 0.98, 0.015, 4)], [4, wave(0.01, 0.89, 0.98, 0.012, 5)],
      [7, wave(0.01, 0.96, 0.98, 0.01, 1.5)]
    ]);
  }
  var SCENES = [
    { name: "a beach", draw: beach }, { name: "mountains", draw: mountains }, { name: "a desert with pyramids", draw: desert },
    { name: "New York: the Empire State, Chrysler and One World Trade Center buildings and the Statue of Liberty", draw: newYork },
    { name: "Copenhagen: Nyhavn, the spire of the Church of Our Saviour, the Round Tower and the Little Mermaid", draw: copenhagen },
    { name: "Sydney: the Harbour Bridge and the Opera House", draw: sydney }
  ];
  // A city with a river: skyline, windows, a second district, a bridge, a sun, a river and a bass line.
  function city() {
    var q = function (pts, i) { return { inst: i, pts: pts }; };
    var left = [[0.04, 0.62], [0.04, 0.40], [0.12, 0.40], [0.12, 0.30], [0.2, 0.3], [0.2, 0.46], [0.27, 0.46], [0.27, 0.22], [0.325, 0.12], [0.38, 0.22], [0.38, 0.38], [0.46, 0.38], [0.46, 0.33], [0.55, 0.33], [0.55, 0.62]];
    var right = [[0.64, 0.62], [0.64, 0.5], [0.72, 0.5], [0.72, 0.42], [0.8, 0.42], [0.8, 0.55], [0.87, 0.55], [0.87, 0.47], [0.95, 0.47], [0.95, 0.62]];
    var out = [q(poly(left), 0), q(poly(right), 3), q(circle(0.84, 0.2, 0.08), 6), q(wave(0.02, 0.8, 0.98, 0.035, 2.5), 4), q(wave(0.03, 0.93, 0.97, 0.03, 1.5), 7),
      q(poly([[0.55, 0.62], [0.64, 0.62]]), 5), q(arc(0.595, 0.7, 0.06, Math.PI, 2 * Math.PI), 5)];
    [[0.14, 0.38, 0.18], [0.14, 0.46, 0.18], [0.29, 0.3, 0.32], [0.29, 0.4, 0.32], [0.29, 0.5, 0.32], [0.4, 0.5, 0.44], [0.48, 0.45, 0.53], [0.74, 0.55, 0.78], [0.89, 0.55, 0.93]].forEach(function (w) { out.push(q(poly([[w[0], w[1]], [w[2], w[1]]]), 1)); });
    out.forEach(analyse);
    return out;
  }
  var shapeBag = [];

  // ---------- controls
  function status(msg) { $("cs-status").textContent = msg; }
  function update() {
    $("cs-play").textContent = playing ? "Stop" : "Play";
    $("cs-play").setAttribute("aria-pressed", String(playing));
    $("cs-undo").disabled = !history.length; $("cs-redo").disabled = !future.length; $("cs-clear").disabled = !strokes.length;
    var notes = noteList().length;
    status(strokes.length
      ? strokes.length + " line" + (strokes.length === 1 ? "" : "s") + ", " + notes + " note" + (notes === 1 ? "" : "s") + " per loop" + (cfg.follow === "notes" ? "" : " (gliding)") + ", " + cfg.scale.toLowerCase() + " in " + NOTE_NAMES[cfg.root] + (playing ? ". Keep drawing while it plays." : ". Press Play.")
      : "Pick a colour and draw on the paper. Press Play (or the space bar) to hear it loop.");
  }
  var chips = [];
  INSTRUMENTS.forEach(function (ins, i) {
    var wrap = document.createElement("span"), b = document.createElement("button"), pick = document.createElement("input");
    wrap.className = "cs-chip"; wrap.style.setProperty("--c", ins.color);
    pick.type = "color"; pick.className = "cs-pick"; pick.value = ins.color; pick.setAttribute("aria-label", "Colour for " + ins.name); pick.title = "Choose the colour of " + ins.name;
    pick.addEventListener("input", function () { ins.color = pick.value; wrap.style.setProperty("--c", ins.color); persist(); draw(); });
    b.type = "button"; b.className = "cs-color"; b.setAttribute("aria-pressed", String(i === inst)); b.title = ins.name + (ins.decay ? " (struck)" : " (held)");
    b.appendChild(document.createTextNode(ins.name));
    b.addEventListener("click", function () {
      inst = i; tool = "pen"; markTool();
      chips.forEach(function (c, j) { c.btn.setAttribute("aria-pressed", String(j === i)); });
      if (start()) { var t = audio.currentTime + 0.01; play(ins, hz(midiOf(Math.floor(ROWS() / 2))), t, 0.3, 0.8); }
    });
    wrap.appendChild(pick); wrap.appendChild(b); $("cs-palette").appendChild(wrap); chips.push({ wrap: wrap, btn: b, pick: pick });
  });
  var mixRows = [];
  INSTRUMENTS.forEach(function (ins, i) {
    var row = document.createElement("div"), label = document.createElement("span"), vol = document.createElement("input"), mute = document.createElement("button"), solo = document.createElement("button");
    row.className = "cs-mix-row"; row.style.setProperty("--c", ins.color);
    label.className = "cs-mix-name"; label.textContent = ins.name;
    vol.type = "range"; vol.min = 0; vol.max = 1; vol.step = 0.05; vol.setAttribute("aria-label", ins.name + " volume");
    mute.type = solo.type = "button"; mute.textContent = "M"; solo.textContent = "S";
    mute.title = "Mute " + ins.name; solo.title = "Solo " + ins.name + " (hear only the soloed instruments)";
    mute.setAttribute("aria-label", "Mute " + ins.name); solo.setAttribute("aria-label", "Solo " + ins.name);
    vol.addEventListener("input", function () { cfg.mix[i].v = Number(vol.value); applyMix(); persist(); });
    mute.addEventListener("click", function () { cfg.mix[i].m = !cfg.mix[i].m; syncMix(); applyMix(); update(); persist(); });
    solo.addEventListener("click", function () { cfg.mix[i].s = !cfg.mix[i].s; syncMix(); applyMix(); update(); persist(); });
    row.appendChild(label); row.appendChild(vol); row.appendChild(mute); row.appendChild(solo); $("cs-mix").appendChild(row);
    mixRows.push({ row: row, vol: vol, mute: mute, solo: solo });
  });
  function syncMix() {
    mixRows.forEach(function (r, i) {
      var m = cfg.mix[i]; r.vol.value = m.v; r.mute.setAttribute("aria-pressed", String(m.m)); r.solo.setAttribute("aria-pressed", String(m.s));
      r.row.classList.toggle("is-silent", !audible(i)); r.row.style.setProperty("--c", INSTRUMENTS[i].color);
    });
  }
  function syncColors() { chips.forEach(function (c, i) { c.pick.value = INSTRUMENTS[i].color; c.wrap.style.setProperty("--c", INSTRUMENTS[i].color); }); syncMix(); }
  function markTool() {
    $("cs-pen").setAttribute("aria-pressed", String(tool === "pen")); $("cs-erase").setAttribute("aria-pressed", String(tool === "erase"));
    canvas.style.cursor = tool === "erase" ? "none" : "crosshair";
  }
  Object.keys(SCALES).forEach(function (k) { var o = document.createElement("option"); o.value = o.textContent = k; $("cs-scale").appendChild(o); });
  NOTE_NAMES.forEach(function (k, i) { var o = document.createElement("option"); o.value = i; o.textContent = k; $("cs-root").appendChild(o); });
  function regrid() { strokes.forEach(analyse); update(); draw(); persist(); }
  function restart() { if (playing) { step = 0; stepLog = []; nextTime = audio.currentTime + 0.06; } }
  function undo() { if (!history.length) return; future.push(strokes); strokes = history.pop(); strokes.forEach(analyse); update(); draw(); persist(); }
  function redo() { if (!future.length) return; history.push(strokes); strokes = future.pop(); strokes.forEach(analyse); update(); draw(); persist(); }
  $("cs-play").addEventListener("click", toggle);
  $("cs-undo").addEventListener("click", undo);
  $("cs-redo").addEventListener("click", redo);
  $("cs-clear").addEventListener("click", function () { if (!strokes.length) return; pushHistory(); strokes = []; update(); draw(); persist(); });
  $("cs-pen").addEventListener("click", function () { tool = "pen"; markTool(); });
  $("cs-erase").addEventListener("click", function () { tool = tool === "erase" ? "pen" : "erase"; markTool(); });
  $("cs-shuffle").addEventListener("click", function () {
    // Scenes and abstract shapes in a shuffled order, each once before any repeats.
    // Scenes bring their own instruments; shapes use the instrument you have selected.
    var pool = SCENES.length + SHAPES.length;
    if (!shapeBag.length) { for (var i = 0; i < pool; i++) shapeBag.push(i); shapeBag.sort(function () { return Math.random() - 0.5; }); }
    var pick = shapeBag.pop(), label;
    pushHistory();
    if (pick < SCENES.length) { strokes = SCENES[pick].draw(); label = SCENES[pick].name; }
    else { strokes = SHAPES[pick - SCENES.length]().map(function (pts) { var s = { inst: inst, pts: pts }; analyse(s); return s; }); label = "a shape in " + INSTRUMENTS[inst].name; }
    update(); draw(); persist(); if (!playing) toggle();
    status("Shuffle: " + label + ". Press Shuffle again for another, or Undo to go back.");
  });
  $("cs-city").addEventListener("click", function () { pushHistory(); strokes = city(); update(); draw(); persist(); if (!playing) toggle(); });
  $("cs-scale").addEventListener("change", function () { cfg.scale = this.value; regrid(); });
  $("cs-root").addEventListener("change", function () { cfg.root = Number(this.value); regrid(); });
  $("cs-range").addEventListener("change", function () { cfg.octaves = Number(this.value); regrid(); });
  $("cs-oct-down").addEventListener("click", function () { cfg.shift = Math.max(-2, cfg.shift - 1); $("cs-oct").textContent = (cfg.shift > 0 ? "+" : "") + cfg.shift; regrid(); });
  $("cs-oct-up").addEventListener("click", function () { cfg.shift = Math.min(2, cfg.shift + 1); $("cs-oct").textContent = (cfg.shift > 0 ? "+" : "") + cfg.shift; regrid(); });
  function setTempo(v) { cfg.bpm = Math.max(50, Math.min(180, Math.round(v))); $("cs-tempo").value = cfg.bpm; $("cs-tempo-out").textContent = cfg.bpm + " BPM"; }
  $("cs-tempo").addEventListener("input", function () { setTempo(Number(this.value)); persist(); });
  var taps = [];
  $("cs-tap").addEventListener("click", function () {
    var now = performance.now(); taps = taps.filter(function (t) { return now - t < 2500; }); taps.push(now);
    if (taps.length > 1) setTempo(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)));
  });
  $("cs-swing").addEventListener("change", function () { cfg.swing = Number(this.value); persist(); });
  $("cs-length").addEventListener("change", function () { cfg.length = Number(this.value); regrid(); restart(); });
  $("cs-detail").addEventListener("change", function () { cfg.detail = Number(this.value); regrid(); restart(); });
  $("cs-paper").addEventListener("change", function () { cfg.paper = Number(this.value); canvas.className = "cs-canvas cs-paper-" + cfg.paper; persist(); resize(); });
  $("cs-width").addEventListener("change", function () { cfg.width = Number(this.value); persist(); draw(); });
  $("cs-follow").addEventListener("change", function () { cfg.follow = this.value; persist(); });
  $("cs-drums").addEventListener("change", function () { cfg.drums = this.checked; persist(); });
  $("cs-volume").addEventListener("input", function () { cfg.volume = Number(this.value); if (master) master.gain.value = cfg.volume; persist(); });
  $("cs-wav").addEventListener("click", exportWav);
  $("cs-midi").addEventListener("click", exportMidi);
  $("cs-mix-reset").addEventListener("click", function () { cfg.mix.forEach(function (m) { m.v = 1; m.m = false; m.s = false; }); syncMix(); applyMix(); update(); persist(); });
  $("cs-share").addEventListener("click", function () {
    if (!strokes.length) { status("Draw something first, then share it."); return; }
    shareLink().then(function (url) {
      var long = url.length > 8000 ? " It is a long link because the drawing is detailed; some apps may cut it short." : "";
      return copyText(url).then(function () { status("Link copied. Anyone who opens it hears this drawing." + long); },
        function () { window.prompt("Copy this link to share your drawing:", url); });
    }).catch(function () { status("Could not make a link in this browser."); });
  });
  document.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || ""; if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
    var mod = e.ctrlKey || e.metaKey, k = (e.key || "").toLowerCase();
    if (e.code === "Space" && (e.target === document.body || e.target === canvas)) { e.preventDefault(); toggle(); }
    else if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && k === "y") { e.preventDefault(); redo(); }
    else if (!mod && k === "e") { tool = tool === "erase" ? "pen" : "erase"; markTool(); }
    else if (!mod && k === "p") { tool = "pen"; markTool(); }
  });
  // ---------- saving: autosave in the browser, plus files
  function pack() {
    var r = function (x) { return Math.round(x * 10000) / 10000; };
    return { v: 2, cfg: cfg, colors: INSTRUMENTS.map(function (i) { return i.color; }), strokes: strokes.map(function (s) { return { i: s.inst, p: s.pts.map(function (p) { return [r(p.u), r(p.v)]; }) }; }) };
  }
  var saveTimer = 0;
  function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(function () { try { localStorage.setItem(STORE, JSON.stringify(pack())); } catch (e) {} }, 400); }
  function num(x, lo, hi, d) { x = Number(x); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d; }
  function unpack(o) { // returns true when o was a usable project
    if (!o || typeof o !== "object" || !Array.isArray(o.strokes)) return false;
    var c = o.cfg || {};
    if (SCALES[c.scale]) cfg.scale = c.scale;
    cfg.root = num(c.root, 0, 11, 0); cfg.octaves = num(c.octaves, 1, 3, 2); cfg.shift = num(c.shift, -2, 2, 0); cfg.bpm = num(c.bpm, 50, 180, 96);
    cfg.swing = [0, 0.12, 0.22, 0.33].indexOf(Number(c.swing)) >= 0 ? Number(c.swing) : 0; cfg.drums = c.drums !== false;
    cfg.length = [0, 1, 2, 4].indexOf(Number(c.length)) >= 0 ? Number(c.length) : 0; cfg.detail = Number(c.detail) === 32 ? 32 : 16;
    cfg.width = [2.5, 5, 9].indexOf(Number(c.width)) >= 0 ? Number(c.width) : 5; cfg.paper = num(c.paper, 0, 2, 0);
    cfg.follow = ["glide", "exact", "notes"].indexOf(c.follow) >= 0 ? c.follow : "glide";
    cfg.volume = Number.isFinite(+c.volume) ? Math.max(0, Math.min(1, +c.volume)) : 0.6;
    cfg.mix = INSTRUMENTS.map(function (_, i) {
      var m = Array.isArray(c.mix) && c.mix[i] || {};
      return { v: Number.isFinite(+m.v) ? Math.max(0, Math.min(1, +m.v)) : 1, m: m.m === true, s: m.s === true };
    });
    if (Array.isArray(o.colors)) INSTRUMENTS.forEach(function (ins, i) { if (/^#[0-9a-f]{6}$/i.test(o.colors[i])) ins.color = o.colors[i]; });
    strokes = [];
    o.strokes.slice(0, MAX_STROKES).forEach(function (s) {
      if (!s || !Array.isArray(s.p) || !INSTRUMENTS[s.i]) return;
      var pts = [];
      s.p.slice(0, MAX_POINTS).forEach(function (p) { if (Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])) pts.push({ u: Math.max(0, Math.min(0.9999, +p[0])), v: Math.max(0, Math.min(1, +p[1])) }); });
      if (pts.length >= 2) strokes.push({ inst: s.i, pts: pts });
    });
    return true;
  }
  function syncControls() {
    $("cs-scale").value = cfg.scale; $("cs-root").value = cfg.root; $("cs-range").value = cfg.octaves; $("cs-oct").textContent = (cfg.shift > 0 ? "+" : "") + cfg.shift;
    setTempo(cfg.bpm); $("cs-swing").value = String(cfg.swing); $("cs-drums").checked = cfg.drums; $("cs-length").value = String(cfg.length); $("cs-detail").value = String(cfg.detail);
    $("cs-follow").value = cfg.follow; $("cs-volume").value = cfg.volume; if (master) master.gain.value = cfg.volume; applyMix(); $("cs-paper").value = String(cfg.paper); $("cs-width").value = String(cfg.width); canvas.className = "cs-canvas cs-paper-" + cfg.paper; syncColors();
  }
  function download(blob, name) { var url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000); }
  $("cs-save").addEventListener("click", function () { download(new Blob([JSON.stringify(pack())], { type: "application/json" }), "contour-drawing.json"); status("Saved contour-drawing.json."); });
  $("cs-open").addEventListener("change", function () {
    var f = this.files[0], self = this; if (!f) return; var r = new FileReader();
    r.onload = function () {
      var ok = false; pushHistory();
      try { ok = unpack(JSON.parse(r.result)); } catch (e) {}
      if (!ok) { history.pop(); status("That file is not a Contour Synth drawing."); } else { syncControls(); regrid(); restart(); status("Opened " + f.name + "."); }
      self.value = "";
    };
    r.readAsText(f);
  });
  $("cs-picture").addEventListener("click", function () { canvas.toBlob(function (b) { if (b) { download(b, "contour-picture.png"); status("Saved the picture as contour-picture.png."); } }); });
  $("cs-reset-colors").addEventListener("click", function () { INSTRUMENTS.forEach(function (ins, i) { ins.color = DEFAULT_COLORS[i]; }); syncColors(); persist(); draw(); });
  if (saved) unpack(saved);
  syncControls(); markTool();
  var rt; window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(resize, 100); });
  resize(); update();
  readShared().then(function (o) {
    if (!o) return;
    var hadOwn = strokes.length > 0;
    pushHistory();
    if (!unpack(o)) { history.pop(); status("That link does not contain a Contour Synth drawing."); return; }
    syncControls(); regrid(); update();
    window.history.replaceState(null, "", location.pathname + location.search);
    status("Opened a shared drawing. Press Play to hear it" + (hadOwn ? "; Undo brings back your own drawing." : "."));
  }).catch(function () { status("That share link is damaged or incomplete."); });
})();
