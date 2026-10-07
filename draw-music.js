// Draw Music: draw free-hand lines on paper, then press play. Every line is its own voice.
// Pitch is the height of the ink, time runs left to right. Logic lives in draw-music-core.js; this file is the screen and the sound.
(function () {
  "use strict";
  var C = window.DMCore;
  var $ = function (id) { return document.getElementById(id); };
  var STORE = "drawMusic.v2";
  var PAD = 16; // vertical padding inside the paper, so the top and bottom note rows are not on the edge

  // ---------- state
  var st = C.defaultState(), tool = "pen", recolorMode = false;
  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved && C.sanitize(saved)) st = C.sanitize(saved); else st = C.example();
  } catch (e) { st = C.example(); }
  var undoStack = [], redoStack = [], saveTimer = 0;
  function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(function () { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch (e) {} }, 300); }
  function snap() { return JSON.stringify(st.lines); }
  function pushUndo() { undoStack.push(snap()); if (undoStack.length > 100) undoStack.shift(); redoStack = []; updateUndo(); }
  function say(msg) { $("dm-status").textContent = msg; }

  // ---------- geometry (the paper is the whole canvas; u runs across the loop, v down the paper)
  var cv = $("dm-canvas"), g = cv.getContext("2d"), wrap = $("dm-wrap"), W = 800, H = 420, pointer = null;
  function layout() {
    W = Math.max(280, wrap.clientWidth || 800); H = C.clamp(Math.round(W * 0.5), 300, 460);
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + "px"; cv.style.height = H + "px";
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function px(p) { return [p[0] * W, PAD + p[1] * (H - 2 * PAD)]; }
  function toUV(x, y) { return [C.clamp(x / W, 0, 1), C.clamp((y - PAD) / (H - 2 * PAD), 0, 1)]; }
  function rowY(r) { return PAD + (1 - r / (C.rowCount(st) - 1)) * (H - 2 * PAD); }
  function lineYAt(line, u) {
    var p = line.pts;
    for (var i = 0; i < p.length - 1; i++) {
      var a = p[i], b = p[i + 1];
      if ((a[0] <= u && b[0] >= u) || (b[0] <= u && a[0] >= u)) { var d = b[0] - a[0]; return d === 0 ? a[1] : a[1] + (b[1] - a[1]) * (u - a[0]) / d; }
    }
    return null;
  }

  // ---------- drawing the paper
  var INK = "#1a1916", HAIR = "#cfcabd", MUTED = "#8a877e";
  function strokeLine(pts, color, width, dash) {
    if (pts.length < 2) return;
    g.strokeStyle = color; g.lineWidth = width; g.lineCap = g.lineJoin = "round"; g.setLineDash(dash || []);
    g.beginPath(); var p0 = px(pts[0]); g.moveTo(p0[0], p0[1]);
    for (var i = 1; i < pts.length - 1; i++) { var a = px(pts[i]), b = px(pts[i + 1]); g.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
    var pl = px(pts[pts.length - 1]); g.lineTo(pl[0], pl[1]); g.stroke(); g.setLineDash([]);
  }
  function draw() {
    g.clearRect(0, 0, W, H); g.fillStyle = "#faf9f7"; g.fillRect(0, 0, W, H);
    var rows = C.rowCount(st), n = C.scaleLen(st), T = C.totalTicks(st);
    if (st.grid) {
      g.font = "10px ui-monospace, Menlo, Consolas, monospace"; g.textBaseline = "middle";
      for (var r = 0; r < rows; r++) {
        var y = Math.round(rowY(r)) + 0.5, tonic = C.mod(C.dStart(st) + r, n) === 0;
        g.strokeStyle = tonic ? "rgba(26,25,22,0.30)" : "rgba(26,25,22,0.10)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
        if (tonic || n <= 7) { g.fillStyle = tonic ? INK : MUTED; g.fillText(C.noteName(C.rowMidi(st, r)), 5, y - 6); }
      }
      var beats = T / C.TPB;
      for (var b = 0; b <= beats; b++) {
        var x = Math.round(b / beats * W) + 0.5; g.strokeStyle = b % C.BEATS === 0 ? "rgba(26,25,22,0.30)" : "rgba(26,25,22,0.10)";
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      }
    }
    var tick = playing ? playTick() : -1, u = tick >= 0 ? tick / T : -1;
    st.lines.forEach(function (l) { strokeLine(l.pts, l.color, 2.4, l.mute ? [3, 5] : null); if (l.mute) return; });
    if (cur) strokeLine(cur.pts, cur.color, 2.4);
    if (u >= 0) {
      g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(u * W) + 0.5, 0); g.lineTo(Math.round(u * W) + 0.5, H); g.stroke();
      st.lines.forEach(function (l) {
        if (l.mute) return; var v = lineYAt(l, u); if (v == null) return;
        var p = px([u, v]); g.fillStyle = "#fff"; g.beginPath(); g.arc(p[0], p[1], 5, 0, 6.2832); g.fill(); g.strokeStyle = l.color; g.lineWidth = 2.4; g.stroke();
      });
    }
    if (pointer && tool === "erase") { g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.arc(pointer.x, pointer.y, ERASE_R, 0, 6.2832); g.stroke(); }
    if (cur && st.snap && pointer) {
      var rf = Math.round(C.rowFloat(st, toUV(pointer.x, pointer.y)[1])), label = C.noteName(C.rowMidi(st, rf));
      g.font = "12px ui-monospace, Menlo, Consolas, monospace"; g.fillStyle = INK; g.textBaseline = "alphabetic"; g.fillText(label, Math.min(W - 34, pointer.x + 12), Math.max(14, pointer.y - 10));
    }
    if (!st.lines.length && !cur) { g.font = "14px ui-monospace, Menlo, Consolas, monospace"; g.fillStyle = MUTED; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("Draw a line here. Higher means a higher note.", W / 2, H / 2); g.textAlign = "start"; }
  }

  // ---------- sound
  var actx = null, master = null, recDest = null, noiseCache = null;
  function makeMaster(ctx, dest) {
    var gain = ctx.createGain(); gain.gain.value = 0.55;
    var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; gain.connect(comp); comp.connect(dest); return gain;
  }
  function ensureAudio() {
    if (!actx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) { say("This browser has no Web Audio, so it cannot play sound."); return null; } actx = new AC(); master = makeMaster(actx, actx.destination); }
    if (actx.state === "suspended") actx.resume();
    return actx;
  }
  function hz(midi) { return 440 * Math.pow(2, (midi - 69) / 12 + st.tune / 1200); }
  function envelope(gn, t0, attack, peak, decay, sustain, dur, release) {
    var p = gn.gain, sus = Math.max(0.0001, peak * sustain), end = t0 + Math.max(dur, attack + decay);
    p.setValueAtTime(0.0001, t0); p.linearRampToValueAtTime(peak, t0 + attack); p.exponentialRampToValueAtTime(sus, t0 + attack + decay);
    p.setValueAtTime(sus, end); p.exponentialRampToValueAtTime(0.0001, end + release); return end + release;
  }
  function noise(ctx) {
    if (!noiseCache || noiseCache.ctx !== ctx) {
      var b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseCache = { ctx: ctx, buf: b };
    }
    return noiseCache.buf;
  }
  // One note on any context (live or offline). inst is a key of C.INSTRUMENTS.
  function playNote(ctx, dest, inst, midi, when, dur, vel) {
    var f = hz(midi), out = ctx.createGain(), oscs = [], end;
    out.connect(dest);
    function osc(type, freq, detune) { var o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; if (detune) o.detune.value = detune; oscs.push(o); return o; }
    function lowpass(freq, q) { var l = ctx.createBiquadFilter(); l.type = "lowpass"; l.frequency.value = freq; l.Q.value = q || 0.7; return l; }
    if (inst === "keys") {
      var a = osc("triangle", f), b = osc("sine", f * 2), bg = ctx.createGain(); bg.gain.value = 0.3; a.connect(out); b.connect(bg); bg.connect(out);
      end = envelope(out, when, 0.004, 0.5 * vel, 0.4, 0.3, dur, 0.18);
    } else if (inst === "bell") {
      var car = osc("sine", f), mod = osc("sine", f * 3.5), mg = ctx.createGain(); mg.gain.value = f * 1.1; mod.connect(mg); mg.connect(car.frequency); car.connect(out);
      var len = 1.2 + dur * 0.5; out.gain.setValueAtTime(0.0001, when); out.gain.linearRampToValueAtTime(0.42 * vel, when + 0.003); out.gain.exponentialRampToValueAtTime(0.0001, when + len);
      mg.gain.setValueAtTime(f * 1.1, when); mg.gain.exponentialRampToValueAtTime(f * 0.05, when + len * 0.6); end = when + len;
    } else if (inst === "bass") {
      var s = osc("sawtooth", f), lp = lowpass(900, 3); lp.frequency.exponentialRampToValueAtTime(300, when + 0.25); s.connect(lp); lp.connect(out); end = envelope(out, when, 0.01, 0.6 * vel, 0.2, 0.6, dur, 0.1);
    } else if (inst === "pad") {
      var p1 = osc("sawtooth", f, -8), p2 = osc("sawtooth", f, 8), pl = lowpass(1400); p1.connect(pl); p2.connect(pl); pl.connect(out); end = envelope(out, when, 0.18, 0.22 * vel, 0.3, 0.7, dur, 0.5);
    } else if (inst === "pluck") {
      var t = osc("triangle", f); t.connect(out); out.gain.setValueAtTime(0.0001, when); out.gain.linearRampToValueAtTime(0.55 * vel, when + 0.002); out.gain.exponentialRampToValueAtTime(0.0001, when + 0.55); end = when + 0.55;
    } else if (inst === "flute") {
      var fl = osc("triangle", f), vib = ctx.createOscillator(), vg = ctx.createGain(), fil = lowpass(3500); vib.frequency.value = 5.2; vg.gain.value = 7; vib.connect(vg); vg.connect(fl.detune); oscs.push(vib);
      fl.connect(fil); fil.connect(out); end = envelope(out, when, 0.06, 0.4 * vel, 0.1, 0.85, dur, 0.15);
    } else if (inst === "brass") {
      var br = osc("sawtooth", f), bl = lowpass(500, 1); bl.frequency.setValueAtTime(500, when); bl.frequency.linearRampToValueAtTime(2400, when + 0.12); br.connect(bl); bl.connect(out); end = envelope(out, when, 0.03, 0.22 * vel, 0.1, 0.8, dur, 0.12);
    } else {
      var q = osc("square", f), ql = lowpass(2600); q.connect(ql); ql.connect(out); end = envelope(out, when, 0.01, 0.2 * vel, 0.1, 0.7, dur, 0.12);
    }
    oscs.forEach(function (o) { o.start(when); o.stop(end + 0.05); });
  }
  // A freehand phrase: one oscillator whose pitch follows the line
  function playGlide(ctx, dest, inst, pitches, stepSec, when, vel) {
    var o = ctx.createOscillator(), fil = ctx.createBiquadFilter(), out = ctx.createGain(), wave = C.INSTRUMENTS[inst].wave, bright = { bell: 6000, flute: 3500, lead: 2600, keys: 4000, pluck: 3000, pad: 1400, brass: 2400, bass: 700 }[inst] || 3000;
    o.type = wave; fil.type = "lowpass"; fil.frequency.value = bright; fil.Q.value = 0.7; o.connect(fil); fil.connect(out); out.connect(dest);
    o.frequency.setValueAtTime(hz(pitches[0]), when);
    pitches.forEach(function (m, i) { o.frequency.linearRampToValueAtTime(hz(m), when + (i + 0.5) * stepSec); });
    var dur = pitches.length * stepSec, peak = (wave === "sawtooth" || wave === "square" ? 0.16 : 0.34) * vel, end = when + dur;
    out.gain.setValueAtTime(0.0001, when); out.gain.linearRampToValueAtTime(peak, when + 0.02); out.gain.setValueAtTime(peak, end); out.gain.exponentialRampToValueAtTime(0.0001, end + 0.15);
    o.start(when); o.stop(end + 0.2);
  }
  function drum(ctx, dest, kind, when, vel) {
    var out = ctx.createGain(); out.connect(dest);
    if (kind === "kick") {
      var o = ctx.createOscillator(); o.frequency.setValueAtTime(150, when); o.frequency.exponentialRampToValueAtTime(45, when + 0.12); o.connect(out);
      out.gain.setValueAtTime(0.9 * vel, when); out.gain.exponentialRampToValueAtTime(0.001, when + 0.35); o.start(when); o.stop(when + 0.4);
    } else {
      var n = ctx.createBufferSource(), f = ctx.createBiquadFilter(); n.buffer = noise(ctx); f.type = kind === "hat" ? "highpass" : "bandpass"; f.frequency.value = kind === "hat" ? 7000 : 1800; n.connect(f); f.connect(out);
      var len = kind === "hat" ? 0.05 : 0.18; out.gain.setValueAtTime((kind === "hat" ? 0.22 : 0.5) * vel, when); out.gain.exponentialRampToValueAtTime(0.001, when + len); n.start(when); n.stop(when + len + 0.02);
      if (kind === "snare") { var t = ctx.createOscillator(); t.type = "triangle"; t.frequency.value = 190; t.connect(out); t.start(when); t.stop(when + 0.1); }
    }
  }
  function click(ctx, dest, when, accent) {
    var o = ctx.createOscillator(), gn = ctx.createGain(); o.type = "square"; o.frequency.value = accent ? 2000 : 1500;
    gn.gain.setValueAtTime(0.0001, when); gn.gain.linearRampToValueAtTime(accent ? 0.14 : 0.09, when + 0.002); gn.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    o.connect(gn); gn.connect(dest); o.start(when); o.stop(when + 0.06);
  }
  // Everything that sounds at one moment: a line's note or glide, or a beat
  function sound(ctx, dest, e, when, spt, vel) {
    if (e.kind === "note") playNote(ctx, dest, e.inst, e.midi, when, Math.max(0.06, e.len * spt), vel);
    else if (e.kind === "glide") playGlide(ctx, dest, e.inst, e.pitches, e.step * spt, when, vel);
    else if (e.kind === "kick" || e.kind === "snare" || e.kind === "hat") drum(ctx, dest, e.kind, when, vel);
    else if (e.kind === "bass") playNote(ctx, dest, "bass", e.midi, when, Math.max(0.08, e.len * spt), 0.8);
    else if (e.kind === "arp") playNote(ctx, dest, "pluck", e.midi, when, e.len * spt, 0.4);
  }

  // ---------- playback (look-ahead scheduler, so timing stays steady even if the page is busy)
  var playing = false, t0 = 0, scheduledTick = 0, timer = 0, raf = 0, events = [], dirty = true, lastTick = 0;
  function spt() { return 60 / st.bpm / C.TPB; }
  function rebuild() { events = C.buildLineEvents(st).concat(C.accompaniment(st)).sort(function (a, b) { return a.start - b.start; }); dirty = false; }
  function playTick() { var L = C.totalTicks(st), tk = (actx.currentTime - t0) / spt(); return tk < 0 ? 0 : C.mod(tk, L); }
  function pump() {
    if (dirty) rebuild();
    var s = spt(), L = C.totalTicks(st), lim = (actx.currentTime + 0.15 - t0) / s;
    for (var k = Math.floor(scheduledTick / L); k * L < lim; k++) {
      var base = k * L;
      events.forEach(function (e) { var a = base + e.start; if (a >= scheduledTick && a < lim) sound(actx, master, e, t0 + a * s, s, 0.8); });
      if (st.click) for (var b = 0; b < L; b += C.TPB) { var ab = base + b; if (ab >= scheduledTick && ab < lim) click(actx, master, t0 + ab * s, b % (C.TPB * C.BEATS) === 0); }
    }
    scheduledTick = Math.max(scheduledTick, lim);
  }
  function frame() {
    if (!playing) return;
    var tk = playTick(); if (tk < lastTick - C.totalTicks(st) / 2) commitRecording(); lastTick = tk;
    draw(); raf = requestAnimationFrame(frame);
  }
  function startPlay() {
    var ctx = ensureAudio(); if (!ctx) return;
    rebuild(); t0 = ctx.currentTime + 0.08; scheduledTick = 0; lastTick = 0; playing = true;
    clearInterval(timer); timer = setInterval(pump, 25); pump(); raf = requestAnimationFrame(frame); updatePlay();
  }
  function stopPlay() { playing = false; clearInterval(timer); cancelAnimationFrame(raf); commitRecording(); updatePlay(); draw(); }
  function rewind() { if (playing) { t0 = actx.currentTime + 0.08; scheduledTick = 0; lastTick = 0; } }
  function updatePlay() { $("dm-play").textContent = playing ? "■ Stop" : "▶ Play"; $("dm-play").setAttribute("aria-pressed", playing ? "true" : "false"); }
  function setBpm(v) {
    v = C.clamp(Math.round(Number(v) || 110), 60, 200);
    if (playing) { var nowTick = (actx.currentTime - t0) / spt(); st.bpm = v; t0 = actx.currentTime - nowTick * spt(); } else st.bpm = v;
    $("dm-bpm").value = v; $("dm-bpm-num").value = v; persist();
  }
  function changed() { dirty = true; draw(); persist(); updateLines(); }

  // ---------- pen and eraser
  var cur = null, voice = null, lastRow = -1, lastPreview = 0, ERASE_R = 14;
  function currentPalette() { return st.palette[st.color]; }
  function localXY(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function livePitch(v) { return C.midiAtRowFloat(st, C.rowFloat(st, v)); }
  function startVoice(inst, v) { // freehand mode: a live tone that follows the pen
    var ctx = ensureAudio(); if (!ctx) return;
    var o = ctx.createOscillator(), out = ctx.createGain(), fil = ctx.createBiquadFilter(); o.type = C.INSTRUMENTS[inst].wave; fil.type = "lowpass"; fil.frequency.value = 2500;
    o.frequency.value = hz(livePitch(v)); o.connect(fil); fil.connect(out); out.connect(master); out.gain.setValueAtTime(0.0001, ctx.currentTime); out.gain.linearRampToValueAtTime(o.type === "sine" || o.type === "triangle" ? 0.28 : 0.12, ctx.currentTime + 0.03); o.start();
    voice = { o: o, out: out, ctx: ctx };
  }
  function stopVoice() { if (!voice) return; var t = voice.ctx.currentTime; voice.out.gain.cancelScheduledValues(t); voice.out.gain.setTargetAtTime(0.0001, t, 0.04); voice.o.stop(t + 0.2); voice = null; }
  function previewNote(inst, v) {
    var now = Date.now(); if (now - lastPreview < 70) return; lastPreview = now;
    var ctx = ensureAudio(); if (!ctx) return;
    playNote(ctx, master, inst, C.rowMidi(st, Math.round(C.rowFloat(st, v))) + C.INSTRUMENTS[inst].offset, ctx.currentTime, 0.2, 0.7);
  }
  cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  cv.addEventListener("pointerdown", function (e) {
    e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (x) {}
    var p = localXY(e); pointer = p;
    if (tool === "erase" || e.button === 2) { pushUndo(); cur = null; erasing = true; eraseAt(p); return; }
    if (st.lines.length >= C.MAX_LINES) { say("That is the most lines (" + C.MAX_LINES + "). Delete one or press Restart."); return; }
    var pal = currentPalette(), uv = toUV(p.x, p.y);
    cur = { color: pal.color, inst: pal.inst, mute: false, pts: [uv] }; lastRow = -1;
    if (st.snap) { lastRow = Math.round(C.rowFloat(st, uv[1])); previewNote(cur.inst, uv[1]); } else startVoice(cur.inst, uv[1]);
    draw();
  });
  var erasing = false;
  function eraseAt(p) { var out = C.erase(st.lines, p.x, p.y - PAD, ERASE_R, W, H - 2 * PAD); if (out !== st.lines) { st.lines = out; dirty = true; } draw(); }
  cv.addEventListener("pointermove", function (e) {
    var p = localXY(e); pointer = p;
    if (erasing) { eraseAt(adjust(p)); return; }
    if (!cur) { if (tool === "erase") draw(); return; }
    var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null; if (!evs || !evs.length) evs = [e];
    evs.forEach(function (ev) {
      var q = localXY(ev), uv = toUV(q.x, q.y), last = cur.pts[cur.pts.length - 1], dx = (uv[0] - last[0]) * W, dy = (uv[1] - last[1]) * (H - 2 * PAD);
      if (dx * dx + dy * dy < 1.5 * 1.5 || cur.pts.length >= C.MAX_POINTS) return;
      cur.pts.push(uv);
      if (st.snap) { var r = Math.round(C.rowFloat(st, uv[1])); if (r !== lastRow) { lastRow = r; previewNote(cur.inst, uv[1]); } }
      else if (voice) voice.o.frequency.setTargetAtTime(hz(livePitch(uv[1])), voice.ctx.currentTime, 0.015);
    });
    draw();
  });
  function adjust(p) { return p; }
  function endStroke() {
    stopVoice();
    if (erasing) { erasing = false; changed(); return; }
    if (!cur) return;
    var line = cur; cur = null;
    if (line.pts.length >= 2) {
      pushUndo(); st.lines.push(line);
      if (st.auto) { st.color = (st.color + 1) % 8; markPalette(); }
      changed();
    } else draw();
  }
  cv.addEventListener("pointerup", endStroke); cv.addEventListener("pointercancel", endStroke);
  cv.addEventListener("pointerleave", function () { if (!cur && !erasing) { pointer = null; draw(); } });

  // ---------- undo, redo
  function restore(json) { st.lines = JSON.parse(json); changed(); }
  function undo() { if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); updateUndo(); }
  function redo() { if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); updateUndo(); }
  function updateUndo() { $("dm-undo").disabled = !undoStack.length; $("dm-redo").disabled = !redoStack.length; }

  // ---------- controls
  function option(sel, value, label) { var o = document.createElement("option"); o.value = value; o.textContent = label; sel.appendChild(o); }
  function fill(id, pairs, current) { var s = $(id); pairs.forEach(function (p) { option(s, p[0], p[1]); }); s.value = String(current); }
  function pressed(id, on) { var b = $(id); b.classList.toggle("on", !!on); b.setAttribute("aria-pressed", on ? "true" : "false"); }
  function markTools() { pressed("dm-pen", tool === "pen"); pressed("dm-erase", tool === "erase"); cv.style.cursor = tool === "erase" ? "none" : "crosshair"; }
  function markPalette() {
    Array.prototype.forEach.call(document.querySelectorAll(".dm-dot"), function (d, i) { d.classList.toggle("on", i === st.color); d.setAttribute("aria-pressed", i === st.color ? "true" : "false"); d.style.background = st.palette[i].color; d.title = C.INSTRUMENTS[st.palette[i].inst].name; });
    $("dm-sound").value = st.palette[st.color].inst;
  }
  function info() {
    var iv = C.SCALES[st.scale], names = iv.map(function (i) { return C.NOTE_NAMES[C.mod(st.key + i, 12)]; });
    $("dm-scale-info").textContent = C.NOTE_NAMES[st.key] + " " + st.scale + ": " + names.join(" ") + ". " + C.SCALE_NOTES[st.scale];
    $("dm-octave").textContent = "octave " + (4 + st.shift);
  }
  function relayout() { layout(); info(); drawKeys(); dirty = true; draw(); persist(); }

  // The line list: each line is its own voice
  function updateLines() {
    var box = $("dm-lines"); box.textContent = "";
    if (!st.lines.length) { var li0 = document.createElement("li"); li0.className = "dm-none"; li0.textContent = "No lines yet. Each line you draw becomes its own voice."; box.appendChild(li0); return; }
    st.lines.forEach(function (line, i) {
      var li = document.createElement("li"), sw = document.createElement("span"), name = document.createElement("span"), sel = document.createElement("select"), mute = document.createElement("label"), mc = document.createElement("input"), del = document.createElement("button");
      sw.className = "dm-swatch"; sw.style.background = line.color; name.className = "dm-lname"; name.textContent = "Line " + (i + 1);
      Object.keys(C.INSTRUMENTS).forEach(function (k) { option(sel, k, C.INSTRUMENTS[k].name); }); sel.value = line.inst; sel.setAttribute("aria-label", "Sound for line " + (i + 1));
      sel.addEventListener("change", function () { line.inst = sel.value; dirty = true; persist(); });
      mc.type = "checkbox"; mc.checked = line.mute; mute.appendChild(mc); mute.appendChild(document.createTextNode(" mute"));
      mc.addEventListener("change", function () { line.mute = mc.checked; dirty = true; draw(); persist(); });
      del.type = "button"; del.className = "dm-x"; del.textContent = "×"; del.setAttribute("aria-label", "Delete line " + (i + 1));
      del.addEventListener("click", function () { pushUndo(); st.lines.splice(i, 1); changed(); });
      li.appendChild(sw); li.appendChild(name); li.appendChild(sel); li.appendChild(mute); li.appendChild(del); box.appendChild(li);
    });
  }

  // The mini keyboard: drag across it to change the key, even while it plays
  var kc = $("dm-keys"), kg = kc.getContext("2d"), WHITE = [0, 2, 4, 5, 7, 9, 11], BLACK = [[1, 0.65], [3, 1.65], [6, 3.65], [8, 4.65], [10, 5.65]];
  function drawKeys() {
    var kw = 22, kh = 44, w = kw * 7, dpr = window.devicePixelRatio || 1; kc.width = w * dpr; kc.height = kh * dpr; kc.style.width = w + "px"; kc.style.height = kh + "px"; kg.setTransform(dpr, 0, 0, dpr, 0, 0);
    kg.clearRect(0, 0, w, kh);
    WHITE.forEach(function (n, i) { kg.fillStyle = n === st.key ? "#1a1916" : "#fffefb"; kg.fillRect(i * kw + 0.5, 0.5, kw - 1, kh - 1); kg.strokeStyle = "#cfcabd"; kg.strokeRect(i * kw + 0.5, 0.5, kw - 1, kh - 1); });
    BLACK.forEach(function (b) { kg.fillStyle = b[0] === st.key ? "#d9482b" : "#1a1916"; kg.fillRect(b[1] * kw + 2, 0, kw * 0.7, kh * 0.6); });
  }
  function keyAt(e) {
    var r = kc.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, kw = 22;
    if (y < 44 * 0.6) for (var i = 0; i < BLACK.length; i++) if (x >= BLACK[i][1] * kw + 2 && x <= BLACK[i][1] * kw + 2 + kw * 0.7) return BLACK[i][0];
    var w = Math.floor(x / kw); return w >= 0 && w < 7 ? WHITE[w] : null;
  }
  var keyDrag = false;
  kc.addEventListener("pointerdown", function (e) { keyDrag = true; try { kc.setPointerCapture(e.pointerId); } catch (x) {} setKey(keyAt(e)); });
  kc.addEventListener("pointermove", function (e) { if (keyDrag) setKey(keyAt(e)); });
  kc.addEventListener("pointerup", function () { keyDrag = false; }); kc.addEventListener("pointercancel", function () { keyDrag = false; });
  function setKey(k) { if (k == null || k === st.key) return; st.key = k; $("dm-key").value = k; info(); drawKeys(); dirty = true; draw(); persist(); }

  function build() {
    fill("dm-key", C.NOTE_NAMES.map(function (n, i) { return [i, n]; }), st.key);
    fill("dm-scale", Object.keys(C.SCALES).map(function (k) { return [k, k.charAt(0).toUpperCase() + k.slice(1)]; }), st.scale);
    fill("dm-range", [[1, "1 octave"], [2, "2 octaves"], [3, "3 octaves"]], st.octaves);
    fill("dm-bars", [[1, "1 bar"], [2, "2 bars"], [4, "4 bars"]], st.bars);
    fill("dm-quant", Object.keys(C.QUANT).map(function (k) { return [k, k.replace("T", " triplet")]; }), st.quant);
    fill("dm-swing", [[0, "Off"], [1, "Light"], [2, "Medium"], [3, "Hard"]], st.swing);
    var sound = $("dm-sound"); Object.keys(C.INSTRUMENTS).forEach(function (k) { option(sound, k, C.INSTRUMENTS[k].name); });
    var pal = $("dm-palette");
    for (var i = 0; i < 8; i++) (function (i) {
      var b = document.createElement("button"); b.type = "button"; b.className = "dm-dot"; b.setAttribute("aria-label", "Colour " + (i + 1));
      b.addEventListener("click", function () {
        if (recolorMode) { $("dm-color").dataset.idx = i; $("dm-color").value = st.palette[i].color; $("dm-color").click(); return; }
        st.color = i; tool = "pen"; markPalette(); markTools(); persist();
      });
      pal.appendChild(b);
    })(i);
    $("dm-bpm").value = st.bpm; $("dm-bpm-num").value = st.bpm; $("dm-tune").value = st.tune;
    pressed("dm-grid", st.grid); pressed("dm-snap", st.snap); pressed("dm-click", st.click); pressed("dm-auto", st.auto);
    ["bass", "drums", "arp"].forEach(function (k) { pressed("dm-b-" + k, st.beats[k]); });
    $("dm-snap").textContent = st.snap ? "Locked to key" : "Freehand"; swingState();
    markTools(); markPalette(); updateUndo(); updatePlay(); updateLines();
  }
  function swingState() { var trip = /T$/.test(st.quant); $("dm-swing").disabled = trip; $("dm-swing").title = trip ? "Swing works with straight note lengths" : "Off-beat notes land late"; }
  function onChange(id, fn) { $(id).addEventListener("change", function () { fn(this.value); }); }
  onChange("dm-key", function (v) { setKey(Number(v)); });
  onChange("dm-scale", function (v) { st.scale = v; relayout(); });
  onChange("dm-range", function (v) { st.octaves = Number(v); relayout(); });
  onChange("dm-bars", function (v) { st.bars = Number(v); relayout(); });
  onChange("dm-quant", function (v) { st.quant = v; swingState(); dirty = true; persist(); });
  onChange("dm-swing", function (v) { st.swing = Number(v); dirty = true; persist(); });
  onChange("dm-sound", function (v) { st.palette[st.color].inst = v; markPalette(); persist(); });
  $("dm-oct-down").addEventListener("click", function () { st.shift = Math.max(-2, st.shift - 1); relayout(); });
  $("dm-oct-up").addEventListener("click", function () { st.shift = Math.min(2, st.shift + 1); relayout(); });
  $("dm-tune").addEventListener("change", function () { st.tune = C.clamp(Math.round(Number(this.value) || 0), -50, 50); this.value = st.tune; persist(); });
  $("dm-bpm").addEventListener("input", function () { setBpm(this.value); });
  $("dm-bpm-num").addEventListener("change", function () { setBpm(this.value); });
  var taps = [];
  $("dm-tap").addEventListener("click", function () {
    var now = Date.now(); if (taps.length && now - taps[taps.length - 1] > 2000) taps = []; taps.push(now); taps = taps.slice(-6);
    if (taps.length >= 2) setBpm(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)));
  });
  $("dm-play").addEventListener("click", function () { playing ? stopPlay() : startPlay(); });
  $("dm-rewind").addEventListener("click", rewind);
  $("dm-pen").addEventListener("click", function () { tool = "pen"; markTools(); });
  $("dm-erase").addEventListener("click", function () { tool = tool === "erase" ? "pen" : "erase"; markTools(); });
  $("dm-undo").addEventListener("click", undo); $("dm-redo").addEventListener("click", redo);
  $("dm-clear").addEventListener("click", function () { if (!st.lines.length) return; pushUndo(); st.lines = []; changed(); say("Cleared. Undo brings it back."); });
  $("dm-shuffle").addEventListener("click", function () {
    pushUndo(); var names = Object.keys(C.INSTRUMENTS);
    if (st.lines.length) st.lines.forEach(function (l) { l.inst = names[Math.floor(Math.random() * names.length)]; });
    else { var pts = [], v = 0.3 + Math.random() * 0.4; for (var u = 0.04; u <= 0.96; u += 0.02) { v = C.clamp(v + (Math.random() - 0.5) * 0.14, 0.08, 0.92); pts.push([u, v]); } var pal = currentPalette(); st.lines.push({ color: pal.color, inst: pal.inst, mute: false, pts: pts }); }
    changed(); say("Shuffled the sounds.");
  });
  $("dm-grid").addEventListener("click", function () { st.grid = !st.grid; pressed("dm-grid", st.grid); draw(); persist(); });
  $("dm-snap").addEventListener("click", function () { st.snap = !st.snap; pressed("dm-snap", st.snap); this.textContent = st.snap ? "Locked to key" : "Freehand"; dirty = true; persist(); say(st.snap ? "Lines snap to notes in the key." : "Freehand: pitch slides smoothly along your line."); });
  $("dm-click").addEventListener("click", function () { st.click = !st.click; pressed("dm-click", st.click); persist(); });
  $("dm-auto").addEventListener("click", function () { st.auto = !st.auto; pressed("dm-auto", st.auto); persist(); say(st.auto ? "Each new line takes the next colour and sound." : "New lines keep the colour you picked."); });
  ["bass", "drums", "arp"].forEach(function (k) { $("dm-b-" + k).addEventListener("click", function () { st.beats[k] = !st.beats[k]; pressed("dm-b-" + k, st.beats[k]); dirty = true; persist(); }); });
  $("dm-recolor").addEventListener("click", function () { recolorMode = !recolorMode; pressed("dm-recolor", recolorMode); say(recolorMode ? "Pick the colour you want to change." : ""); });
  $("dm-color").addEventListener("input", function () { var i = Number(this.dataset.idx); if (i >= 0 && /^#[0-9a-f]{6}$/i.test(this.value)) { st.palette[i].color = this.value; markPalette(); persist(); } });
  $("dm-color").addEventListener("change", function () { recolorMode = false; pressed("dm-recolor", false); });
  document.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || ""; if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
    var mod = e.ctrlKey || e.metaKey, k = (e.key || "").toLowerCase();
    if (e.code === "Space") { e.preventDefault(); playing ? stopPlay() : startPlay(); }
    else if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && k === "y") { e.preventDefault(); redo(); }
    else if (!mod && k === "e") { tool = tool === "erase" ? "pen" : "erase"; markTools(); }
    else if (!mod && k === "p") { tool = "pen"; markTools(); }
    else if (!mod && k === "g") { st.grid = !st.grid; pressed("dm-grid", st.grid); draw(); persist(); }
  });

  // ---------- MIDI keyboard in: notes sound live and, while playing, are written into the loop
  var midiOn = false, midiAccess = null, held = {}, rec = null;
  function midiToV(m) { // nearest row on the paper
    var best = 0, bd = 1e9; for (var r = 0; r < C.rowCount(st); r++) { var d = Math.abs(C.rowMidi(st, r) - m); if (d < bd) { bd = d; best = r; } }
    return 1 - best / (C.rowCount(st) - 1);
  }
  function uNow() { return playing ? playTick() / C.totalTicks(st) : 0; }
  function onMidi(ev) {
    var d = ev.data, cmd = d[0] & 0xf0, note = d[1], vel = d[2];
    if (cmd === 0x90 && vel > 0) {
      var ctx = ensureAudio(); if (!ctx) return; var pal = currentPalette();
      playNote(ctx, master, pal.inst, note + C.INSTRUMENTS[pal.inst].offset, ctx.currentTime, 0.4, vel / 127);
      if (playing) held[note] = uNow();
    } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
      if (held[note] != null) { var u0 = held[note], u1 = Math.max(uNow(), u0 + 0.01); delete held[note]; addRec(u0, Math.min(1, u1), note); }
    }
  }
  function addRec(u0, u1, note) {
    var pal = currentPalette(); if (!rec) rec = { color: pal.color, inst: pal.inst, mute: false, pts: [] };
    var v = midiToV(note); rec.pts.push([u0, v], [u1, v]);
  }
  function commitRecording() {
    Object.keys(held).forEach(function (n) { addRec(held[n], 1, Number(n)); held[n] = 0; });
    if (rec && rec.pts.length >= 2 && st.lines.length < C.MAX_LINES) {
      rec.pts.sort(function (a, b) { return a[0] - b[0]; }); pushUndo(); st.lines.push(rec); if (st.auto) { st.color = (st.color + 1) % 8; markPalette(); } changed();
    }
    rec = null;
  }
  $("dm-midi").addEventListener("click", function () {
    if (midiOn) { midiOn = false; pressed("dm-midi", false); if (midiAccess) midiAccess.inputs.forEach(function (i) { i.onmidimessage = null; }); say("MIDI keyboard off."); return; }
    if (!navigator.requestMIDIAccess) { say("This browser does not support MIDI keyboards. Chrome and Edge do."); return; }
    navigator.requestMIDIAccess().then(function (a) {
      midiAccess = a; midiOn = true; pressed("dm-midi", true); var n = 0; a.inputs.forEach(function (i) { i.onmidimessage = onMidi; n++; });
      say(n ? "MIDI keyboard on. Play while the loop runs and your notes become a new line." : "MIDI is on but no keyboard was found. Plug one in and press MIDI again.");
    }).catch(function () { say("MIDI access was blocked."); });
  });

  // ---------- files and recording
  function download(bytes, name, type) {
    var url = URL.createObjectURL(new Blob([bytes], { type: type })), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  $("dm-save").addEventListener("click", function () { download(JSON.stringify(st, null, 1), "drawing.json", "application/json"); say("Saved drawing.json."); });
  $("dm-open").addEventListener("change", function () {
    var f = this.files[0]; if (!f) return; var self = this, r = new FileReader();
    r.onload = function () {
      var s = null; try { s = C.sanitize(JSON.parse(r.result)); } catch (e) {}
      if (!s) say("That file is not a Draw Music project."); else { pushUndo(); st = s; syncControls(); say("Opened " + f.name + "."); }
      self.value = "";
    };
    r.readAsText(f);
  });
  function syncControls() {
    $("dm-key").value = st.key; $("dm-scale").value = st.scale; $("dm-range").value = st.octaves; $("dm-bars").value = st.bars; $("dm-quant").value = st.quant; $("dm-swing").value = st.swing; $("dm-tune").value = st.tune;
    pressed("dm-grid", st.grid); pressed("dm-snap", st.snap); pressed("dm-click", st.click); pressed("dm-auto", st.auto); $("dm-snap").textContent = st.snap ? "Locked to key" : "Freehand";
    ["bass", "drums", "arp"].forEach(function (k) { pressed("dm-b-" + k, st.beats[k]); });
    setBpm(st.bpm); swingState(); markPalette(); updateUndo(); relayout(); updateLines();
  }
  $("dm-midi-out").addEventListener("click", function () {
    if (!st.lines.length) { say("Draw something first."); return; }
    download(C.toMidi(st), "drawing.mid", "audio/midi"); say("Exported drawing.mid: one track per line, plus any beats. Freehand glides become the nearest notes.");
  });
  $("dm-wav").addEventListener("click", function () {
    if (!st.lines.length) { say("Draw something first."); return; }
    var Off = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!Off) { say("This browser cannot render audio files."); return; }
    var s = spt(), sr = 44100, secs = C.totalTicks(st) * s + 2.2, off = new Off(2, Math.ceil(secs * sr), sr), m = makeMaster(off, off.destination);
    C.buildLineEvents(st).concat(C.accompaniment(st)).forEach(function (e) { sound(off, m, e, 0.05 + e.start * s, s, 0.8); });
    say("Rendering…");
    off.startRendering().then(function (buf) { download(C.toWav([buf.getChannelData(0), buf.getChannelData(1)], sr), "drawing.wav", "audio/wav"); say("Exported drawing.wav: one pass of your loop plus a short tail."); })
      .catch(function () { say("Could not render the audio."); });
  });
  var recorder = null, chunks = [];
  $("dm-record").addEventListener("click", function () {
    if (recorder) { recorder.stop(); return; }
    var ctx = ensureAudio(); if (!ctx) return;
    if (!window.MediaRecorder || !ctx.createMediaStreamDestination) { say("This browser cannot record audio."); return; }
    if (!recDest) { recDest = ctx.createMediaStreamDestination(); master.connect(recDest); }
    chunks = []; recorder = new MediaRecorder(recDest.stream);
    recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = function () { var type = recorder.mimeType || "audio/webm"; recorder = null; pressed("dm-record", false); $("dm-record").textContent = "● Record"; download(new Blob(chunks, { type: type }), "take." + (/ogg/.test(type) ? "ogg" : /mp4/.test(type) ? "m4a" : "webm"), type); say("Saved your take."); };
    recorder.start(); pressed("dm-record", true); $("dm-record").textContent = "■ Stop recording"; if (!playing) startPlay(); say("Recording. Press Stop recording when you are done.");
  });

  // ---------- go
  build(); layout(); info(); drawKeys(); draw(); persist();
  var rz; window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(function () { layout(); draw(); }, 120); });
  window.addEventListener("pagehide", function () { if (playing) stopPlay(); });
  say("Draw on the paper with the pen. Press Play, or the space bar, to listen.");
})();
