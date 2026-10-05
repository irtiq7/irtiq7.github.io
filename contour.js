// Contour Synth: draw lines on a grid; each line (contour) becomes a melody.
// Horizontal position is time (a loop of STEPS sixteenth notes), height is pitch on the chosen scale.
// Plain Web Audio API, no libraries.
(function () {
  "use strict";
  var STEPS = 32, ROWS = 15, MAX_CONTOURS = 8;
  var SCALES = {
    pentatonic: [0, 2, 4, 7, 9],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    blues: [0, 3, 5, 6, 7, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10]
  };
  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  // Each new contour gets the next voice: a colour and a timbre.
  var VOICES = [
    { name: "Glass", color: "#00f0ff", wave: "sine", cutoff: 6000, attack: 0.01, release: 0.5, gain: 0.32 },
    { name: "Reed", color: "#ff2bd6", wave: "square", cutoff: 1400, attack: 0.02, release: 0.25, gain: 0.14 },
    { name: "Flute", color: "#fcee0a", wave: "triangle", cutoff: 4000, attack: 0.05, release: 0.35, gain: 0.3 },
    { name: "Pad", color: "#9d7bff", wave: "sawtooth", cutoff: 900, attack: 0.12, release: 0.8, gain: 0.12 },
    { name: "Pluck", color: "#3ddc84", wave: "triangle", cutoff: 2500, attack: 0.003, release: 0.18, gain: 0.34 },
    { name: "Brass", color: "#ff8a3d", wave: "sawtooth", cutoff: 2200, attack: 0.04, release: 0.3, gain: 0.12 }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $("cs-canvas"), ctx = canvas.getContext("2d");
  var contours = [], drawing = null, voiceIndex = 0;
  var audio = null, master = null, playing = false, step = 0, nextTime = 0, timer = null, startedAt = 0;
  var settings = { scale: "pentatonic", root: 0, bpm: 100, glide: false };

  // ---------- geometry
  function size() {
    var r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    contours.forEach(analyse);
    draw();
  }
  function W() { return canvas.getBoundingClientRect().width; }
  function H() { return canvas.getBoundingClientRect().height; }
  function rowOf(y) { return Math.max(0, Math.min(ROWS - 1, Math.floor((1 - y / H()) * ROWS))); }
  function rowY(row) { return H() - (row + 0.5) * H() / ROWS; }
  function midiOf(row) {
    var sc = SCALES[settings.scale], oct = Math.floor(row / sc.length);
    return 48 + settings.root + oct * 12 + sc[row % sc.length];
  }
  function hz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function name(midi) { return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1); }

  // Turn a stroke into one height per step (interpolating across fast strokes), then into notes.
  function analyse(c) {
    var w = W(), colW = w / STEPS, ys = new Array(STEPS).fill(null), sums = new Array(STEPS).fill(0), counts = new Array(STEPS).fill(0);
    var pts = c.points.map(function (p) { return { x: p.u * w, y: p.v * H() }; });
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[i + 1] || a;
      var n = Math.max(1, Math.ceil(Math.abs(b.x - a.x) / (colW / 4)));
      for (var k = 0; k <= n; k++) {
        var x = a.x + (b.x - a.x) * k / n, y = a.y + (b.y - a.y) * k / n, col = Math.floor(x / colW);
        if (col >= 0 && col < STEPS) { sums[col] += y; counts[col]++; }
      }
    }
    for (var s = 0; s < STEPS; s++) if (counts[s]) ys[s] = sums[s] / counts[s];
    c.ys = ys;
    // Quantized notes: consecutive steps on the same row merge into one longer note.
    c.notes = [];
    for (var t = 0; t < STEPS; t++) {
      if (ys[t] == null) continue;
      var row = rowOf(ys[t]), last = c.notes[c.notes.length - 1];
      if (last && last.start + last.len === t && last.row === row) last.len++;
      else c.notes.push({ start: t, len: 1, row: row });
    }
    // Glide phrases: contiguous runs of steps, each sung by one oscillator that follows the line.
    c.runs = [];
    for (var u = 0; u < STEPS; u++) {
      if (ys[u] == null) continue;
      var run = c.runs[c.runs.length - 1];
      if (run && run.start + run.ys.length === u) run.ys.push(ys[u]);
      else c.runs.push({ start: u, ys: [ys[u]] });
    }
  }

  // ---------- drawing
  function draw() {
    var w = W(), h = H();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#070812"; ctx.fillRect(0, 0, w, h);
    var sc = SCALES[settings.scale];
    for (var r = 0; r < ROWS; r++) {
      var y = rowY(r), isRoot = r % sc.length === 0;
      ctx.strokeStyle = isRoot ? "rgba(0,240,255,0.22)" : "rgba(38,42,82,0.9)";
      ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); ctx.stroke();
      if (isRoot) { ctx.fillStyle = "rgba(155,168,204,0.7)"; ctx.font = "11px ui-monospace, monospace"; ctx.fillText(name(midiOf(r)), 6, y - 4); }
    }
    for (var s = 0; s <= STEPS; s += 4) {
      var x = Math.round(s * w / STEPS) + 0.5;
      ctx.strokeStyle = s % 16 === 0 ? "rgba(255,43,214,0.28)" : "rgba(38,42,82,0.9)";
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    var cur = playing ? currentStep() : -1;
    contours.concat(drawing ? [drawing] : []).forEach(function (c) {
      var v = VOICES[c.voice];
      // quantized notes as faint bars, so you can see what will sound
      if (c.notes && !settings.glide) {
        ctx.fillStyle = v.color + "33";
        c.notes.forEach(function (n) { ctx.fillRect(n.start * w / STEPS + 1, rowY(n.row) - h / ROWS / 2 + 2, n.len * w / STEPS - 2, h / ROWS - 4); });
      }
      ctx.strokeStyle = v.color; ctx.lineWidth = 3; ctx.lineJoin = ctx.lineCap = "round";
      ctx.shadowColor = v.color; ctx.shadowBlur = 8;
      ctx.beginPath();
      c.points.forEach(function (p, i) { var px = p.u * w, py = p.v * h; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.stroke(); ctx.shadowBlur = 0;
      if (cur >= 0 && c.ys && c.ys[cur] != null) {
        var cy = settings.glide ? c.ys[cur] : rowY(rowOf(c.ys[cur]));
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc((cur + 0.5) * w / STEPS, cy, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = v.color; ctx.lineWidth = 2; ctx.stroke();
      }
    });
    if (cur >= 0) {
      ctx.fillStyle = "rgba(0,240,255,0.08)"; ctx.fillRect(cur * w / STEPS, 0, w / STEPS, h);
    }
    if (!contours.length && !drawing) {
      ctx.fillStyle = "rgba(155,168,204,0.75)"; ctx.font = "15px ui-monospace, monospace"; ctx.textAlign = "center";
      ctx.fillText("Draw a line here. Higher means higher notes.", w / 2, h / 2); ctx.textAlign = "start";
    }
  }

  function pointFrom(e) {
    var r = canvas.getBoundingClientRect();
    return { u: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), v: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  }
  canvas.addEventListener("pointerdown", function (e) {
    if (contours.length >= MAX_CONTOURS) { status("Up to " + MAX_CONTOURS + " contours. Undo or clear to draw more."); return; }
    canvas.setPointerCapture(e.pointerId);
    drawing = { voice: voiceIndex % VOICES.length, points: [pointFrom(e)] };
    ensureAudio();
    preview(drawing.points[0]);
    draw();
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!drawing) return;
    var p = pointFrom(e), last = drawing.points[drawing.points.length - 1];
    if (Math.abs(p.u - last.u) + Math.abs(p.v - last.v) < 0.002) return;
    if (rowOf(p.v * H()) !== rowOf(last.v * H())) preview(p);
    drawing.points.push(p); draw();
  });
  function finish() {
    if (!drawing) return;
    analyse(drawing);
    if (drawing.notes.length) { contours.push(drawing); voiceIndex++; }
    drawing = null; updateUI(); draw();
  }
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);

  // ---------- audio
  function ensureAudio() {
    if (!audio) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { status("This browser does not support the Web Audio API."); return false; }
      audio = new AC();
      var comp = audio.createDynamicsCompressor();
      master = audio.createGain(); master.gain.value = Number($("cs-volume").value);
      master.connect(comp); comp.connect(audio.destination);
    }
    if (audio.state === "suspended") audio.resume();
    return true;
  }
  function voiceChain(v, when) {
    var osc = audio.createOscillator(), filter = audio.createBiquadFilter(), amp = audio.createGain();
    osc.type = v.wave; filter.type = "lowpass"; filter.frequency.value = v.cutoff; filter.Q.value = 0.7;
    amp.gain.setValueAtTime(0, when);
    osc.connect(filter); filter.connect(amp); amp.connect(master);
    return { osc: osc, amp: amp };
  }
  function playNote(v, freq, when, dur) {
    var n = voiceChain(v, when);
    n.osc.frequency.setValueAtTime(freq, when);
    n.amp.gain.linearRampToValueAtTime(v.gain, when + v.attack);
    n.amp.gain.setTargetAtTime(v.gain * 0.7, when + v.attack, 0.1);
    n.amp.gain.setTargetAtTime(0, when + dur, v.release / 4);
    n.osc.start(when); n.osc.stop(when + dur + v.release * 2);
  }
  function playGlide(v, ys, when, stepDur) {
    var n = voiceChain(v, when);
    var f = function (y) { var row = (1 - y / H()) * ROWS - 0.5, lo = Math.floor(row), t = row - lo;
      var m = function (r) { r = Math.max(0, Math.min(ROWS - 1, r)); return midiOf(r); };
      return hz(m(lo) + (m(lo + 1) - m(lo)) * t); };
    n.osc.frequency.setValueAtTime(f(ys[0]), when);
    ys.forEach(function (y, i) { n.osc.frequency.linearRampToValueAtTime(f(y), when + (i + 0.5) * stepDur); });
    var dur = ys.length * stepDur;
    n.amp.gain.linearRampToValueAtTime(v.gain, when + v.attack);
    n.amp.gain.setTargetAtTime(0, when + dur, v.release / 4);
    n.osc.start(when); n.osc.stop(when + dur + v.release * 2);
  }
  function preview(p) {
    if (!audio || playing) return;
    playNote(VOICES[drawing ? drawing.voice : 0], hz(midiOf(rowOf(p.v * H()))), audio.currentTime + 0.01, 0.12);
  }
  function stepDur() { return 60 / settings.bpm / 4; }
  function schedule() {
    while (nextTime < audio.currentTime + 0.12) {
      var sd = stepDur();
      contours.forEach(function (c) {
        var v = VOICES[c.voice];
        if (settings.glide) c.runs.forEach(function (r) { if (r.start === step) playGlide(v, r.ys, nextTime, sd); });
        else c.notes.forEach(function (n) { if (n.start === step) playNote(v, hz(midiOf(n.row)), nextTime, n.len * sd); });
      });
      if (step === 0) startedAt = nextTime;
      nextTime += sd; step = (step + 1) % STEPS;
    }
  }
  function currentStep() {
    if (!audio) return -1;
    var t = audio.currentTime - startedAt;
    return t < 0 ? -1 : Math.floor(t / stepDur()) % STEPS;
  }
  function frame() { if (!playing) return; draw(); requestAnimationFrame(frame); }
  function play() {
    if (!contours.length) { status("Draw a contour first."); return; }
    if (!ensureAudio()) return;
    playing = true; step = 0; nextTime = audio.currentTime + 0.06; startedAt = nextTime;
    schedule(); timer = setInterval(schedule, 25);
    updateUI(); requestAnimationFrame(frame);
  }
  function stop() { playing = false; clearInterval(timer); updateUI(); draw(); }

  // ---------- controls
  function status(msg) { $("cs-status").textContent = msg; }
  function updateUI() {
    $("cs-play").textContent = playing ? "Stop" : "Play";
    $("cs-play").setAttribute("aria-pressed", playing ? "true" : "false");
    $("cs-undo").disabled = $("cs-clear").disabled = !contours.length;
    var next = VOICES[voiceIndex % VOICES.length];
    $("cs-next").textContent = next.name; $("cs-next").style.color = next.color;
    var legend = $("cs-legend"); legend.textContent = "";
    contours.forEach(function (c, i) {
      var v = VOICES[c.voice], li = document.createElement("li"), sw = document.createElement("span");
      sw.className = "cs-swatch"; sw.style.background = v.color; li.appendChild(sw);
      li.appendChild(document.createTextNode("Contour " + (i + 1) + ": " + v.name + ", " + c.notes.length + " note" + (c.notes.length === 1 ? "" : "s") +
        " (" + name(midiOf(c.notes[0].row)) + " to " + name(midiOf(c.notes[c.notes.length - 1].row)) + ")"));
      legend.appendChild(li);
    });
    status(contours.length ? contours.length + " contour" + (contours.length === 1 ? "" : "s") + (playing ? ", playing in a loop." : ". Press Play.") : "Draw on the grid to begin.");
  }
  $("cs-play").addEventListener("click", function () { playing ? stop() : play(); });
  $("cs-undo").addEventListener("click", function () { contours.pop(); voiceIndex = Math.max(0, voiceIndex - 1); if (!contours.length) stop(); updateUI(); draw(); });
  $("cs-clear").addEventListener("click", function () { contours = []; voiceIndex = 0; stop(); });
  $("cs-random").addEventListener("click", function () {
    if (contours.length >= MAX_CONTOURS) return;
    var pts = [], v = 0.2 + Math.random() * 0.6, start = Math.random() * 0.3, end = start + 0.4 + Math.random() * (0.95 - start - 0.4);
    for (var u = start; u <= end; u += 0.01) { v += (Math.random() - 0.5) * 0.06; v = Math.max(0.05, Math.min(0.95, v)); pts.push({ u: u, v: v }); }
    var c = { voice: voiceIndex % VOICES.length, points: pts }; analyse(c); contours.push(c); voiceIndex++; updateUI(); draw();
  });
  $("cs-scale").addEventListener("change", function () { settings.scale = this.value; contours.forEach(analyse); updateUI(); draw(); });
  $("cs-root").addEventListener("change", function () { settings.root = Number(this.value); updateUI(); draw(); });
  $("cs-tempo").addEventListener("input", function () { settings.bpm = Number(this.value); $("cs-tempo-out").textContent = this.value + " BPM"; });
  $("cs-glide").addEventListener("change", function () { settings.glide = this.checked; draw(); });
  $("cs-volume").addEventListener("input", function () { if (master) master.gain.value = Number(this.value); });
  document.addEventListener("keydown", function (e) {
    if (e.code === "Space" && e.target === document.body) { e.preventDefault(); playing ? stop() : play(); }
  });
  var rt; window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(size, 100); });
  size(); updateUI();
})();
