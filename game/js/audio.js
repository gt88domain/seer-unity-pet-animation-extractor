/* ============================================================
 * audio.js — WebAudio 程序化音效 + 氛围 BGM, 零音频素材
 * ============================================================ */
(function (root) {
  "use strict";
  const A = { muted: false, _bgmTimer: 0, _bgmTheme: "" };
  let ctx = null, master = null, bgmGain = null;

  A.init = function () {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
      bgmGain = ctx.createGain(); bgmGain.gain.value = 0.16; bgmGain.connect(master);
    } catch (e) { ctx = null; }
  };

  function tone(freq, dur, type, vol, slideTo, delay, dest) {
    if (!ctx || A.muted) return;
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol, freq, delay) {
    if (!ctx || A.muted) return;
    const t = ctx.currentTime + (delay || 0);
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = freq || 1200;
    const g = ctx.createGain(); g.gain.value = vol || 0.25;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }

  const SEQ = {
    click: [[880, 0.06, "square", 0.12]],
    select: [[660, 0.07, "square", 0.14], [990, 0.09, "square", 0.14, 0, 0.07]],
    back: [[520, 0.07, "square", 0.12], [340, 0.09, "square", 0.12, 0, 0.07]],
    heal: [[523, 0.12, "sine", 0.2], [659, 0.12, "sine", 0.2, 0, 0.1], [784, 0.2, "sine", 0.2, 0, 0.2]],
    hit: [[0, 0.12, "noise", 0.3, 900]],
    superHit: [[0, 0.18, "noise", 0.35, 700], [1567, 0.15, "square", 0.12, 0, 0.05]],
    notVery: [[220, 0.15, "sawtooth", 0.15, 140]],
    crit: [[0, 0.1, "noise", 0.3, 2000], [0, 0.15, "noise", 0.35, 800, 0.08]],
    miss: [[1200, 0.2, "sine", 0.12, 300]],
    faint: [[400, 0.5, "sawtooth", 0.18, 60]],
    throwBall: [[300, 0.25, "sine", 0.15, 900]],
    ballOpen: [[1500, 0.08, "square", 0.15], [700, 0.12, "square", 0.15, 0, 0.08]],
    shake: [[200, 0.08, "square", 0.2, 120]],
    catchOk: [[523, 0.12, "square", 0.16], [659, 0.12, "square", 0.16, 0, 0.12], [784, 0.12, "square", 0.16, 0, 0.24], [1046, 0.3, "square", 0.18, 0, 0.36]],
    catchFail: [[500, 0.15, "square", 0.16], [350, 0.2, "square", 0.16, 0, 0.15]],
    run: [[600, 0.3, "sine", 0.14, 1400]],
    levelup: [[523, 0.1, "triangle", 0.22], [659, 0.1, "triangle", 0.22, 0, 0.1], [784, 0.1, "triangle", 0.22, 0, 0.2], [1046, 0.25, "triangle", 0.25, 0, 0.3]],
    evolve: [[392, 0.12, "sawtooth", 0.12], [494, 0.12, "sawtooth", 0.12, 0, 0.12], [587, 0.12, "sawtooth", 0.12, 0, 0.24], [784, 0.12, "sawtooth", 0.12, 0, 0.36], [1046, 0.4, "sawtooth", 0.14, 0, 0.48]],
    fanfare: [[523, 0.15, "square", 0.16], [523, 0.15, "square", 0.16, 0, 0.15], [523, 0.15, "square", 0.16, 0, 0.3], [659, 0.35, "square", 0.18, 0, 0.45], [784, 0.5, "square", 0.18, 0, 0.7]],
    buff: [[300, 0.25, "sine", 0.16, 900]],
    debuff: [[900, 0.25, "sine", 0.16, 300]],
    status: [[250, 0.1, "sawtooth", 0.14, 0], [250, 0.1, "sawtooth", 0.14, 0, 0.12]],
    sleep: [[440, 0.3, "sine", 0.12, 220], [440, 0.3, "sine", 0.1, 220, 0.35]],
    encounter: [[150, 0.4, "sawtooth", 0.2, 900], [150, 0.4, "sawtooth", 0.2, 900, 0.4]],
    boss: [[110, 0.5, "sawtooth", 0.22, 55], [220, 0.5, "sawtooth", 0.2, 82, 0.5]],
    evolveDone: [[784, 0.15, "triangle", 0.22], [1046, 0.3, "triangle", 0.25, 0, 0.15]],
    coin: [[988, 0.08, "square", 0.14], [1319, 0.2, "square", 0.14, 0, 0.08]],
    door: [[330, 0.15, "triangle", 0.18, 660]],
  };
  A.play = function (name) {
    const seq = SEQ[name];
    if (!seq) return;
    for (const [f, d, ty, v, slide, delay] of seq) {
      if (ty === "noise") noise(d, v, slide, delay);
      else tone(f, d, ty, v, slide, delay);
    }
  };

  // ---- BGM: 五声音阶小循环 ----
  const BGMS = {
    meadow: { bpm: 132, bass: 130.8, seq: [0, 2, 4, 7, 9, 7, 4, 2] },
    beach: { bpm: 112, bass: 146.8, seq: [0, 4, 2, 7, 4, 2, 0, -2] },
    volcano: { bpm: 150, bass: 98, seq: [0, 0, 3, 0, 5, 0, 3, 2] },
    ruins: { bpm: 100, bass: 110, seq: [0, 5, 4, 2, 0, 2, 4, 5] },
    sky: { bpm: 120, bass: 164.8, seq: [0, 2, 5, 7, 9, 12, 9, 7] },
    temple: { bpm: 140, bass: 87.3, seq: [0, 3, 5, 7, 10, 7, 5, 3] },
    battle: { bpm: 160, bass: 110, seq: [0, 0, 7, 0, 5, 0, 3, 5] },
    boss: { bpm: 172, bass: 82.4, seq: [0, 1, 0, 5, 0, 1, 3, 1] },
    title: { bpm: 96, bass: 130.8, seq: [0, 4, 7, 12, 7, 4, 2, 0] },
  };
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  function scaleNote(base, deg) {
    const neg = deg < 0;
    const a = Math.abs(deg);
    const oct = Math.floor(a / 5), idx = a % 5;
    let semi = PENTA[idx] + oct * 12;
    if (neg) semi = -semi;
    return base * Math.pow(2, semi / 12);
  }
  A.bgm = function (theme) {
    if (A._bgmTheme === theme) return;
    A.stopBgm();
    A._bgmTheme = theme;
    const cfg = BGMS[theme];
    if (!cfg) return;
    let step = 0;
    const beat = 60 / cfg.bpm / 2;
    const tick = () => {
      if (A._bgmTheme !== theme) return;
      if (!ctx || A.muted) { A._bgmTimer = setTimeout(tick, beat * 1000); return; }
      const deg = cfg.seq[step % cfg.seq.length];
      tone(scaleNote(cfg.bass * 4, deg), beat * 1.8, "triangle", 0.5, 0, 0, bgmGain);
      if (step % 4 === 0) tone(cfg.bass, beat * 3, "sine", 0.7, 0, 0, bgmGain);
      step++;
      A._bgmTimer = setTimeout(tick, beat * 1000);
    };
    tick();
  };
  A.stopBgm = function () {
    A._bgmTheme = "";
    if (A._bgmTimer) { clearTimeout(A._bgmTimer); A._bgmTimer = 0; }
  };
  A.toggleMute = function () {
    A.muted = !A.muted;
    if (master) master.gain.value = A.muted ? 0 : 0.5;
    return A.muted;
  };

  root.AudioSys = A;
})(typeof self !== "undefined" ? self : this);
