// Draw Music: pure logic (scales, free-hand lines to notes, swing, accompaniment, MIDI and WAV export).
// No DOM and no audio here, so it can be tested in Node.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DMCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var TPB = 24;      // ticks per beat: divides evenly into 1/4, 1/8, 1/8 triplet, 1/16, 1/16 triplet and 1/32
  var BEATS = 4;     // 4/4
  var SCALES = {
    "major pentatonic": [0, 2, 4, 7, 9], "minor pentatonic": [0, 3, 5, 7, 10], "major": [0, 2, 4, 5, 7, 9, 11], "minor": [0, 2, 3, 5, 7, 8, 10],
    "harmonic minor": [0, 2, 3, 5, 7, 8, 11], "dorian": [0, 2, 3, 5, 7, 9, 10], "phrygian": [0, 1, 3, 5, 7, 8, 10], "lydian": [0, 2, 4, 6, 7, 9, 11],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10], "blues": [0, 3, 5, 6, 7, 10]
  };
  var SCALE_NOTES = {
    "major pentatonic": "Five notes with no tense intervals: very hard to play a wrong note.",
    "minor pentatonic": "Five notes with a bluesy, rock feel. Also very forgiving.",
    "major": "Bright and settled. The sound of most pop and folk tunes.",
    "minor": "Darker and more serious. Same notes as major, started from the sixth.",
    "harmonic minor": "Minor with a raised seventh, giving a dramatic, classical pull to the tonic.",
    "dorian": "Minor with a raised sixth. Jazzy and hopeful rather than sad.",
    "phrygian": "Minor with a flat second. Dark and tense, common in flamenco.",
    "lydian": "Major with a raised fourth. Dreamy and floating.",
    "mixolydian": "Major with a flat seventh. Relaxed and bluesy, common in rock.",
    "blues": "Minor pentatonic plus the “blue note” (the flat fifth) for a gritty edge."
  };
  var QUANT = { "1/4": 24, "1/8": 12, "1/8T": 8, "1/16": 6, "1/16T": 4, "1/32": 3 };
  var SWING_AMOUNT = [0, 3, 5, 8]; // ticks by which off-beat notes are delayed: off, light, medium, hard
  var NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  var INSTRUMENTS = {
    keys: { name: "Soft keys", offset: 0, program: 0, wave: "triangle" }, bell: { name: "Bell", offset: 0, program: 14, wave: "sine" },
    pluck: { name: "Pluck", offset: 0, program: 24, wave: "triangle" }, pad: { name: "Warm pad", offset: 0, program: 89, wave: "sawtooth" },
    lead: { name: "Square lead", offset: 0, program: 80, wave: "square" }, flute: { name: "Flute", offset: 0, program: 73, wave: "triangle" },
    brass: { name: "Brass", offset: 0, program: 61, wave: "sawtooth" }, bass: { name: "Bass", offset: -12, program: 33, wave: "sawtooth" }
  };
  var PALETTE = [
    { color: "#d9482b", inst: "keys" }, { color: "#2a77b4", inst: "bell" }, { color: "#e0992a", inst: "pluck" }, { color: "#2f7d52", inst: "pad" },
    { color: "#7c4fa0", inst: "lead" }, { color: "#cf3f86", inst: "flute" }, { color: "#1a1916", inst: "brass" }, { color: "#2a9d9a", inst: "bass" }
  ];
  var MAX_LINES = 24, MAX_POINTS = 2500;

  function mod(a, n) { return ((a % n) + n) % n; }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function degreeToMidi(d, key, scale) {
    var iv = SCALES[scale] || SCALES.major, n = iv.length;
    return 60 + key + 12 * Math.floor(d / n) + iv[mod(d, n)];
  }
  function noteName(m) { return NOTE_NAMES[mod(Math.round(m), 12)] + (Math.floor(Math.round(m) / 12) - 1); }
  function totalTicks(st) { return st.bars * BEATS * TPB; }
  function stepTicks(st) { return QUANT[st.quant] || 12; }
  function scaleLen(st) { return (SCALES[st.scale] || SCALES.major).length; }
  function rowCount(st) { return st.octaves * scaleLen(st) + 1; }          // rows on the paper, bottom = lowest
  function dStart(st) { return st.shift * scaleLen(st); }                  // scale degree of the bottom row

  function defaultState() {
    return { v: 2, key: 0, scale: "major pentatonic", octaves: 2, shift: 0, tune: 0, bars: 2, quant: "1/8", swing: 0, bpm: 110, click: false, snap: true, grid: true,
      beats: { bass: false, drums: false, arp: false }, palette: PALETTE.map(function (p) { return { color: p.color, inst: p.inst }; }), color: 0, auto: true, lines: [] };
  }
  function cleanColor(c, dflt) { return typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c) ? c : dflt; }
  // Accept a project from storage or a file; return a clean state or null
  function sanitize(o) {
    if (!o || typeof o !== "object") return null;
    var d = defaultState(), num = function (x, lo, hi, dflt) { x = Number(x); return Number.isFinite(x) ? clamp(Math.round(x), lo, hi) : dflt; };
    d.key = num(o.key, 0, 11, 0); d.scale = SCALES[o.scale] ? o.scale : d.scale;
    d.octaves = num(o.octaves, 1, 3, 2); d.shift = num(o.shift, -2, 2, 0); d.tune = num(o.tune, -50, 50, 0);
    d.bars = [1, 2, 4].indexOf(Number(o.bars)) >= 0 ? Number(o.bars) : 2; d.quant = QUANT[o.quant] ? o.quant : d.quant; d.swing = num(o.swing, 0, 3, 0);
    d.bpm = num(o.bpm, 60, 200, 110); d.click = !!o.click; d.snap = o.snap !== false; d.grid = o.grid !== false; d.auto = o.auto !== false; d.color = num(o.color, 0, 7, 0);
    if (o.beats && typeof o.beats === "object") d.beats = { bass: !!o.beats.bass, drums: !!o.beats.drums, arp: !!o.beats.arp };
    if (Array.isArray(o.palette)) d.palette = d.palette.map(function (p, i) { var q = o.palette[i] || {}; return { color: cleanColor(q.color, p.color), inst: INSTRUMENTS[q.inst] ? q.inst : p.inst }; });
    if (Array.isArray(o.lines)) o.lines.slice(0, MAX_LINES).forEach(function (l, i) {
      if (!l || !Array.isArray(l.pts)) return;
      var pts = [];
      l.pts.slice(0, MAX_POINTS).forEach(function (p) { if (Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])) pts.push([Math.round(clamp(+p[0], 0, 1) * 10000) / 10000, Math.round(clamp(+p[1], 0, 1) * 10000) / 10000]); });
      if (pts.length >= 2) d.lines.push({ color: cleanColor(l.color, d.palette[i % 8].color), inst: INSTRUMENTS[l.inst] ? l.inst : d.palette[i % 8].inst, mute: !!l.mute, pts: pts });
    });
    return d;
  }

  // ---------- from a hand-drawn line to notes
  // pts are [u, v] in 0..1: u = across the loop (time), v = down the paper (0 is the top, the highest pitch)
  function rowFloat(st, v) { return (1 - v) * (rowCount(st) - 1); }
  function rowMidi(st, r) { return degreeToMidi(dStart(st) + r, st.key, st.scale); }
  function midiAtRowFloat(st, rf) {
    var lo = clamp(Math.floor(rf), 0, rowCount(st) - 1), hi = Math.min(lo + 1, rowCount(st) - 1), t = clamp(rf - lo, 0, 1);
    return rowMidi(st, lo) + (rowMidi(st, hi) - rowMidi(st, lo)) * t;
  }
  // Average height of the line in each time column; a null column means the line does not pass through it
  function columns(st, line) {
    var cols = totalTicks(st) / stepTicks(st), sum = new Array(cols).fill(0), cnt = new Array(cols).fill(0), pts = line.pts;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[i + 1] || a, n = Math.max(1, Math.ceil(Math.abs(b[0] - a[0]) * cols * 4));
      for (var k = 0; k <= n; k++) {
        var u = a[0] + (b[0] - a[0]) * k / n, v = a[1] + (b[1] - a[1]) * k / n, c = Math.min(cols - 1, Math.floor(u * cols));
        sum[c] += v; cnt[c]++;
      }
    }
    return sum.map(function (s, c) { return cnt[c] ? s / cnt[c] : null; });
  }
  function swingShift(st, tick) { return tick % TPB >= TPB / 2 ? SWING_AMOUNT[st.swing] || 0 : 0; }
  // Snapped to the key: columns on the same scale note join into one longer note
  function lineNotes(st, line) {
    var cols = columns(st, line), step = stepTicks(st), notes = [], last = null;
    cols.forEach(function (v, c) {
      if (v == null) { last = null; return; }
      var row = Math.round(rowFloat(st, v));
      if (last && last.row === row && last.start + last.len === c * step) last.len += step;
      else { last = { start: c * step, len: step, row: row }; notes.push(last); }
    });
    return notes.map(function (n) { return { start: n.start + swingShift(st, n.start), len: n.len, midi: rowMidi(st, n.row) + INSTRUMENTS[line.inst].offset }; });
  }
  // Freehand: each unbroken run of columns glides along the line
  function lineGlides(st, line) {
    var cols = columns(st, line), step = stepTicks(st), runs = [], cur = null;
    cols.forEach(function (v, c) {
      if (v == null) { cur = null; return; }
      var m = midiAtRowFloat(st, rowFloat(st, v)) + INSTRUMENTS[line.inst].offset;
      if (cur) cur.pitches.push(m); else { cur = { start: c * step, pitches: [m], step: step }; runs.push(cur); }
    });
    return runs.map(function (r) { return { start: r.start + swingShift(st, r.start), step: step, len: r.pitches.length * step, pitches: r.pitches }; });
  }
  // Everything the audio engine needs for the lines
  function buildLineEvents(st) {
    var out = [];
    st.lines.forEach(function (line, i) {
      if (line.mute) return;
      if (st.snap) lineNotes(st, line).forEach(function (n) { out.push({ kind: "note", line: i, inst: line.inst, start: n.start, len: n.len, midi: n.midi }); });
      else lineGlides(st, line).forEach(function (g) { out.push({ kind: "glide", line: i, inst: line.inst, start: g.start, len: g.len, step: g.step, pitches: g.pitches }); });
    });
    return out.sort(function (a, b) { return a.start - b.start; });
  }

  // ---------- bass, drums and arpeggio that follow the key
  function accompaniment(st) {
    var ev = [], T = totalTicks(st), bar = TPB * BEATS, root = 36 + st.key, n = scaleLen(st);
    for (var b0 = 0; b0 < T; b0 += bar) {
      if (st.beats.bass) { ev.push({ kind: "bass", start: b0, len: TPB, midi: root }); ev.push({ kind: "bass", start: b0 + 2 * TPB, len: TPB, midi: root }); ev.push({ kind: "bass", start: b0 + 3 * TPB + TPB / 2, len: TPB / 2, midi: root + 7 }); }
      if (st.beats.drums) {
        ev.push({ kind: "kick", start: b0, len: 6 }); ev.push({ kind: "kick", start: b0 + 2 * TPB, len: 6 }); ev.push({ kind: "snare", start: b0 + TPB, len: 6 }); ev.push({ kind: "snare", start: b0 + 3 * TPB, len: 6 });
        for (var h = 0; h < bar; h += TPB / 2) ev.push({ kind: "hat", start: b0 + h, len: 3 });
      }
    }
    if (st.beats.arp) for (var t = 0, i = 0; t < T; t += TPB / 4, i++) ev.push({ kind: "arp", start: t, len: TPB / 4, midi: degreeToMidi([0, 2, 4, 2][i % 4] + n, st.key, st.scale) });
    return ev.sort(function (a, b) { return a.start - b.start; });
  }

  // ---------- erasing: remove points near (x, y) in pixels; a line cut in two becomes two lines
  function erase(lines, x, y, r, W, H) {
    var out = [], changed = false;
    lines.forEach(function (line) {
      var piece = [], pieces = [];
      line.pts.forEach(function (p) {
        var dx = p[0] * W - x, dy = p[1] * H - y;
        if (dx * dx + dy * dy <= r * r) { changed = true; if (piece.length) pieces.push(piece); piece = []; } else piece.push(p);
      });
      if (piece.length) pieces.push(piece);
      pieces.forEach(function (pts) { if (pts.length >= 2) out.push({ color: line.color, inst: line.inst, mute: line.mute, pts: pts }); else changed = true; });
    });
    return changed ? out : lines;
  }

  // ---------- Standard MIDI File (format 1): tempo track, one track per line, then drums, bass and arpeggio
  function vlq(n) { var b = [n & 0x7f]; while ((n >>= 7) > 0) b.unshift((n & 0x7f) | 0x80); return b; }
  function str(s) { return Array.prototype.map.call(s, function (ch) { return ch.charCodeAt(0) & 0x7f; }); }
  function chunk(type, bytes) { var n = bytes.length; return str(type).concat([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255], bytes); }
  function meta(delta, type, data) { return vlq(delta).concat([0xff, type], vlq(data.length), data); }
  function trackBytes(name, channel, program, notes, k) {
    var list = [];
    notes.forEach(function (e) { var m = clamp(Math.round(e.midi), 0, 127); list.push({ time: Math.round(e.start * k), on: 1, n: m }); list.push({ time: Math.round((e.start + e.len) * k), on: 0, n: m }); });
    list.sort(function (a, b) { return a.time - b.time || a.on - b.on; }); // note-offs before note-ons at the same time
    var bytes = [].concat(meta(0, 0x03, str(name)), program == null ? [] : [0x00, 0xc0 | channel, program]), last = 0;
    list.forEach(function (x) { bytes = bytes.concat(vlq(x.time - last), [(x.on ? 0x90 : 0x80) | channel, x.n, x.on ? 96 : 0]); last = x.time; });
    return chunk("MTrk", bytes.concat(meta(0, 0x2f, [])));
  }
  // The MIDI file holds notes only: a freehand glide is written as the nearest scale notes.
  function toMidi(st) {
    var PPQ = 96, k = PPQ / TPB, us = Math.round(60000000 / st.bpm), tracks = [];
    tracks.push(chunk("MTrk", [].concat(meta(0, 0x03, str("Tempo")), meta(0, 0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]), meta(0, 0x58, [4, 2, 24, 8]), meta(0, 0x2f, []))));
    st.lines.forEach(function (line, i) {
      if (line.mute) return;
      var inst = INSTRUMENTS[line.inst], notes = lineNotes(st, line);
      if (notes.length) tracks.push(trackBytes("Line " + (i + 1) + " " + inst.name, i % 9, inst.program, notes, k));
    });
    var acc = accompaniment(st);
    [["drums", "Drums", 9, null], ["bass", "Bass", 10, 33], ["arp", "Arpeggio", 11, 24]].forEach(function (g) {
      var part = acc.filter(function (e) { return g[0] === "drums" ? /kick|snare|hat/.test(e.kind) : e.kind === g[0]; })
        .map(function (e) { return { start: e.start, len: e.len, midi: e.kind === "kick" ? 36 : e.kind === "snare" ? 38 : e.kind === "hat" ? 42 : e.midi }; });
      if (part.length) tracks.push(trackBytes(g[1], g[2], g[3], part, k));
    });
    var head = chunk("MThd", [0, 1, (tracks.length >> 8) & 255, tracks.length & 255, (PPQ >> 8) & 255, PPQ & 255]);
    return Uint8Array.from(head.concat.apply(head, tracks));
  }

  // ---------- WAV (16-bit PCM) from channel data
  function toWav(channels, sampleRate) {
    var nCh = channels.length, len = channels[0].length, bytes = 44 + len * nCh * 2, buf = new ArrayBuffer(bytes), dv = new DataView(buf);
    function w(off, s) { for (var i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); }
    w(0, "RIFF"); dv.setUint32(4, bytes - 8, true); w(8, "WAVE"); w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, nCh, true); dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * nCh * 2, true); dv.setUint16(32, nCh * 2, true); dv.setUint16(34, 16, true);
    w(36, "data"); dv.setUint32(40, len * nCh * 2, true);
    var o = 44;
    for (var i = 0; i < len; i++) for (var c = 0; c < nCh; c++) { var s = clamp(channels[c][i], -1, 1); dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    return new Uint8Array(buf);
  }

  // A small starter sketch so a first visit has something to play
  function example() {
    var st = defaultState(), A = [], B = [];
    for (var i = 0; i <= 40; i++) { var u = i / 40; A.push([u, 0.55 - 0.3 * Math.sin(u * Math.PI * 2) * (0.6 + 0.4 * u)]); }
    for (var j = 0; j <= 16; j++) B.push([j / 16 * 0.5 + 0.02, 0.88 - 0.1 * (j % 4 === 0 ? 1 : 0)]);
    st.lines.push({ color: st.palette[0].color, inst: st.palette[0].inst, mute: false, pts: A });
    st.lines.push({ color: st.palette[2].color, inst: st.palette[2].inst, mute: false, pts: [[0.55, 0.78], [0.62, 0.7], [0.7, 0.78], [0.8, 0.62], [0.92, 0.7]] });
    st.color = 1; return st;
  }

  return { TPB: TPB, BEATS: BEATS, SCALES: SCALES, SCALE_NOTES: SCALE_NOTES, QUANT: QUANT, NOTE_NAMES: NOTE_NAMES, INSTRUMENTS: INSTRUMENTS, PALETTE: PALETTE, MAX_LINES: MAX_LINES, MAX_POINTS: MAX_POINTS,
    degreeToMidi: degreeToMidi, noteName: noteName, totalTicks: totalTicks, stepTicks: stepTicks, scaleLen: scaleLen, rowCount: rowCount, dStart: dStart, rowFloat: rowFloat, rowMidi: rowMidi, midiAtRowFloat: midiAtRowFloat,
    defaultState: defaultState, sanitize: sanitize, columns: columns, lineNotes: lineNotes, lineGlides: lineGlides, buildLineEvents: buildLineEvents, accompaniment: accompaniment,
    erase: erase, swingShift: swingShift, toMidi: toMidi, toWav: toWav, example: example, clamp: clamp, mod: mod };
});
