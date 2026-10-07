// Contour Synth: a drawing instrument. Every line you draw is a voice in a looping piano roll:
// left to right is time, height is pitch on the chosen scale, and every grid cell a line passes
// through sounds. Shapes become chords (a circle plays its top and bottom together), lines become
// melodies, and the colour you draw with picks the instrument. A drum groove keeps time.
// Web Audio API only, no libraries.
(function () {
  "use strict";
  var MAX_STROKES = 400, MAX_POINTS = 4000, MAX_CHORD = 3, MAX_PER_INST = 4, MAX_NOTES = 12, STORE = "contour.v2";
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
  var cfg = { scale: "Major pentatonic", root: 0, octaves: 2, shift: 0, bpm: 96, swing: 0, drums: true, length: 0, detail: 16, width: 5, paper: 0 };
  var audio = null, bus, dry, verb, master, noise;
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
    preview(current.pts[0]); draw();
  });
  canvas.addEventListener("pointermove", function (e) {
    var q = xy(e); pointer = q;
    if (erasing) { if (eraseAt(q.x, q.y)) update(); draw(); return; }
    if (!current) { if (tool === "erase") draw(); return; }
    var p = at(e), last = current.pts[current.pts.length - 1];
    if (Math.abs(p.u - last.u) + Math.abs(p.v - last.v) < 0.003 || current.pts.length >= MAX_POINTS) return;
    if (rowAt(p.v) !== rowAt(last.v)) preview(p);
    current.pts.push(p); draw();
  });
  function finish() {
    if (erasing) { erasing = false; update(); persist(); draw(); return; }
    if (!current) return;
    analyse(current);
    if (current.events.some(function (e) { return e.length; })) { pushHistory(); strokes.push(current); }
    current = null; update(); persist(); draw();
  }
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("pointerleave", function () { if (!current && !erasing) { pointer = null; draw(); } });

  // ---------- audio engine
  function start() {
    if (!audio) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { status("This browser does not support the Web Audio API."); return false; }
      audio = new AC();
      master = audio.createGain(); master.gain.value = Number($("cs-volume").value);
      var clip = audio.createWaveShaper(), curve = new Float32Array(1024);
      for (var i = 0; i < 1024; i++) { var x = i / 511.5 - 1; curve[i] = Math.tanh(1.6 * x) / Math.tanh(1.6); }
      clip.curve = curve;
      bus = audio.createGain(); dry = audio.createGain(); dry.gain.value = 0.85;
      verb = audio.createConvolver(); verb.buffer = impulse(2.4); var wet = audio.createGain(); wet.gain.value = 0.28;
      bus.connect(dry); bus.connect(verb); verb.connect(wet);
      dry.connect(master); wet.connect(master); master.connect(clip); clip.connect(audio.destination);
      noise = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
      var d = noise.getChannelData(0); for (var j = 0; j < d.length; j++) d[j] = Math.random() * 2 - 1;
    }
    if (audio.state === "suspended") audio.resume();
    return true;
  }
  function impulse(sec) {
    var len = Math.round(audio.sampleRate * sec), b = audio.createBuffer(2, len, audio.sampleRate);
    for (var c = 0; c < 2; c++) { var d = b.getChannelData(c); for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    return b;
  }
  function osc(type, freq, t, end, dest, level, detune) {
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (detune) o.detune.value = detune;
    g.gain.value = level == null ? 1 : level; o.connect(g); g.connect(dest); o.start(t); o.stop(end);
    return o;
  }
  function lowpass(f, dest) { var b = audio.createBiquadFilter(); b.type = "lowpass"; b.frequency.value = f; b.connect(dest); return b; }

  function play(ins, freq, t, dur, vel) {
    var amp = audio.createGain(), p = ins.peak * (vel || 1), end;
    amp.connect(bus);
    amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(p, t + ins.attack);
    if (ins.decay) { amp.gain.setTargetAtTime(0, t + ins.attack, ins.decay / 4); end = t + ins.decay * 1.6; }
    else { amp.gain.setValueAtTime(p, t + Math.max(ins.attack, dur - 0.03)); amp.gain.setTargetAtTime(0, t + dur, 0.07); end = t + dur + 0.6; }
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
        var m = audio.createOscillator(); m.frequency.value = freq * 3.5; m.connect(mod); mod.connect(car.frequency); m.start(t); m.stop(end);
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
  }
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
  function schedule() {
    var n = STEPS(), spb = SPB(), unit = spb / 16;
    while (nextTime < audio.currentTime + 0.12) {
      var sd = stepDur(), s16 = (step % spb) / unit, whole = s16 === Math.floor(s16);
      var t = nextTime + (whole && s16 % 2 === 1 ? cfg.swing * unit * sd : 0);
      stepLog.push({ step: step, t: nextTime, n: n }); if (stepLog.length > 64) stepLog.shift();
      if (cfg.drums && whole) {
        if (KICK.indexOf(s16) >= 0) drum("kick", t);
        if (SNARE.indexOf(s16) >= 0) drum("snare", t);
        if (s16 % 2 === 0) drum("hat", t);
      }
      var list = notesAt(step), vel = Math.min(1, Math.sqrt(5 / Math.max(1, list.length)));
      list.forEach(function (nt) {
        var ins = INSTRUMENTS[nt.inst];
        play(ins, hz(midiOf(nt.row)), t, nt.len * sd, vel * (0.85 + Math.random() * 0.15));
        flashes.push({ t: t, step: step, row: nt.row, color: ins.color });
      });
      nextTime += sd; step = (step + 1) % n;
    }
  }
  function playhead() {
    if (!playing || !audio) return -1;
    var now = audio.currentTime, last = null;
    for (var i = stepLog.length - 1; i >= 0; i--) if (stepLog[i].t <= now) { last = stepLog[i]; break; }
    if (!last) return -1;
    return Math.min(1, (last.step + Math.min(1, (now - last.t) / stepDur())) / last.n);
  }
  function preview(p) {
    if (!audio || playing) return;
    var ins = INSTRUMENTS[current ? current.inst : inst], t = audio.currentTime + 0.01;
    play(ins, hz(midiOf(rowAt(p.v))), t, 0.25, 0.8);
    flashes.push({ t: t, step: Math.floor(p.u * STEPS()), row: rowAt(p.v), color: ins.color });
    requestAnimationFrame(loop);
  }
  function toggle() {
    if (playing) { playing = false; clearInterval(timer); update(); draw(); return; }
    if (!start()) return;
    playing = true; step = 0; stepLog = []; nextTime = audio.currentTime + 0.06;
    schedule(); timer = setInterval(schedule, 25); update(); requestAnimationFrame(loop);
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
    var notes = strokes.reduce(function (n, s) { return n + s.events.reduce(function (a, e) { return a + e.length; }, 0); }, 0);
    status(strokes.length
      ? strokes.length + " line" + (strokes.length === 1 ? "" : "s") + ", " + notes + " notes per loop, " + cfg.scale.toLowerCase() + " in " + NOTE_NAMES[cfg.root] + (playing ? ". Keep drawing while it plays." : ". Press Play.")
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
  function syncColors() { chips.forEach(function (c, i) { c.pick.value = INSTRUMENTS[i].color; c.wrap.style.setProperty("--c", INSTRUMENTS[i].color); }); }
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
    if (!shapeBag.length) shapeBag = SHAPES.map(function (_, i) { return i; }).sort(function () { return Math.random() - 0.5; });
    pushHistory();
    strokes = SHAPES[shapeBag.pop()]().map(function (pts) { var s = { inst: inst, pts: pts }; analyse(s); return s; });
    update(); draw(); persist(); if (!playing) toggle();
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
  $("cs-drums").addEventListener("change", function () { cfg.drums = this.checked; persist(); });
  $("cs-volume").addEventListener("input", function () { if (master) master.gain.value = Number(this.value); });
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
    $("cs-paper").value = String(cfg.paper); $("cs-width").value = String(cfg.width); canvas.className = "cs-canvas cs-paper-" + cfg.paper; syncColors();
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
})();
