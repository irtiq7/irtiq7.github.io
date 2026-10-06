// Contour Synth: a drawing instrument. Every line you draw is a voice in a looping piano roll:
// left to right is time, height is pitch on the chosen scale, and every grid cell a line passes
// through sounds. Shapes become chords (a circle plays its top and bottom together), lines become
// melodies, and the colour you draw with picks the instrument. A drum groove keeps time.
// Web Audio API only, no libraries.
(function () {
  "use strict";
  var STEPS_PER_BAR = 16, MAX_STROKES = 24, MAX_CHORD = 3;
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
  var strokes = [], current = null, inst = 0;
  var cfg = { scale: "Major pentatonic", root: 0, octaves: 2, shift: 0, bpm: 96, swing: 0, drums: true };
  var audio = null, bus, dry, verb, master, noise;
  var playing = false, step = 0, nextTime = 0, timer = null, stepLog = [], flashes = [];

  // ---------- grid
  function bars() { return canvas.clientWidth >= 700 ? 2 : 1; }
  function STEPS() { return STEPS_PER_BAR * bars(); }
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
      ctx.strokeStyle = s % STEPS_PER_BAR === 0 ? "rgba(43,42,38,0.3)" : s % 4 === 0 ? "rgba(43,42,38,0.14)" : "rgba(43,42,38,0.05)";
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
      ctx.strokeStyle = INSTRUMENTS[st.inst].color; ctx.lineWidth = 5; ctx.lineJoin = ctx.lineCap = "round";
      ctx.beginPath();
      st.pts.forEach(function (p, i) { if (i && !p.brk) ctx.lineTo(p.u * w, p.v * h); else ctx.moveTo(p.u * w, p.v * h); });
      ctx.stroke();
    });
    var pos = playhead();
    if (pos >= 0) {
      var px = pos * w;
      ctx.strokeStyle = "rgba(43,42,38,0.75)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    }
    if (!strokes.length && !current) {
      ctx.fillStyle = "rgba(43,42,38,0.55)"; ctx.font = "15px ui-monospace, monospace"; ctx.textAlign = "center";
      ctx.fillText("Draw anything. Lines play melodies, shapes play chords.", w / 2, h / 2); ctx.textAlign = "start";
    }
  }
  function loop() { draw(); if (playing || flashes.length) requestAnimationFrame(loop); }

  function at(e) {
    var r = canvas.getBoundingClientRect();
    return { u: Math.max(0, Math.min(0.9999, (e.clientX - r.left) / r.width)), v: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  }
  canvas.addEventListener("pointerdown", function (e) {
    if (strokes.length >= MAX_STROKES) { status("That is a full canvas. Undo or clear to draw more."); return; }
    canvas.setPointerCapture(e.pointerId);
    start();
    current = { inst: inst, pts: [at(e)] };
    preview(current.pts[0]); draw();
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!current) return;
    var p = at(e), last = current.pts[current.pts.length - 1];
    if (Math.abs(p.u - last.u) + Math.abs(p.v - last.v) < 0.003) return;
    if (rowAt(p.v) !== rowAt(last.v)) preview(p);
    current.pts.push(p); draw();
  });
  function finish() {
    if (!current) return;
    analyse(current);
    if (current.events.some(function (e) { return e.length; })) strokes.push(current);
    current = null; update(); draw();
  }
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);

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

  function stepDur() { return 60 / cfg.bpm / 4; }
  function schedule() {
    var n = STEPS();
    while (nextTime < audio.currentTime + 0.12) {
      var t = nextTime + (step % 2 ? cfg.swing * stepDur() : 0), b = step % STEPS_PER_BAR;
      stepLog.push({ step: step, t: nextTime, n: n }); if (stepLog.length > 64) stepLog.shift();
      if (cfg.drums) {
        if (KICK.indexOf(b) >= 0) drum("kick", t);
        if (SNARE.indexOf(b) >= 0) drum("snare", t);
        if (b % 2 === 0) drum("hat", t);
      }
      strokes.forEach(function (s) {
        var ins = INSTRUMENTS[s.inst];
        (s.events[step] || []).forEach(function (ev) {
          play(ins, hz(midiOf(ev.row)), t, ev.len * stepDur(), 0.85 + Math.random() * 0.15);
          flashes.push({ t: t, step: step, row: ev.row, color: ins.color });
        });
      });
      nextTime += stepDur(); step = (step + 1) % n;
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
  var shapeBag = [];

  // ---------- controls
  function status(msg) { $("cs-status").textContent = msg; }
  function update() {
    $("cs-play").textContent = playing ? "Stop" : "Play";
    $("cs-play").setAttribute("aria-pressed", String(playing));
    $("cs-undo").disabled = $("cs-clear").disabled = !strokes.length;
    var notes = strokes.reduce(function (n, s) { return n + s.events.reduce(function (a, e) { return a + e.length; }, 0); }, 0);
    status(strokes.length
      ? strokes.length + " line" + (strokes.length === 1 ? "" : "s") + ", " + notes + " notes per loop, " + cfg.scale.toLowerCase() + " in " + NOTE_NAMES[cfg.root] + (playing ? ". Keep drawing while it plays." : ". Press Play.")
      : "Pick a colour and draw on the paper. Press Play (or the space bar) to hear it loop.");
  }
  INSTRUMENTS.forEach(function (ins, i) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "cs-color"; b.style.setProperty("--c", ins.color);
    b.setAttribute("aria-pressed", String(i === inst)); b.title = ins.name + (ins.decay ? " (struck)" : " (held)");
    b.innerHTML = '<span class="cs-dot" aria-hidden="true"></span>'; b.appendChild(document.createTextNode(ins.name));
    b.addEventListener("click", function () {
      inst = i;
      Array.prototype.forEach.call($("cs-palette").children, function (x, j) { x.setAttribute("aria-pressed", String(j === i)); });
      if (start()) { var t = audio.currentTime + 0.01; play(ins, hz(midiOf(Math.floor(ROWS() / 2))), t, 0.3, 0.8); }
    });
    $("cs-palette").appendChild(b);
  });
  Object.keys(SCALES).forEach(function (k) { var o = document.createElement("option"); o.value = o.textContent = k; $("cs-scale").appendChild(o); });
  NOTE_NAMES.forEach(function (k, i) { var o = document.createElement("option"); o.value = i; o.textContent = k; $("cs-root").appendChild(o); });
  function regrid() { strokes.forEach(analyse); update(); draw(); }
  $("cs-play").addEventListener("click", toggle);
  $("cs-undo").addEventListener("click", function () { strokes.pop(); update(); draw(); });
  $("cs-clear").addEventListener("click", function () { strokes = []; update(); draw(); });
  $("cs-shuffle").addEventListener("click", function () {
    if (!shapeBag.length) shapeBag = SHAPES.map(function (_, i) { return i; }).sort(function () { return Math.random() - 0.5; });
    strokes = SHAPES[shapeBag.pop()]().map(function (pts) { var s = { inst: inst, pts: pts }; analyse(s); return s; });
    update(); draw(); if (!playing) toggle();
  });
  $("cs-scale").addEventListener("change", function () { cfg.scale = this.value; regrid(); });
  $("cs-root").addEventListener("change", function () { cfg.root = Number(this.value); regrid(); });
  $("cs-range").addEventListener("change", function () { cfg.octaves = Number(this.value); regrid(); });
  $("cs-oct-down").addEventListener("click", function () { cfg.shift = Math.max(-2, cfg.shift - 1); $("cs-oct").textContent = (cfg.shift > 0 ? "+" : "") + cfg.shift; regrid(); });
  $("cs-oct-up").addEventListener("click", function () { cfg.shift = Math.min(2, cfg.shift + 1); $("cs-oct").textContent = (cfg.shift > 0 ? "+" : "") + cfg.shift; regrid(); });
  function setTempo(v) { cfg.bpm = Math.max(50, Math.min(180, Math.round(v))); $("cs-tempo").value = cfg.bpm; $("cs-tempo-out").textContent = cfg.bpm + " BPM"; }
  $("cs-tempo").addEventListener("input", function () { setTempo(Number(this.value)); });
  var taps = [];
  $("cs-tap").addEventListener("click", function () {
    var now = performance.now(); taps = taps.filter(function (t) { return now - t < 2500; }); taps.push(now);
    if (taps.length > 1) setTempo(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)));
  });
  $("cs-swing").addEventListener("change", function () { cfg.swing = Number(this.value); });
  $("cs-drums").addEventListener("change", function () { cfg.drums = this.checked; });
  $("cs-volume").addEventListener("input", function () { if (master) master.gain.value = Number(this.value); });
  document.addEventListener("keydown", function (e) {
    if (e.code === "Space" && (e.target === document.body || e.target === canvas)) { e.preventDefault(); toggle(); }
  });
  var rt; window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(resize, 100); });
  resize(); update();
})();
