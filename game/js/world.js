/* ============================================================
 * world.js — tile 地图 / 网格行走 / 野生遭遇 / NPC 交互
 * ============================================================ */
(function (root) {
  "use strict";
  const TILE = 40;
  const W = {
    TILE: TILE, mapIdx: 0, cfg: null, rows: [],
    tx: 0, ty: 0, px: 0, py: 0, dir: 1, // 0上1下2左3右
    moving: false, mvT: 0, mvFrom: null, steps: 0, sinceEncounter: 99,
    bossBeaten: false, secretOpen: false, time: 0,
    input: { up: false, down: false, left: false, right: false },
    cb: {},
  };
  const BLOCKED = { T: 1, R: 1, W: 1, D: 1, H: 1, N: 1, B: 1, X: 1 };

  W.load = function (maps, idx, spawn, bossBeaten, secretOpen) {
    W.mapIdx = idx;
    W.cfg = maps[idx];
    W.rows = W.cfg.rows.map((r) => r.split(""));
    W.bossBeaten = !!bossBeaten;
    W.secretOpen = !!secretOpen;
    const s = spawn || W.cfg.spawn;
    W.tx = s.x; W.ty = s.y;
    W.px = s.x * TILE + TILE / 2; W.py = s.y * TILE + TILE / 2;
    W.dir = 1; W.moving = false; W.sinceEncounter = 99;
    W._scan();
  };
  W._scan = function () {
    W.npcs = []; W.signs = []; W.bossTile = null; W.exits = [];
    for (let y = 0; y < W.rows.length; y++)
      for (let x = 0; x < W.rows[y].length; x++) {
        const c = W.rows[y][x];
        if (c === "N") W.npcs.push({ x: x, y: y });
        else if (c === "X") W.signs.push({ x: x, y: y });
        else if (c === "B" && !W.bossTile) W.bossTile = { x: x, y: y };
        else if (c === "E") W.exits.push({ x: x, y: y });
      }
  };
  W.tileAt = function (x, y) {
    if (y < 0 || y >= W.rows.length || x < 0 || x >= W.rows[0].length) return "#";
    let c = W.rows[y][x];
    if (c === "B" && W.bossBeaten && !(W.secretOpen && W.cfg.secret)) c = ".";
    return c;
  };
  W.walkable = function (x, y) {
    const c = W.tileAt(x, y);
    if (c === "#") return false;
    return !BLOCKED[c];
  };

  const DIRS = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
  W.update = function (dt) {
    W.time += dt;
    if (!W.moving) {
      const inp = W.input;
      let d = -1;
      if (inp.up) d = 0; else if (inp.down) d = 1; else if (inp.left) d = 2; else if (inp.right) d = 3;
      if (d >= 0) {
        W.dir = d;
        const nx = W.tx + DIRS[d].x, ny = W.ty + DIRS[d].y;
        if (W.walkable(nx, ny)) {
          W.moving = true; W.mvT = 0;
          W.mvFrom = { x: W.px, y: W.py, tx: W.tx, ty: W.ty, nx: nx, ny: ny };
        }
      }
    } else {
      W.mvT += dt / 0.16;
      const f = W.mvFrom;
      if (W.mvT >= 1) {
        W.moving = false;
        W.tx = f.nx; W.ty = f.ny;
        W.px = W.tx * TILE + TILE / 2; W.py = W.ty * TILE + TILE / 2;
        W.steps++; W.sinceEncounter++;
        W._onEnterTile();
      } else {
        const ex = f.nx * TILE + TILE / 2, ey = f.ny * TILE + TILE / 2;
        // 平滑步进
        const k = W.mvT < 0.5 ? 2 * W.mvT * W.mvT : 1 - Math.pow(-2 * W.mvT + 2, 2) / 2;
        W.px = f.x + (ex - f.x) * k;
        W.py = f.y + (ey - f.y) * k;
      }
    }
    W._ambient(dt);
  };

  W._onEnterTile = function () {
    const c = W.tileAt(W.tx, W.ty);
    if (c === "E") {
      if (W.bossBeaten) { if (W.cb.onExit) W.cb.onExit(W.mapIdx); }
      else if (W.cb.onExitLocked) W.cb.onExitLocked();
      return;
    }
    if ((c === "," || c === "F") && W.sinceEncounter >= 2) {
      const rate = c === "F" ? 0.2 : 0.12;
      if (Math.random() < rate) {
        W.sinceEncounter = 0;
        if (W.cb.onWild) W.cb.onWild();
      }
    }
  };

  W.interact = function () {
    const d = DIRS[W.dir];
    const x = W.tx + d.x, y = W.ty + d.y;
    const c = W.tileAt(x, y);
    if (c === "H") { if (W.cb.onHeal) W.cb.onHeal(); return true; }
    if (c === "N") {
      const idx = W.npcs.findIndex((n) => n.x === x && n.y === y);
      const npc = (W.cfg.npcs || [])[idx] || {};
      if (npc.shop) { if (W.cb.onShop) W.cb.onShop(npc); }
      else if (W.cb.onTalk) W.cb.onTalk(npc.text || "……");
      return true;
    }
    if (c === "X") {
      const idx = W.signs.findIndex((n) => n.x === x && n.y === y);
      if (W.cb.onTalk) W.cb.onTalk((W.cfg.signs || [])[idx] || "……");
      return true;
    }
    if (c === "B") {
      if (!W.bossBeaten) { if (W.cb.onBoss) W.cb.onBoss(); }
      else if (W.secretOpen && W.cfg.secret) { if (W.cb.onSecret) W.cb.onSecret(); }
      else if (W.cb.onTalk) W.cb.onTalk("这里曾经盘踞着强大的精灵，已经被你收服了。");
      return true;
    }
    return false;
  };

  // ---------- 渲染 ----------
  function hash(x, y) {
    let h = (x * 73856093) ^ (y * 19349663) ^ (W.mapIdx * 83492791);
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }

  const THEMES = {
    meadow: { base: "#79c25f", base2: "#8fd176", path: "#d9c489", grass: "#4f9e3f", water: ["#3aa7e0", "#7fd4f7"], tree: ["#5b8c3e", "#3f6b2a"], flower: ["#ff6b9d", "#ffd93d", "#ffffff"] },
    beach: { base: "#e6d29a", base2: "#f0e0ac", path: "#cbb37e", grass: "#7fae5c", water: ["#2e9fd8", "#8fdcff"], tree: ["#6fa055", "#4a7a3a"], flower: ["#ff8fab", "#ffffff"] },
    volcano: { base: "#6b4a3f", base2: "#7a5648", path: "#4e4e58", grass: "#8a3b2e", water: ["#ff5722", "#ffca28"], tree: ["#555560", "#33333a"], flower: ["#ffab40"] },
    ruins: { base: "#a8a89e", base2: "#b8b8ae", path: "#8a8a80", grass: "#6f9e5f", water: ["#3aa7e0", "#7fd4f7"], tree: ["#7d8a99", "#565f6b"], flower: ["#ce93d8", "#ffffff"] },
    sky: { base: "#bfe3f2", base2: "#d3eefb", path: "#ffffff", grass: "#8fd0a8", water: ["#9fd8f5", "#e3f4fd"], tree: ["#ffffff", "#cfe9f5"], flower: ["#ff6b9d", "#ffd93d", "#b388ff", "#ffffff"] },
    temple: { base: "#3d4a6b", base2: "#46547a", path: "#2c3550", grass: "#5f7ec9", water: ["#5f7ec9", "#9fb6ff"], tree: ["#2c3550", "#1d2438"], flower: ["#fff176", "#ffeb3b"] },
  };

  W.draw = function (g, t) {
    const th = THEMES[W.cfg.theme] || THEMES.meadow;
    const rows = W.rows;
    // 地面
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) {
        const c = rows[y][x];
        const px = x * TILE, py = y * TILE;
        const h = hash(x, y);
        if (c === "W") {
          const k = (Math.sin(t * 2 + x * 0.7 + y * 0.4) + 1) / 2;
          g.fillStyle = k > 0.5 ? th.water[0] : th.water[1];
          g.fillRect(px, py, TILE, TILE);
          g.fillStyle = "rgba(255,255,255,0.25)";
          const off = Math.sin(t * 3 + x + y) * 6;
          g.fillRect(px + 6 + off, py + 12, 14, 3);
          g.fillRect(px + 20 - off, py + 26, 12, 3);
          continue;
        }
        g.fillStyle = h > 0.5 ? th.base : th.base2;
        g.fillRect(px, py, TILE, TILE);
        if (c === "P" || c === "E" || c === "." || c === "S" || c === "H" || c === "N" || c === "B" || c === "X" || c === "#") {
          if (c === "P" || c === "E") {
            g.fillStyle = th.path;
            g.fillRect(px, py, TILE, TILE);
            g.fillStyle = "rgba(0,0,0,0.08)";
            g.fillRect(px + 4, py + 4, 8, 5);
            g.fillRect(px + 22, py + 24, 10, 5);
          } else if (c === "E") {
            g.fillStyle = th.path; g.fillRect(px, py, TILE, TILE);
          }
          if (h > 0.72) { g.fillStyle = "rgba(0,0,0,0.1)"; g.fillRect(px + h * 20, py + (1 - h) * 20, 5, 5); }
        } else if (c === "," || c === "F") {
          // 草丛
          g.fillStyle = th.grass;
          for (let i = 0; i < 5; i++) {
            const gx = px + 4 + hash(x * 5 + i, y) * 32;
            const gh = 8 + hash(x, y * 7 + i) * 10;
            const sway = Math.sin(t * 3 + x + i) * 2;
            g.beginPath();
            g.moveTo(gx - 3, py + TILE - 2);
            g.quadraticCurveTo(gx + sway, py + TILE - gh, gx + sway * 2, py + TILE - gh - 4);
            g.quadraticCurveTo(gx + 2 + sway, py + TILE - gh, gx + 3, py + TILE - 2);
            g.fill();
          }
          if (c === "F") {
            for (let i = 0; i < 3; i++) {
              g.fillStyle = th.flower[Math.floor(hash(x + i * 3, y + i) * th.flower.length)];
              g.beginPath();
              g.arc(px + 8 + hash(x, y * 3 + i) * 24, py + 10 + hash(x * 2 + i, y) * 20, 3.2, 0, 6.29);
              g.fill();
            }
          }
        }
        if (c === "T" || c === "R" || c === "D") W._drawBlock(g, th, c, px, py, x, y, t);
      }
    // 设施 & 实体(按 y 排序: 简单按行画)
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) {
        const c = rows[y][x];
        const px = x * TILE, py = y * TILE;
        if (c === "H") W._drawHeal(g, px, py, t);
        else if (c === "N") {
          const idx = W.npcs.findIndex((n) => n.x === x && n.y === y);
          const npc = (W.cfg.npcs || [])[idx] || {};
          W._drawNPC(g, px, py, t, npc.shop ? "shop" : "guide");
        }
        else if (c === "X") W._drawSign(g, px, py);
        else if (c === "E") W._drawExit(g, px, py, t);
      }
    // Boss
    if (W.bossTile && !W.bossBeaten) {
      const bx = W.bossTile.x * TILE + TILE, by = W.bossTile.y * TILE + TILE;
      W._drawBoss(g, bx, by, t);
    } else if (W.bossTile && W.secretOpen && W.cfg.secret) {
      const bx = W.bossTile.x * TILE + TILE, by = W.bossTile.y * TILE + TILE;
      W._drawSecret(g, bx, by, t);
    }
    // 玩家
    W._drawPlayer(g, t);
  };

  W._drawBlock = function (g, th, c, px, py, x, y, t) {
    if (c === "T") {
      const sway = Math.sin(t * 1.5 + x) * 2;
      g.fillStyle = "#6d4c2f";
      g.fillRect(px + 16, py + 20, 8, 18);
      g.fillStyle = th.tree[1];
      g.beginPath(); g.arc(px + 20 + sway, py + 16, 15, 0, 6.29); g.fill();
      g.fillStyle = th.tree[0];
      g.beginPath(); g.arc(px + 14 + sway, py + 12, 10, 0, 6.29); g.fill();
      g.beginPath(); g.arc(px + 26 + sway, py + 13, 9, 0, 6.29); g.fill();
      g.fillStyle = "rgba(255,255,255,0.25)";
      g.beginPath(); g.arc(px + 15 + sway, py + 9, 4, 0, 6.29); g.fill();
    } else if (c === "R") {
      g.fillStyle = "#5a5a66";
      g.beginPath();
      g.moveTo(px + 4, py + 36); g.lineTo(px + 10, py + 12);
      g.lineTo(px + 26, py + 8); g.lineTo(px + 36, py + 36);
      g.closePath(); g.fill();
      g.fillStyle = "#7d7d8a";
      g.beginPath();
      g.moveTo(px + 10, py + 12); g.lineTo(px + 26, py + 8);
      g.lineTo(px + 22, py + 20); g.lineTo(px + 13, py + 22);
      g.closePath(); g.fill();
    } else if (c === "D") {
      // 石柱/水晶
      const isTemple = W.cfg.theme === "temple";
      g.fillStyle = isTemple ? "#232b45" : "#8e8e86";
      g.fillRect(px + 10, py + 6, 20, 30);
      g.fillStyle = isTemple ? "#39466e" : "#ababA2".toLowerCase();
      g.fillRect(px + 10, py + 6, 7, 30);
      g.fillStyle = isTemple ? "#ffd54f" : "#6fae6f";
      g.globalAlpha = 0.6 + Math.sin(t * 2 + x) * 0.3;
      g.fillRect(px + 17, py + 12, 6, 6);
      g.globalAlpha = 1;
      g.fillStyle = isTemple ? "#141a2e" : "#6f6f68";
      g.fillRect(px + 8, py + 2, 24, 6);
      g.fillRect(px + 8, py + 34, 24, 4);
    }
  };

  W._drawHeal = function (g, px, py, t) {
    // 治疗仪
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.beginPath(); g.ellipse(px + 20, py + 36, 14, 5, 0, 0, 6.29); g.fill();
    g.fillStyle = "#eceff1";
    g.fillRect(px + 8, py + 10, 24, 24);
    g.fillStyle = "#26c6da";
    g.fillRect(px + 11, py + 13, 18, 14);
    g.fillStyle = "rgba(255,255,255," + (0.4 + Math.sin(t * 4) * 0.2) + ")";
    g.fillRect(px + 13, py + 15, 5, 10);
    g.fillStyle = "#e53935";
    g.fillRect(px + 17, py + 4, 6, 12);
    g.fillRect(px + 14, py + 7, 12, 6);
    g.fillStyle = "#37474f";
    g.font = "bold 8px sans-serif"; g.textAlign = "center";
    g.fillText("HEAL", px + 20, py + 33);
  };
  W._drawNPC = function (g, px, py, t, kind) {
    const bob = Math.sin(t * 2 + px) * 1.5;
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.beginPath(); g.ellipse(px + 20, py + 37, 11, 4, 0, 0, 6.29); g.fill();
    // 身体
    g.fillStyle = kind === "shop" ? "#ef6c00" : "#2e7d32";
    g.beginPath();
    g.moveTo(px + 20, py + 6 + bob);
    g.quadraticCurveTo(px + 30, py + 20 + bob, px + 28, py + 36);
    g.lineTo(px + 12, py + 36);
    g.quadraticCurveTo(px + 10, py + 20 + bob, px + 20, py + 6 + bob);
    g.fill();
    // 头
    g.fillStyle = "#ffcc9e";
    g.beginPath(); g.arc(px + 20, py + 12 + bob, 7, 0, 6.29); g.fill();
    // 帽子
    g.fillStyle = kind === "shop" ? "#ffca28" : "#66bb6a";
    g.beginPath();
    g.moveTo(px + 10, py + 9 + bob); g.lineTo(px + 20, py - 1 + bob); g.lineTo(px + 30, py + 9 + bob);
    g.closePath(); g.fill();
    g.fillStyle = "#333";
    g.fillRect(px + 16, py + 11 + bob, 2.5, 2.5);
    g.fillRect(px + 21.5, py + 11 + bob, 2.5, 2.5);
  };
  W._drawSign = function (g, px, py) {
    g.fillStyle = "#6d4c2f";
    g.fillRect(px + 18, py + 20, 4, 16);
    g.fillStyle = "#8d6e4a";
    g.fillRect(px + 8, py + 8, 24, 14);
    g.fillStyle = "#5d4037";
    g.fillRect(px + 11, py + 12, 18, 2);
    g.fillRect(px + 11, py + 16, 13, 2);
  };
  W._drawExit = function (g, px, py, t) {
    const open = W.bossBeaten;
    g.fillStyle = open ? "rgba(255,213,79,0.9)" : "rgba(120,120,130,0.7)";
    g.beginPath();
    g.moveTo(px + 6, py + 38); g.lineTo(px + 6, py + 14);
    g.quadraticCurveTo(px + 20, py - 2, px + 34, py + 14);
    g.lineTo(px + 34, py + 38);
    g.lineTo(px + 26, py + 38); g.lineTo(px + 26, py + 16);
    g.quadraticCurveTo(px + 20, py + 8, px + 14, py + 16);
    g.lineTo(px + 14, py + 38);
    g.closePath(); g.fill();
    if (open) {
      g.fillStyle = "rgba(255,255,255," + (0.5 + Math.sin(t * 5) * 0.3) + ")";
      g.beginPath(); g.ellipse(px + 20, py + 24, 6, 12, 0, 0, 6.29); g.fill();
    }
  };
  W._drawBoss = function (g, bx, by, t) {
    const boss = W.cfg.boss;
    const bob = Math.sin(t * 2.2) * 5;
    // 光环
    g.save();
    g.globalAlpha = 0.35 + Math.sin(t * 3) * 0.12;
    g.strokeStyle = "#ff5252"; g.lineWidth = 3;
    g.beginPath(); g.ellipse(bx, by - 4, 46, 16, 0, 0, 6.29); g.stroke();
    g.restore();
    const img = root.Sprites.get("body", boss.pet);
    root.Sprites.drawFitH(g, img, bx, by + bob, 110, false);
    // 感叹号
    const jy = by - 130 + Math.sin(t * 5) * 4;
    g.fillStyle = "#ffeb3b";
    g.font = "bold 26px sans-serif"; g.textAlign = "center";
    g.lineWidth = 4; g.strokeStyle = "#333";
    g.strokeText("!", bx + 40, jy);
    g.fillText("!", bx + 40, jy);
    // 名字牌
    g.font = "bold 13px sans-serif";
    const label = "Lv" + boss.lv + " " + boss.name;
    const wpx = g.measureText(label).width + 14;
    g.fillStyle = "rgba(0,0,0,0.6)";
    g.fillRect(bx - wpx / 2, by + 4, wpx, 20);
    g.fillStyle = "#ffb74d";
    g.fillText(label, bx, by + 18);
  };
  W._drawSecret = function (g, bx, by, t) {
    // 神秘裂隙
    for (let i = 0; i < 3; i++) {
      g.save();
      g.globalAlpha = 0.5 - i * 0.13;
      g.strokeStyle = i % 2 ? "#7e57c2" : "#e040fb";
      g.lineWidth = 4;
      const r = 30 + i * 10 + Math.sin(t * 3 + i) * 4;
      g.beginPath(); g.ellipse(bx, by - 40, r * 0.6, r, 0.2, 0, 6.29); g.stroke();
      g.restore();
    }
    g.fillStyle = "#e040fb";
    g.font = "bold 13px sans-serif"; g.textAlign = "center";
    g.fillText("神秘裂隙", bx, by + 8);
  };
  W._drawPlayer = function (g, t) {
    const x = W.px, y = W.py;
    const bob = W.moving ? Math.abs(Math.sin(t * 18)) * 3 : Math.sin(t * 2) * 1;
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.beginPath(); g.ellipse(x, y + 14, 12, 4.5, 0, 0, 6.29); g.fill();
    const yy = y - bob;
    // 身体(小赛尔)
    g.fillStyle = "#f5f5f5";
    g.beginPath();
    g.moveTo(x, yy - 18);
    g.quadraticCurveTo(x + 11, yy - 10, x + 9, yy + 12);
    g.lineTo(x - 9, yy + 12);
    g.quadraticCurveTo(x - 11, yy - 10, x, yy - 18);
    g.fill();
    g.fillStyle = "#29b6f6";
    g.fillRect(x - 9, yy + 2, 18, 5);
    // 头盔
    g.fillStyle = "#eceff1";
    g.beginPath(); g.arc(x, yy - 20, 10, 0, 6.29); g.fill();
    // 面罩(随方向偏移)
    const off = W.dir === 2 ? -3 : W.dir === 3 ? 3 : 0;
    g.fillStyle = "#102a43";
    if (W.dir === 0) { g.fillRect(x - 7, yy - 26, 14, 3); }
    else {
      g.beginPath(); g.ellipse(x + off, yy - 20, 6.5, 5, 0, 0, 6.29); g.fill();
      g.fillStyle = "#4fc3f7";
      g.beginPath(); g.ellipse(x + off - 2, yy - 21, 2, 2.6, 0, 0, 6.29); g.fill();
      g.beginPath(); g.ellipse(x + off + 2.5, yy - 21, 2, 2.6, 0, 0, 6.29); g.fill();
    }
    // 天线
    g.strokeStyle = "#90a4ae"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, yy - 30); g.lineTo(x, yy - 36); g.stroke();
    g.fillStyle = (Math.floor(t * 2) % 2) ? "#ff5252" : "#ff8a80";
    g.beginPath(); g.arc(x, yy - 37, 2.5, 0, 6.29); g.fill();
    // 脚
    const step = W.moving ? Math.sin(t * 18) * 4 : 0;
    g.fillStyle = "#78909c";
    g.fillRect(x - 8, yy + 12, 6, 4 + (step > 0 ? -step * 0.4 : 0));
    g.fillRect(x + 2, yy + 12, 6, 4 + (step < 0 ? step * 0.4 : 0));
  };

  W._ambient = function (dt) {
    if (!root.VFX || Math.random() > dt * 6) return;
    const V = root.VFX;
    const x = Math.random() * 960, y = Math.random() * 640;
    const theme = W.cfg.theme;
    if (theme === "meadow") V.spawn(x, -10, { vx: 20, vy: 40, color: "#9ccc65", shape: "leaf", size: 6, life: 3, grav: 30 });
    else if (theme === "beach") V.spawn(x, y, { vx: 0, vy: -15, color: "#fff9c4", size: 3, life: 1.5, grav: 0 });
    else if (theme === "volcano") V.spawn(x, 650, { vx: (Math.random() - 0.5) * 30, vy: -60, color: Math.random() > 0.5 ? "#ff7043" : "#ffca28", size: 4, life: 2, grav: -40 });
    else if (theme === "ruins") V.spawn(x, y, { vx: 15, vy: 8, color: "#d7ccc8", size: 3, life: 2, grav: 0 });
    else if (theme === "sky") V.spawn(x, -10, { vx: 30, vy: 50, color: "#ffffff", shape: "leaf", size: 7, life: 3, grav: 20 });
    else if (theme === "temple") V.spawn(x, y, { vx: 0, vy: 0, color: "#9fb6ff", shape: "line", size: 5, life: 0.8, grav: 0 });
  };

  root.World = W;
})(typeof self !== "undefined" ? self : this);
