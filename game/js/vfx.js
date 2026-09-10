/* ============================================================
 * vfx.js — 粒子 / 属性弹道 / 浮动数字 / 震屏
 * ============================================================ */
(function (root) {
  "use strict";
  const V = { parts: [], shots: [], texts: [], rings: [], shake: 0, flash: 0, flashColor: "#fff" };

  // 16 属性视觉主题: [主色, 副色, 形态]
  V.THEME = {
    1: ["#66bb44", "#2e7d32", "leaf"], 2: ["#4fc3f7", "#1565c0", "drop"],
    3: ["#ff7043", "#c62828", "flame"], 4: ["#e1f5fe", "#90a4ae", "slash"],
    5: ["#ffeb3b", "#f57f17", "spark"], 6: ["#b0bec5", "#546e7a", "shard"],
    7: ["#a1887f", "#5d4037", "rock"], 8: ["#ffffff", "#9e9e9e", "ring"],
    9: ["#b2ebf2", "#0288d1", "chip"], 10: ["#ce93d8", "#6a1b9a", "orb"],
    11: ["#ef5350", "#b71c1c", "slash"], 12: ["#fff176", "#f9a825", "ray"],
    13: ["#7e57c2", "#311b92", "wisp"], 14: ["#80cbc4", "#00695c", "orb"],
    15: ["#f48fb1", "#ad1457", "flame"], 16: ["#fffde7", "#ffd54f", "ray"],
  };

  V.spawn = function (x, y, o) {
    o = o || {};
    V.parts.push({
      x: x, y: y,
      vx: o.vx != null ? o.vx : (Math.random() - 0.5) * (o.spread || 160),
      vy: o.vy != null ? o.vy : (Math.random() - 0.5) * (o.spread || 160) - 40,
      life: o.life || 0.6, age: 0, size: o.size || 5,
      color: o.color || "#fff", color2: o.color2 || o.color || "#fff",
      grav: o.grav || 300, shape: o.shape || "circle", rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 10, fade: o.fade !== false,
    });
  };
  V.burst = function (x, y, type, n, power) {
    const th = V.THEME[type] || V.THEME[8];
    n = n || 18;
    for (let i = 0; i < n; i++) {
      V.spawn(x, y, {
        color: i % 2 ? th[0] : th[1], color2: th[0],
        shape: th[2] === "leaf" || th[2] === "chip" ? "rect" : th[2] === "spark" || th[2] === "ray" ? "line" : "circle",
        spread: 120 + (power || 0) * 2, size: 3 + Math.random() * 5, life: 0.4 + Math.random() * 0.4,
      });
    }
    V.rings.push({ x: x, y: y, r: 6, max: 46 + (power || 0) / 4, age: 0, life: 0.35, color: th[0], width: 4 });
  };
  V.ringFx = function (x, y, color, max) {
    V.rings.push({ x: x, y: y, r: 4, max: max || 60, age: 0, life: 0.5, color: color || "#fff", width: 3 });
  };
  // 弹道: from->to, 命中回调
  V.shot = function (x0, y0, x1, y1, type, dur, onHit) {
    V.shots.push({ x0: x0, y0: y0, x1: x1, y1: y1, type: type || 8, t: 0, dur: dur || 0.45, onHit: onHit, arc: 40 + Math.random() * 30 });
  };
  V.floatText = function (x, y, text, color, size) {
    V.texts.push({ x: x, y: y, text: text, color: color || "#fff", size: size || 22, age: 0, life: 1.0 });
  };
  V.doShake = function (amt) { V.shake = Math.max(V.shake, amt || 6); };
  V.doFlash = function (color, amt) { V.flashColor = color || "#fff"; V.flash = Math.max(V.flash, amt != null ? amt : 0.5); };
  V.clear = function () { V.parts.length = 0; V.shots.length = 0; V.texts.length = 0; V.rings.length = 0; V.shake = 0; V.flash = 0; };

  V.update = function (dt) {
    for (let i = V.parts.length - 1; i >= 0; i--) {
      const p = V.parts[i];
      p.age += dt;
      if (p.age >= p.life) { V.parts.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (let i = V.shots.length - 1; i >= 0; i--) {
      const s = V.shots[i];
      s.t += dt / s.dur;
      const px = s.x0 + (s.x1 - s.x0) * Math.min(1, s.t);
      const py = s.y0 + (s.y1 - s.y0) * Math.min(1, s.t) - Math.sin(Math.min(1, s.t) * Math.PI) * s.arc;
      const th = V.THEME[s.type] || V.THEME[8];
      V.spawn(px, py, { color: th[0], vx: 0, vy: 0, grav: 0, size: 4, life: 0.25 });
      if (s.t >= 1) { V.shots.splice(i, 1); if (s.onHit) s.onHit(); }
    }
    for (let i = V.texts.length - 1; i >= 0; i--) {
      const t = V.texts[i];
      t.age += dt; t.y -= 46 * dt;
      if (t.age >= t.life) V.texts.splice(i, 1);
    }
    for (let i = V.rings.length - 1; i >= 0; i--) {
      const r = V.rings[i];
      r.age += dt;
      r.r += (r.max - r.r) * Math.min(1, dt * 10);
      if (r.age >= r.life) V.rings.splice(i, 1);
    }
    V.shake *= Math.pow(0.001, dt);
    if (V.shake < 0.2) V.shake = 0;
    V.flash = Math.max(0, V.flash - dt * 2.2);
  };

  function drawShape(g, shape, x, y, size, rot, color, color2) {
    g.save();
    g.translate(x, y); g.rotate(rot);
    g.fillStyle = color; g.strokeStyle = color2 || color;
    if (shape === "rect") { g.fillRect(-size / 2, -size / 3, size, size * 0.66); }
    else if (shape === "line") { g.lineWidth = 2.5; g.beginPath(); g.moveTo(-size, 0); g.lineTo(size, 0); g.stroke(); }
    else if (shape === "leaf") {
      g.beginPath(); g.ellipse(0, 0, size * 0.7, size * 0.35, 0, 0, 6.29); g.fill();
    }
    else { g.beginPath(); g.arc(0, 0, size / 2, 0, 6.29); g.fill(); }
    g.restore();
  }

  V.draw = function (g) {
    for (const p of V.parts) {
      const a = p.fade ? 1 - p.age / p.life : 1;
      g.globalAlpha = Math.max(0, a);
      drawShape(g, p.shape === "circle" ? "circle" : p.shape, p.x, p.y, p.size, p.rot, p.color, p.color2);
    }
    g.globalAlpha = 1;
    for (const s of V.shots) {
      const k = Math.min(1, s.t);
      const px = s.x0 + (s.x1 - s.x0) * k;
      const py = s.y0 + (s.y1 - s.y0) * k - Math.sin(k * Math.PI) * s.arc;
      const th = V.THEME[s.type] || V.THEME[8];
      g.save();
      g.shadowColor = th[0]; g.shadowBlur = 14;
      drawShape(g, th[2] === "ring" ? "circle" : th[2], px, py, 11, k * 12, th[0], th[1]);
      g.restore();
    }
    for (const r of V.rings) {
      g.globalAlpha = Math.max(0, 1 - r.age / r.life);
      g.strokeStyle = r.color; g.lineWidth = r.width;
      g.beginPath(); g.arc(r.x, r.y, r.r, 0, 6.29); g.stroke();
    }
    g.globalAlpha = 1;
    g.textAlign = "center"; g.textBaseline = "middle";
    for (const t of V.texts) {
      const k = t.age / t.life;
      g.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      g.font = "bold " + t.size + "px sans-serif";
      g.lineWidth = 4; g.strokeStyle = "rgba(0,0,0,0.7)";
      g.strokeText(t.text, t.x, t.y);
      g.fillStyle = t.color;
      g.fillText(t.text, t.x, t.y);
    }
    g.globalAlpha = 1;
  };
  // 震屏偏移(调用方在绘制世界前应用)
  V.applyShake = function (g) {
    if (V.shake > 0) g.translate((Math.random() - 0.5) * V.shake, (Math.random() - 0.5) * V.shake);
  };
  V.drawFlash = function (g, w, h) {
    if (V.flash > 0) {
      g.globalAlpha = Math.min(1, V.flash);
      g.fillStyle = V.flashColor;
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 1;
    }
  };

  root.VFX = V;
})(typeof self !== "undefined" ? self : this);
