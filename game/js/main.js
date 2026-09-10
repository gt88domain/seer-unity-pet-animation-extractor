/* ============================================================
 * main.js — 游戏主控: 启动 / 存档 / 世界-战斗调度 / 输入 / 主循环
 * ============================================================ */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = "seer_legends_save_v1";

  const G = {
    team: [], box: [], bag: {}, money: 0, mapIdx: 0,
    bosses: [false, false, false, false, false, false],
    secretDone: [], dex: {}, playerName: "赛尔", // secretDone: 已击败的裂隙 Boss petId(4913 + secretPlus 轮换)
  };
  window.Game = G;

  // ---------- 存档 ----------
  G.save = function () {
    if (!G.team.length) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        team: G.team, box: G.box, bag: G.bag, money: G.money, mapIdx: G.mapIdx,
        bosses: G.bosses, secretDone: G.secretDone, dex: G.dex,
        pos: { x: World.tx, y: World.ty },
      }));
    } catch (e) { /* ignore */ }
  };
  G.hasSave = function () {
    try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); return !!(s && s.team && s.team.length); }
    catch (e) { return false; }
  };
  G.loadSave = function () {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    G.team = s.team; G.box = s.box || []; G.bag = s.bag; G.money = s.money;
    G.mapIdx = s.mapIdx || 0; G.bosses = s.bosses;
    G.secretDone = s.secretDone || (s.secretBeaten ? [4913] : []); // 兼容旧存档
    G.dex = s.dex || {};
    return s.pos;
  };
  G.registerDex = function (id, caught) {
    const cur = G.dex[id] || {};
    G.dex[id] = { seen: true, caught: !!(cur.caught || caught) };
  };

  // ---------- 世界 ----------
  G.enterWorld = function (spawn) {
    const maps = window.CFG.maps;
    World.cb = {
      onWild: () => G.startWild(),
      onBoss: () => G.startBoss(),
      onSecret: () => G.startSecret(),
      onHeal: () => G.doHeal(),
      onShop: (npc) => { AudioSys.play("select"); UI.openShop(npc.shop, npc.greet); },
      onTalk: (t) => { AudioSys.play("click"); UI.talk(t); },
      onExit: (idx) => G.gotoMap(idx + 1),
      onExitLocked: () => { AudioSys.play("back"); UI.toast("出口被守卫的力量封锁了，先击败本区域的 Boss！"); },
    };
    const beaten = G.bosses[G.mapIdx];
    const secretOpen = G.mapIdx === 5 && G.bosses[5] && !!G.nextSecret();
    World.load(maps, G.mapIdx, spawn, beaten, secretOpen);
    $("hudMap").textContent = maps[G.mapIdx].name;
    $("hudMoney").textContent = "🪙 " + G.money;
    AudioSys.bgm(maps[G.mapIdx].theme);
  };
  G.gotoMap = function (idx) {
    AudioSys.play("door");
    G.mapIdx = idx;
    G.save();
    G.enterWorld(null);
    UI.toast("来到了" + window.CFG.maps[idx].name + "！");
  };
  G.doHeal = function () {
    AudioSys.play("heal");
    for (const p of G.team) {
      p.hp = p.stats.maxhp;
      p.status = 0;
      p.moves.forEach((m) => { const s = window.SKILLS[m.id]; if (s) m.pp = s.pp; });
    }
    VFX.burst(World.px, World.py - 20, 1, 24);
    UI.toast("精灵们全部恢复了！");
    G.save();
  };

  // ---------- 战斗入口 ----------
  function pickWild() {
    const table = window.CFG.maps[G.mapIdx].wild;
    let sum = 0;
    for (const w of table) sum += w.w;
    let r = Math.random() * sum, pick = table[0];
    for (const w of table) { r -= w.w; if (r <= 0) { pick = w; break; } }
    const lv = pick.lvMin + Math.floor(Math.random() * (pick.lvMax - pick.lvMin + 1));
    return { id: pick.id, lv: lv };
  }
  G.startWild = function () {
    if (Battle.active || UI.anyOpen()) return;
    const w = pickWild();
    Battle.start({
      foeId: w.id, foeLv: w.lv, kind: "wild", theme: window.CFG.maps[G.mapIdx].theme,
      onEnd: (res) => G.afterBattle(res, null),
    });
  };
  G.startBoss = function () {
    if (Battle.active || UI.anyOpen()) return;
    const boss = window.CFG.maps[G.mapIdx].boss;
    UI.confirm("挑战 " + boss.name + " Lv" + boss.lv + "？", boss.intro, () => {
      Battle.start({
        foeId: boss.pet, foeLv: boss.lv, kind: "boss", theme: window.CFG.maps[G.mapIdx].theme,
        canCatch: false, canRun: false, bossName: boss.name, intro: boss.intro,
        onEnd: (res) => G.afterBattle(res, { type: "boss", cfg: boss }),
      });
    });
  };
  G.secretQueue = function () {
    const m6 = window.CFG.maps[5];
    return [m6.secret].concat(m6.secretPlus || []);
  };
  G.nextSecret = function () {
    const done = G.secretDone || [];
    return G.secretQueue().find((s) => done.indexOf(s.pet) < 0) || null;
  };
  G.startSecret = function () {
    if (Battle.active || UI.anyOpen()) return;
    const s = G.nextSecret();
    if (!s) return;
    UI.confirm("进入神秘裂隙？", s.intro + "（Lv" + s.lv + "，可捕捉！）", () => {
      Battle.start({
        foeId: s.pet, foeLv: s.lv, kind: "secret", theme: "temple",
        canCatch: true, canRun: true, intro: s.intro,
        onEnd: (res) => G.afterBattle(res, { type: "secret", cfg: s }),
      });
    });
  };

  G.afterBattle = function (res, bossCtx) {
    AudioSys.bgm(window.CFG.maps[G.mapIdx].theme);
    $("hudMoney").textContent = "🪙 " + G.money;
    if (res.result === "lose") {
      // 黑屏: 扣钱 + 回复 + 回出生点
      const lost = Math.floor(G.money * 0.1);
      G.money -= lost;
      for (const p of G.team) {
        p.hp = p.stats.maxhp; p.status = 0;
        p.moves.forEach((m) => { const sk = window.SKILLS[m.id]; if (sk) m.pp = sk.pp; });
      }
      G.save();
      G.enterWorld(window.CFG.maps[G.mapIdx].spawn);
      UI.toast("你输掉了战斗，损失了 " + lost + " 赛尔豆，精灵们已恢复。");
      return;
    }
    if (bossCtx && (res.result === "win")) {
      if (bossCtx.type === "boss") {
        G.bosses[G.mapIdx] = true;
        const rw = bossCtx.cfg.reward || {};
        if (rw.money) G.money += rw.money;
        if (rw.items) for (const k in rw.items) G.bag[k] = (G.bag[k] || 0) + rw.items[k];
        if (rw.pet) {
          const np = Engine.makePet(window.PETS, window.SKILLS, rw.pet, rw.petLv || 5, {});
          G.registerDex(rw.pet, true);
          if (G.team.length < window.CFG.teamSize) G.team.push(np);
          else G.box.push(np);
        }
        G.save();
        $("hudMoney").textContent = "🪙 " + G.money;
        const keepPos = { x: World.tx, y: World.ty };
        G.enterWorld(keepPos); // 刷新 Boss 状态(保留位置)
        let msg = bossCtx.cfg.winText + "<br/>获得 " + (rw.money || 0) + " 赛尔豆！";
        if (rw.pet) msg += "<br/>" + window.PETS[rw.pet].name + " 加入了队伍！";
        if (rw.items) msg += "<br/>获得道具：" + Object.keys(rw.items).map((k) => window.CFG.items[k].name + "×" + rw.items[k]).join("、");
        if (G.mapIdx === 5) msg += "<br/><b>通关！神秘裂隙已经开启，回去挑战它吧！</b>";
        else msg += "<br/>通往下一区域的出口已经解封！";
        UI.dialog("胜利！", "<p class='talk-text'>" + msg + "</p>");
      } else if (bossCtx.type === "secret") {
        const rw = bossCtx.cfg.reward || {};
        if (rw.money) G.money += rw.money;
        if (rw.items) for (const k in rw.items) G.bag[k] = (G.bag[k] || 0) + rw.items[k];
        G.secretDone = G.secretDone || [];
        if (G.secretDone.indexOf(bossCtx.cfg.pet) < 0) G.secretDone.push(bossCtx.cfg.pet);
        G.save();
        $("hudMoney").textContent = "🪙 " + G.money;
        G.enterWorld({ x: World.tx, y: World.ty }); // 刷新裂隙状态(保留位置)
        let smsg = bossCtx.cfg.winText;
        if (rw.money) smsg += "<br/>获得 " + rw.money + " 赛尔豆！";
        if (rw.items) smsg += "<br/>获得道具：" + Object.keys(rw.items).map((k) => window.CFG.items[k].name + "×" + rw.items[k]).join("、");
        if (!G.nextSecret()) smsg += "<br/>你已完成全部挑战，感谢游玩！";
        UI.dialog("传说！", "<p class='talk-text'>" + smsg + "</p>");
      }
    }
  };

  // ---------- 背包(世界中使用) ----------
  G.useItemOutside = function (itemId) {
    const def = window.CFG.items[itemId];
    if ((G.bag[itemId] || 0) <= 0) return;
    if (def.kind === "ball") { UI.toast("胶囊只能在战斗中使用！"); return; }
    UI._itemMode = itemId;
    UI.openParty(false, (idx) => G.applyItemTo(idx, itemId), false, { itemMode: true });
  };
  G.applyItemTo = function (idx, itemId) {
    const def = window.CFG.items[itemId];
    const pet = G.team[idx];
    let ok = false, msg = "";
    if (def.kind === "heal" && pet.hp > 0 && pet.hp < pet.stats.maxhp) {
      pet.hp = Math.min(pet.stats.maxhp, pet.hp + def.power); ok = true; msg = "恢复了体力！";
    } else if (def.kind === "revive" && pet.hp <= 0) {
      pet.hp = Math.floor(pet.stats.maxhp * def.power); pet.status = 0; ok = true; msg = "复活了！";
    } else if (def.kind === "cure" && pet.hp > 0 && pet.status) {
      pet.status = 0; ok = true; msg = "状态恢复了！";
    } else if (def.kind === "pp" && pet.hp > 0) {
      pet.moves.forEach((m) => { const s = window.SKILLS[m.id]; if (s) m.pp = Math.min(s.pp, m.pp + def.power); });
      ok = true; msg = "PP 恢复了！";
    }
    if (!ok) { UI.toast("用不了！"); UI.openBag(false); return; }
    G.bag[itemId]--;
    G.save();
    AudioSys.play("heal");
    UI.toast(window.PETS[pet.id].name + msg);
    UI.openBag(false);
  };

  // ---------- 启动 ----------
  async function boot() {
    const cv = $("game");
    const g = cv.getContext("2d");
    // 加载数据
    const [pets, skills, cfg] = await Promise.all([
      fetch("data/pets.json").then((r) => r.json()),
      fetch("data/skills.json").then((r) => r.json()),
      fetch("data/game.json").then((r) => r.json()),
    ]);
    // 神秘 Boss(4913 不在 spt.xml, 手工合成)
    pets["4913"] = {
      id: 4913, name: "？？？", type: 13, type2: 5,
      base: [110, 115, 90, 115, 90, 120],
      evoFrom: 0, evoTo: 0, evoLv: 0, catch: 3, yieldExp: 220, growth: 1,
      moves: [[10040, 1], [10010, 1], [10105, 1], [20006, 1]],
    };
    window.PETS = pets; window.SKILLS = skills; window.CFG = cfg;
    document.title = cfg.title + " · Seer Legends HTML5";

    // 皮肤 manifest + 上次选择
    try {
      const mf = await fetch("assets/skins/ghibli/manifest.json").then((r) => r.json());
      (mf.ids || []).forEach((id) => { Sprites.skinIds[id] = true; });
    } catch (e) { /* 无皮肤包 */ }
    try { Sprites.skin = localStorage.getItem("seer_skin") === "ghibli" ? "ghibli" : null; }
    catch (e) { Sprites.skin = null; }
    // 预加载立绘 (先经典后皮肤, 避免缓存键串味)
    const ids = Object.keys(pets).filter((k) => k !== "4913");
    const list = [];
    ids.forEach((id) => { list.push(["body", id]); list.push(["head", id]); });
    for (let t = 0; t <= 16; t++) list.push(["type", t]);
    const bar = $("loadBar"), txt = $("loadText");
    const wantSkin = Sprites.skin;
    Sprites.skin = null;
    await Sprites.preload(list, (d, t2) => {
      bar.style.width = ((d / t2) * 100).toFixed(0) + "%";
      txt.textContent = "加载资源 " + d + "/" + t2;
    });
    Sprites.skin = wantSkin;
    if (wantSkin) {
      const sl = [];
      Object.keys(Sprites.skinIds).forEach((id) => { sl.push(["body", id]); sl.push(["head", id]); });
      await Sprites.preload(sl, null);
    }
    $("loading").classList.add("hidden");

    // 标题
    UI.showTitle(G.hasSave());
    AudioSys.bgm("title");
    bindUI();
    G.refreshSkinBtns();

    // 主循环
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      VFX.update(dt);
      if (Battle.active) {
        Battle.draw(g, t, dt);
      } else if (G.team.length) {
        if (!UI.anyOpen()) World.update(dt);
        else World.time += dt;
        g.save();
        VFX.applyShake(g);
        World.draw(g, t);
        g.restore();
        VFX.draw(g);
        VFX.drawFlash(g, 960, 640);
        // 交互提示
        drawInteractHint(g);
      } else {
        // 标题背景
        drawTitleBg(g, t);
        VFX.draw(g);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function drawTitleBg(g, t) {
    const grad = g.createLinearGradient(0, 0, 0, 640);
    grad.addColorStop(0, "#0b1030");
    grad.addColorStop(0.6, "#243b6b");
    grad.addColorStop(1, "#3d6b9e");
    g.fillStyle = grad;
    g.fillRect(0, 0, 960, 640);
    // 星空
    g.fillStyle = "#fff";
    for (let i = 0; i < 90; i++) {
      const sx = (i * 173 + 40) % 960, sy = (i * 97 + 20) % 420;
      g.globalAlpha = 0.3 + Math.abs(Math.sin(t + i)) * 0.7;
      const r = i % 7 === 0 ? 2.4 : 1.3;
      g.fillRect(sx, sy, r, r);
    }
    g.globalAlpha = 1;
    // 星球
    g.fillStyle = "#4fc3f7";
    g.beginPath(); g.arc(760, 480, 150, 0, 6.29); g.fill();
    g.fillStyle = "#1d5f8a";
    g.beginPath(); g.ellipse(710, 450, 60, 26, -0.4, 0, 6.29); g.fill();
    g.beginPath(); g.ellipse(810, 520, 44, 20, 0.3, 0, 6.29); g.fill();
    g.strokeStyle = "#ffd54f"; g.lineWidth = 8;
    g.beginPath(); g.ellipse(760, 480, 200, 44, -0.25, 0, 6.29); g.stroke();
    // 剪影山丘
    g.fillStyle = "#101a35";
    g.beginPath(); g.moveTo(0, 640);
    for (let x = 0; x <= 960; x += 80) g.lineTo(x, 560 - ((x * 53) % 60));
    g.lineTo(960, 640); g.closePath(); g.fill();
  }

  function drawInteractHint(g) {
    if (Battle.active || UI.anyOpen() || !G.team.length) return;
    const d = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }][World.dir];
    const c = World.tileAt(World.tx + d.x, World.ty + d.y);
    if (c === "H" || c === "N" || c === "B" || c === "X") {
      const x = (World.tx + d.x) * 40 + 20, y = (World.ty + d.y) * 40 - 6 + Math.sin(performance.now() / 200) * 3;
      g.font = "bold 18px sans-serif"; g.textAlign = "center";
      g.fillStyle = "#fff";
      g.fillText("E", x, y);
    }
  }

  // ---------- 输入 & 按钮 ----------
  function bindUI() {
    AudioSys.init();
    document.addEventListener("pointerdown", () => AudioSys.init(), { once: true });
    document.addEventListener("keydown", () => AudioSys.init(), { once: true });

    const key = {};
    document.addEventListener("keydown", (e) => {
      if (e.repeat) { if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault(); return; }
      key[e.key] = true;
      syncInput();
      if (e.key === "e" || e.key === "E" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (Battle.active) Battle.skipSay();
        else if (!UI.anyOpen() && G.team.length) World.interact();
      }
      if (e.key === "Escape" && !Battle.active) UI.closePanels();
      if ((e.key === "m" || e.key === "M")) toggleMute();
    });
    document.addEventListener("keyup", (e) => { key[e.key] = false; syncInput(); });
    function syncInput() {
      World.input.up = !!(key.ArrowUp || key.w || key.W);
      World.input.down = !!(key.ArrowDown || key.s || key.S);
      World.input.left = !!(key.ArrowLeft || key.a || key.A);
      World.input.right = !!(key.ArrowRight || key.d || key.D);
    }
    // 触屏方向键
    const pad = { btnUp: "up", btnDown: "down", btnLeft: "left", btnRight: "right" };
    for (const id in pad) {
      const el = $(id);
      const on = (e) => { e.preventDefault(); AudioSys.init(); World.input[pad[id]] = true; };
      const off = (e) => { e.preventDefault(); World.input[pad[id]] = false; };
      el.addEventListener("pointerdown", on);
      el.addEventListener("pointerup", off);
      el.addEventListener("pointerleave", off);
      el.addEventListener("pointercancel", off);
    }
    $("btnAct").addEventListener("click", () => {
      AudioSys.init();
      if (Battle.active) Battle.skipSay();
      else if (!UI.anyOpen() && G.team.length) World.interact();
    });
    $("msgBox").addEventListener("click", () => Battle.skipSay());

    // 标题
    $("btnNew").onclick = () => {
      AudioSys.init(); AudioSys.play("select");
      if (G.hasSave()) {
        UI.confirm("重新开始？", "将覆盖现有存档，确定吗？", () => startNewGame());
      } else startNewGame();
    };
    $("btnContinue").onclick = () => {
      AudioSys.init(); AudioSys.play("select");
      const pos = G.loadSave();
      UI.hideTitle();
      $("mainScreen").classList.remove("hidden");
      G.enterWorld(pos);
      UI.toast("欢迎回来，赛尔！");
    };
    // HUD
    $("hudParty").onclick = () => { AudioSys.play("select"); if (!Battle.active) UI.openParty(false); };
    $("hudBag").onclick = () => { AudioSys.play("select"); if (!Battle.active) UI.openBag(false); };
    $("hudDex").onclick = () => { AudioSys.play("select"); if (!Battle.active) UI.openDex(); };
    $("hudSave").onclick = () => { G.save(); UI.toast("已保存！"); AudioSys.play("coin"); };
    $("hudMute").onclick = () => toggleMute();
    if ($("hudSkin")) $("hudSkin").onclick = () => { AudioSys.play("select"); G.toggleSkin(); };
    if ($("btnSkin")) $("btnSkin").onclick = () => { AudioSys.play("select"); G.toggleSkin(); };
    $("hudHelp").onclick = () => {
      AudioSys.play("click");
      UI.dialog("玩法指南",
        "<div class='help'>" +
        "<p>🕹️ <b>移动</b>：WASD / 方向键（手机用方向键），<b>E / 空格</b> 互动。</p>" +
        "<p>🌿 在<b>草丛</b>中行走会遇到野生精灵，先削弱再捕捉！</p>" +
        "<p>⚔️ 每张地图有一只 <b>Boss</b>，击败后解锁出口并获得奖励。</p>" +
        "<p>✨ 精灵升级会学新招、会进化；属性克制是致胜关键。</p>" +
        "<p>💊 治疗仪免费回满状态；商店补充胶囊和伤药。</p>" +
        "<p>🏆 击败雷伊后，神殿会出现<b>神秘裂隙</b>……</p></div>");
    };
    // 面板关闭
    ["partyClose", "bagClose", "shopClose", "dexClose"].forEach((id) => {
      $(id).onclick = () => {
        if (id === "partyClose" && !Battle.active && UI._itemMode) { UI._itemMode = null; UI.openBag(false); return; }
        AudioSys.play("back"); UI.closePanels();
        if (!Battle.active) return;
        if (id === "partyClose" && !UI.partyForced) Battle.showMenu();
        if (id === "bagClose") Battle.showMenu();
      };
    });
    $("panelMask").onclick = () => {
      if (!Battle.active) { if (UI._itemMode) { UI._itemMode = null; UI.openBag(false); } else UI.closePanels(); }
    };
    // 战斗按钮
    $("btnFight").onclick = () => Battle.onFight();
    $("btnBattleBag").onclick = () => Battle.onBag();
    $("btnPets").onclick = () => Battle.onPets();
    $("btnRun").onclick = () => Battle.onRun();
  }
  function toggleMute() {
    const m = AudioSys.toggleMute();
    $("hudMute").textContent = m ? "🔇" : "🔊";
  }
  // 画风切换: 经典 <-> 宫崎骏Q版 (仅 manifest 内已绘制的精灵生效, 其余自动回退经典)
  G.toggleSkin = async function () {
    if (!Object.keys(Sprites.skinIds).length) { UI.toast("宫崎骏Q版皮肤包还在绘制中…"); return; }
    Sprites.skin = Sprites.skin ? null : "ghibli";
    try { localStorage.setItem("seer_skin", Sprites.skin || ""); } catch (e) { /* ignore */ }
    if (Sprites.skin) {
      const sl = [];
      Object.keys(Sprites.skinIds).forEach((id) => { sl.push(["body", id]); sl.push(["head", id]); });
      UI.toast("正在加载宫崎骏Q版…");
      await Sprites.preload(sl, null);
    }
    G.refreshSkinBtns();
    UI.toast(Sprites.skin ? "已切换：宫崎骏Q版画风 ✨(首批三主宠)" : "已切换：经典画风");
  };
  G.refreshSkinBtns = function () {
    const t = Sprites.skin ? "🎨Q版" : "🎨经典";
    if ($("hudSkin")) $("hudSkin").textContent = t;
    if ($("btnSkin")) $("btnSkin").textContent = Sprites.skin ? "🎨 画风：宫崎骏Q版" : "🎨 画风：经典";
  };
  function startNewGame() {
    UI.hideTitle();
    UI.showStarter((starterId) => {
      G.team = [Engine.makePet(window.PETS, window.SKILLS, starterId, 5, {})];
      G.box = [];
      G.bag = Object.assign({}, window.CFG.startBag);
      G.money = window.CFG.startMoney;
      G.mapIdx = 0;
      G.bosses = [false, false, false, false, false, false];
      G.secretDone = [];
      G.dex = {};
      G.registerDex(starterId, true);
      G.save();
      $("mainScreen").classList.remove("hidden");
      G.enterWorld(null);
      UI.dialog("博士寄语",
        "<p class='talk-text'>欢迎来到赛尔世界！<br/>带上你的" + window.PETS[starterId].name +
        "，去草丛里结识新伙伴，挑战六大守卫，成为星辰最强训练师吧！</p>");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
