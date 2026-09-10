/* ============================================================
 * battle.js — 回合制战斗场景(渲染 + 演出 + 流程)
 * ============================================================ */
(function (root) {
  "use strict";
  const B = {
    active: false, busy: false, b: null, kind: "wild", theme: "meadow",
    foeMesh: null, myMesh: null, foeMeshOk: false, myMeshOk: false,
    dispHP: { p: 0, e: 0 }, dispExp: 0,
    anim: null, intro: 0, catchAnim: null, faintAnim: null,
    attempts: 0, foeDef: null, onEnd: null, foeLv: 5,
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);

  function petName(side) {
    const m = side === "p" ? B.b.player : B.b.enemy;
    return (side === "p" ? "" : "野生") + (root.PETS[m.pet.id] || { name: "???" }).name;
  }

  // ---------------- 开战 ----------------
  B.start = async function (opts) {
    // opts: {foeId, foeLv, kind, theme, foeMoves?, canCatch, canRun, bossName?, foeName?}
    B.active = true; B.busy = true;
    B.kind = opts.kind || "wild";
    B.theme = opts.theme || "meadow";
    B.foeLv = opts.foeLv;
    B.onEnd = opts.onEnd;
    B.attempts = 0;
    B.catchAnim = null; B.faintAnim = null;
    B.anim = { p: { x: 0, y: 0, flash: 0, scale: 1 }, e: { x: 0, y: 0, flash: 0, scale: 1 } };
    root.VFX.clear();
    $("battleLayer").classList.remove("hidden");
    $("worldHud").classList.add("hidden");
    $("touchPad").style.display = "none";
    B.hideAllMenus();

    const G = root.Game;
    const lead = G.team.find((p) => p.hp > 0);
    // 敌方
    const foePet = root.Engine.makePet(root.PETS, root.SKILLS, opts.foeId, opts.foeLv, { dv: 15, nature: 20 });
    if (opts.foeName) foePet.nick = opts.foeName;
    const foeMoves = opts.foeMoves || root.Engine.bestMoveset(root.PETS, root.SKILLS, opts.foeId, opts.foeLv);
    B.b = root.Engine.newBattle(lead, foePet, foeMoves);
    B._battlerUids = new Set([lead.uid]);
    B.canCatch = opts.canCatch !== false && B.kind !== "boss";
    B.canRun = opts.canRun !== false && B.kind === "wild" || B.kind === "secret";
    B.foeDef = root.PETS[opts.foeId];
    B.dispHP.p = lead.hp; B.dispHP.e = foePet.hp;
    B.dispExp = lead.exp;
    B.intro = 0;
    B.updatePlates();
    root.AudioSys.bgm(B.kind === "wild" ? "battle" : "boss");

    // 网格动画 Boss?
    await B._setupMesh(lead.id, "p", true);
    await B._setupMesh(opts.foeId, "e", false);

    // 入场
    const inT = setInterval(() => { B.intro = Math.min(1, B.intro + 0.06); if (B.intro >= 1) clearInterval(inT); }, 30);
    root.AudioSys.play(B.kind === "wild" ? "encounter" : "boss");
    if (B.kind === "boss") root.VFX.doShake(10);
    await sleep(900);
    if (B.kind === "wild") await B.say("草丛里跳出了 Lv" + opts.foeLv + " 的" + (root.PETS[opts.foeId].name) + "！");
    else if (B.kind === "boss") await B.say((opts.bossName || "守卫") + "挡住了去路！" + (opts.intro ? "\n" + opts.intro : ""));
    else await B.say(opts.intro || "神秘精灵出现了！");
    B.busy = false;
    B.showMenu();
  };

  B._setupMesh = async function (petId, side, mirror) {
    const MESH = {
      70: ["../70.pet.json", "../70._Atlas_.png"], 4913: ["../4913.pet.json", "../4913._Atlas_.png"],
      431: ["../431.pet.json", "../431._Atlas_.png"], 502: ["../502.pet.json", "../502._Atlas_.png"],
    };
    const key = side === "p" ? "myMesh" : "foeMesh";
    const okKey = side === "p" ? "myMeshOk" : "foeMeshOk";
    B[key] = null; B[okKey] = false;
    if (!MESH[petId] || typeof root.MeshPet === "undefined") return;
    try {
      const cv = document.createElement("canvas");
      const mp = new root.MeshPet(cv);
      await mp.load(MESH[petId][0], MESH[petId][1]);
      mp.setHeight(side === "p" ? 230 : 250);
      mp.play("standby");
      B[key] = mp; B[okKey] = true;
    } catch (e) { B[key] = null; B[okKey] = false; }
  };

  B.endBattle = function (result) {
    B.active = false;
    B.foeMesh = null; B.myMesh = null;
    root.VFX.clear();
    $("battleLayer").classList.add("hidden");
    $("worldHud").classList.remove("hidden");
    $("touchPad").style.display = "";
    const cb = B.onEnd;
    B.onEnd = null;
    if (cb) cb(result);
  };

  // ---------------- 消息框(打字机) ----------------
  B._sayResolve = null;
  B._sayToken = 0;
  B.say = function (text) {
    return new Promise((resolve) => {
      const tok = ++B._sayToken;
      const box = $("msgText");
      box.innerHTML = "";
      let i = 0;
      const full = text;
      const finish = () => { if (B._sayToken === tok) { B._sayResolve = null; resolve(); } };
      const timer = setInterval(() => {
        if (B._sayToken !== tok) { clearInterval(timer); return; } // 已被新消息取代
        i += 2;
        box.innerText = full.slice(0, i);
        if (i >= full.length) {
          clearInterval(timer);
          B._sayResolve = finish;
          // 自动继续(短句更快)
          setTimeout(() => { if (B._sayToken === tok && B._sayResolve) finish(); }, full.length > 24 ? 1400 : 900);
        }
      }, 24);
      B._sayResolve = () => {
        if (B._sayToken !== tok) return;
        clearInterval(timer); box.innerText = full; B._sayResolve = finish;
      };
    });
  };
  B.skipSay = function () { if (B._sayResolve) B._sayResolve(); };

  // ---------------- 菜单 ----------------
  B.hideAllMenus = function () {
    ["battleMenu", "skillMenu", "bagMenu", "partyMenu"].forEach((id) => { const el = $(id); if (el) el.classList.add("hidden"); });
  };
  B.showMenu = function () {
    if (!B.active || B.busy) return;
    B.hideAllMenus();
    $("battleMenu").classList.remove("hidden");
    $("btnRun").style.display = B.canRun ? "" : "none";
  };

  B.onFight = function () {
    if (B.busy) return;
    root.AudioSys.play("select");
    B.hideAllMenus();
    const m = $("skillMenu");
    m.innerHTML = "";
    const mon = B.b.player;
    if (!mon.moves.some((mv) => mv.pp > 0)) {
      // PP 耗尽: 挣扎
      const s = document.createElement("button");
      s.className = "skill-btn t8";
      s.innerHTML = "<span>挣扎</span><em>PP 0/0</em>";
      s.onclick = () => B.doTurn(99);
      m.appendChild(s);
    }
    mon.moves.forEach((mv, i) => {
      const sk = root.SKILLS[mv.id];
      if (!sk) return;
      const btn = document.createElement("button");
      btn.className = "skill-btn t" + sk.type;
      btn.innerHTML = "<span>" + sk.name + "</span><em>PP " + mv.pp + "/" + sk.pp + "</em>";
      btn.onclick = () => { if (mv.pp > 0) B.doTurn(i); else { root.AudioSys.play("back"); B.say("PP 不足！"); } };
      m.appendChild(btn);
    });
    const back = document.createElement("button");
    back.className = "skill-btn back";
    back.textContent = "← 返回";
    back.onclick = () => { root.AudioSys.play("back"); B.showMenu(); };
    m.appendChild(back);
    m.classList.remove("hidden");
  };

  B.onBag = function () {
    if (B.busy) return;
    root.AudioSys.play("select");
    root.UI.openBag(true, (itemId) => B.useItem(itemId));
  };
  B.onPets = function () {
    if (B.busy) return;
    root.AudioSys.play("select");
    root.UI.openParty(true, (idx) => B.switchTo(idx, false));
  };
  B.onRun = function () {
    if (B.busy || !B.canRun) return;
    B.busy = true; B.hideAllMenus();
    (async () => {
      B.attempts++;
      const ch = root.Engine.escapeChance(B.b.player.pet.stats.spe, B.b.enemy.pet.stats.spe, B.attempts);
      if (Math.random() < ch) {
        root.AudioSys.play("run");
        await B.say("你成功逃脱了！");
        B.endBattle({ result: "run" });
      } else {
        await B.say("逃跑失败！");
        const r = root.Engine.execTurn(root.SKILLS, B.b, -1);
        await B.playEvents(r.events);
        await B.postTurn();
      }
    })();
  };

  // ---------------- 回合 ----------------
  B.doTurn = async function (slot) {
    B.busy = true; B.hideAllMenus();
    const r = root.Engine.execTurn(root.SKILLS, B.b, slot);
    await B.playEvents(r.events);
    await B.postTurn();
  };
  B.postTurn = async function () {
    if (B.b.over) { await B.finishByKO(); return; }
    const G = root.Game;
    if (B.b.player.pet.hp <= 0) {
      // 我方倒下: 强制换宠
      if (G.team.some((p) => p.hp > 0)) {
        await B.say("选择下一只精灵！");
        root.UI.openParty(true, (idx) => B.switchTo(idx, true), true);
        B.busy = true;
      } else {
        await B.finishByKO();
      }
      return;
    }
    B.busy = false;
    B.showMenu();
  };
  B.finishByKO = async function () {
    const G = root.Game;
    if (B.b.winner === 1) await B.victory();
    else {
      await B.say("你的精灵全部倒下了……");
      B.endBattle({ result: "lose" });
    }
  };

  B.switchTo = async function (idx, free) {
    const G = root.Game;
    const pet = G.team[idx];
    if (!pet || pet.hp <= 0) return;
    if (pet.uid === B.b.player.pet.uid && !free && B.b.player.pet.hp > 0) { B.showMenu(); B.busy = false; return; }
    root.UI.closePanels();
    B.hideAllMenus(); B.busy = true;
    await B.say("回来吧！" + "去吧，" + root.PETS[pet.id].name + "！");
    // 换上: 重置战斗状态, 回满显示
    B.b.player = root.Engine.newBattleMon(pet);
    B._battlerUids.add(pet.uid);
    B.dispHP.p = pet.hp; B.dispExp = pet.exp;
    B.updatePlates();
    B.intro = 0;
    const inT = setInterval(() => { B.intro = Math.min(1, B.intro + 0.08); if (B.intro >= 1) clearInterval(inT); }, 30);
    await B._setupMesh(pet.id, "p", true);
    await sleep(500);
    if (!free) {
      const r = root.Engine.execTurn(root.SKILLS, B.b, -1);
      await B.playEvents(r.events);
      await B.postTurn();
    } else {
      B.busy = false;
      if (!B.b.over) B.showMenu();
    }
  };

  B.useItem = async function (itemId) {
    const G = root.Game;
    const def = root.CFG.items[itemId];
    if (!def || (G.bag[itemId] || 0) <= 0) return;
    root.UI.closePanels();
    B.hideAllMenus(); B.busy = true;
    if (def.kind === "ball") {
      if (!B.canCatch) { await B.say("这场战斗不能捕捉！"); B.busy = false; B.showMenu(); return; }
      G.bag[itemId]--;
      await B.catchSeq(itemId, def);
      return;
    }
    // 战斗内仅对当前精灵使用
    const pet = B.b.player.pet;
    let ok = false;
    if (def.kind === "heal" && pet.hp > 0 && pet.hp < pet.stats.maxhp) {
      pet.hp = Math.min(pet.stats.maxhp, pet.hp + def.power);
      ok = true;
      await B.say("对" + root.PETS[pet.id].name + "使用了" + def.name + "！");
      root.VFX.burst(240, 420, 1, 22); root.AudioSys.play("heal");
      await B.tweenHP("p");
    } else if (def.kind === "cure" && pet.hp > 0) {
      pet.status = 0; B.b.player.status = {};
      ok = true;
      await B.say(root.PETS[pet.id].name + "的状态恢复了！");
      root.AudioSys.play("heal");
    } else if (def.kind === "pp" && pet.hp > 0) {
      pet.moves.forEach((m) => { const s = root.SKILLS[m.id]; m.pp = Math.min(s.pp, m.pp + def.power); });
      ok = true;
      await B.say(root.PETS[pet.id].name + "的 PP 恢复了！");
      root.AudioSys.play("heal");
    }
    if (!ok) { await B.say("现在用不了这个！"); B.busy = false; B.showMenu(); return; }
    G.bag[itemId]--;
    G.save();
    B.updatePlates();
    const r = root.Engine.execTurn(root.SKILLS, B.b, -1);
    await B.playEvents(r.events);
    await B.postTurn();
  };

  // ---------------- 捕捉演出 ----------------
  B.catchSeq = async function (itemId, def) {
    const G = root.Game;
    await B.say("你扔出了" + def.name + "！");
    root.AudioSys.play("throwBall");
    B.catchAnim = { phase: "fly", t: 0, ball: itemId };
    await sleep(700);
    // 收服
    root.AudioSys.play("ballOpen");
    root.VFX.doFlash("#fff", 0.8);
    B.catchAnim.phase = "hold";
    B.anim.e.scale = 0.01;
    await sleep(600);
    B.catchAnim.phase = "shake";
    const foe = B.b.enemy.pet;
    const cur = foe.status || B._foeStatusId();
    const res = root.Engine.catchCheck(B.foeDef.catch, foe.stats.maxhp, foe.hp, def.bonus, cur);
    let broke = false;
    for (let i = 0; i < res.shakes; i++) {
      B.catchAnim.wob = 0;
      await sleep(750);
      root.AudioSys.play("shake");
      B.catchAnim.wob = 1;
      await sleep(250);
    }
    if (res.caught) {
      root.AudioSys.play("catchOk");
      root.VFX.burst(700, 320, 12, 30);
      root.VFX.doFlash("#fff176", 0.5);
      B.catchAnim.phase = "caught";
      await sleep(800);
      B.catchAnim = null;
      const cname = root.PETS[foe.id].name;
      await B.say("太棒了！抓到了" + cname + "！");
      G.registerDex(foe.id, true);
      // 入队/入箱
      const np = root.Engine.makePet(root.PETS, root.SKILLS, foe.id, foe.lv, {});
      np.hp = np.stats.maxhp;
      if (G.team.length < root.CFG.teamSize) { G.team.push(np); await B.say(cname + "加入了队伍！"); }
      else { G.box.push(np); await B.say("队伍已满，" + cname + "被传送到了电脑！"); }
      G.save();
      B.endBattle({ result: "caught", petId: foe.id });
    } else {
      broke = true;
      root.AudioSys.play("catchFail");
      B.catchAnim = null;
      B.anim.e.scale = 1;
      root.VFX.doFlash("#fff", 0.4);
      await B.say("哎呀！它挣脱出来了！");
      const r = root.Engine.execTurn(root.SKILLS, B.b, -1);
      await B.playEvents(r.events);
      await B.postTurn();
    }
  };
  B._foeStatusId = function () {
    const s = B.b.enemy.status;
    for (const k of [8, 5, 0, 1, 2]) if ((s[k] || 0) > 0) return k;
    return 0;
  };

  // ---------------- 胜利结算 ----------------
  B.victory = async function () {
    const G = root.Game;
    root.AudioSys.play("fanfare");
    const foe = B.b.enemy.pet;
    const isBoss = B.kind === "boss" || B.kind === "secret";
    await B.say("击败了" + (isBoss ? "" : "野生") + root.PETS[foe.id].name + "！");
    G.registerDex(foe.id, false);
    // 经验分配: 参战者全额, 其他人一半
    B._battlerUids = B._battlerUids || new Set([B.b.player.pet.uid]);
    for (const pet of G.team) {
      if (pet.hp <= 0 && pet.uid !== B.b.player.pet.uid) continue;
      if (pet.lv >= root.CFG.levelCap) continue;
      const rw = root.Engine.rewards(B.foeDef.yieldExp || 60, foe.lv, pet.lv, isBoss ? 3 : 1);
      const amt = B._battlerUids.has(pet.uid) ? rw.exp : Math.floor(rw.exp / 2);
      const r = root.Engine.addExp(root.PETS, root.SKILLS, pet, amt, root.CFG.levelCap);
      if (pet.uid === B.b.player.pet.uid) {
        B.dispExp = pet.exp - amt; // 下面 tween
        await B.tweenExp(pet, amt);
      }
      await B.say(root.PETS[pet.id].name + " 获得了 " + amt + " 点经验！");
      if (r.levels > 0) {
        root.AudioSys.play("levelup");
        root.VFX.burst(240, 400, 12, 26);
        await B.say(root.PETS[pet.id].name + " 升到了 Lv" + pet.lv + "！");
        for (const mid of r.newMoves) {
          await B.say(root.PETS[pet.id].name + " 学会了 " + (root.SKILLS[mid] || {}).name + "！");
        }
        B.dispHP.p = pet.hp;
        B.updatePlates();
      }
      // 进化?
      const evo = root.Engine.checkEvolve(root.PETS, pet);
      if (evo) await B.evolveSeq(pet, evo);
    }
    const rw = root.Engine.rewards(B.foeDef.yieldExp || 60, foe.lv, foe.lv, isBoss ? 3 : 1);
    G.money += rw.money;
    await B.say("获得了 " + rw.money + " 赛尔豆！");
    root.AudioSys.play("coin");
    G.save();
    B.endBattle({ result: "win", boss: isBoss });
  };

  B.evolveSeq = async function (pet, toId) {
    const G = root.Game;
    root.AudioSys.play("evolve");
    await B.say("咦？！" + root.PETS[pet.id].name + " 正在进化……");
    root.VFX.doFlash("#fff", 1);
    for (let i = 0; i < 3; i++) {
      root.VFX.burst(240, 400, 16, 20);
      await sleep(400);
    }
    root.Engine.doEvolve(root.PETS, root.SKILLS, pet, toId);
    G.registerDex(toId, true);
    root.VFX.doFlash("#fff176", 0.8);
    root.AudioSys.play("evolveDone");
    B.dispHP.p = pet.hp;
    B.updatePlates();
    await B.say("恭喜！" + root.PETS[pet.id].name + " 进化了！");
    G.save();
  };

  // ---------------- 事件播放 ----------------
  B.playEvents = async function (events) {
    for (const ev of events) {
      if (!B.active) return;
      await B.playOne(ev);
    }
  };
  B.sidePos = function (side) {
    return side === "p" ? { x: 250, y: 400 } : { x: 700, y: 270 };
  };
  B.playOne = async function (ev) {
    const A = root.AudioSys, V = root.VFX;
    const E = root.Engine;
    switch (ev.t) {
      case "use": {
        const sk = root.SKILLS[ev.move];
        await B.say(petName(ev.side) + " 使用了 " + (ev.moveName || (sk || {}).name) + "！");
        B.lunge(ev.side);
        const mp = ev.side === "p" ? B.myMesh : B.foeMesh;
        const ok = ev.side === "p" ? B.myMeshOk : B.foeMeshOk;
        if (ok && mp) mp.playOnce(ev.cat === 2 ? "sa" : "attack", "standby");
        await sleep(280);
        break;
      }
      case "damage": {
        const from = B.sidePos(ev.side === "p" ? "e" : "p");
        const to = B.sidePos(ev.side);
        const mt = ev.moveType || 8;
        // 弹道
        await new Promise((res) => { V.shot(from.x, from.y - 40, to.x, to.y - 60, mt, 0.32, res); });
        V.burst(to.x, to.y - 60, mt, ev.crit ? 30 : 18, 60);
        V.doShake(ev.crit ? 10 : 6);
        B.anim[ev.side].flash = 1;
        const mp = ev.side === "p" ? B.myMesh : B.foeMesh;
        const ok = ev.side === "p" ? B.myMeshOk : B.foeMeshOk;
        if (ok && mp) mp.playOnce("hited", "standby");
        if (ev.mult > 1) A.play("superHit");
        else if (ev.mult < 1) A.play("notVery");
        else A.play(ev.crit ? "crit" : "hit");
        V.floatText(to.x, to.y - 120, "-" + ev.dmg, ev.crit ? "#ffd54f" : "#fff", ev.crit ? 30 : 24);
        await B.tweenHP(ev.side);
        if (ev.crit) await B.say("暴击！");
        if (ev.mult > 1) await B.say("效果拔群！");
        else if (ev.mult < 1 && ev.mult > 0) await B.say("效果不太理想…");
        break;
      }
      case "miss": await B.say("但是打偏了！"); A.play("miss"); break;
      case "blocked": await B.say("被守护挡下了！"); V.ringFx(B.sidePos(ev.side).x, B.sidePos(ev.side).y - 60, "#4fc3f7", 60); break;
      case "stage": {
        const nm = petName(ev.side);
        const d = ev.to - ev.from;
        if (d === 0) { await B.say(nm + "的" + E.STAT_NAMES[ev.stat] + "没有变化…"); break; }
        A.play(d > 0 ? "buff" : "debuff");
        const p = B.sidePos(ev.side);
        V.burst(p.x, p.y - 60, d > 0 ? 12 : 13, 14);
        V.floatText(p.x, p.y - 120, (d > 0 ? "▲" : "▼") + E.STAT_NAMES[ev.stat], d > 0 ? "#ff8a80" : "#90caf9", 22);
        await B.say(nm + "的" + E.STAT_NAMES[ev.stat] + (d > 0 ? "提升了！" : "下降了！"));
        break;
      }
      case "status": {
        const nm = petName(ev.side);
        const map = {};
        map[E.ST.PARA] = "麻痹了"; map[E.ST.POISON] = "中毒了"; map[E.ST.BURN] = "烧伤了";
        map[E.ST.FREEZE] = "被冻住了"; map[E.ST.FEAR] = "害怕了"; map[E.ST.SLEEP] = "睡着了";
        map[E.ST.CONFUSION] = "混乱了"; map[E.ST.LEECH] = "被种下了寄生种子";
        A.play("status");
        const p = B.sidePos(ev.side);
        V.burst(p.x, p.y - 60, ev.status === E.ST.BURN ? 3 : ev.status === E.ST.POISON ? 1 : ev.status === E.ST.PARA ? 5 : 10, 14);
        await B.say(nm + (map[ev.status] || "状态异常") + "！");
        B.updatePlates();
        break;
      }
      case "statusDmg": {
        const p = B.sidePos(ev.side);
        B.anim[ev.side].flash = 0.7;
        V.floatText(p.x, p.y - 120, "-" + ev.dmg, "#ce93d8", 20);
        await B.tweenHP(ev.side);
        break;
      }
      case "heal": {
        const p = B.sidePos(ev.side);
        V.burst(p.x, p.y - 60, 1, 16);
        V.floatText(p.x, p.y - 120, "+" + ev.amount, "#69f0ae", 22);
        A.play("heal");
        await B.tweenHP(ev.side);
        if (ev.drain) await B.say(petName(ev.side) + "吸取了体力！");
        else if (ev.leech) { /* 寄生不刷屏 */ }
        else await B.say(petName(ev.side) + "恢复了体力！");
        break;
      }
      case "recoil": {
        const p = B.sidePos(ev.side);
        V.floatText(p.x, p.y - 120, "-" + ev.dmg, "#ff8a80", 20);
        await B.tweenHP(ev.side);
        await B.say(petName(ev.side) + "受到了反冲伤害！");
        break;
      }
      case "bound": await B.say(petName(ev.side) + "被束缚了！"); break;
      case "protect": {
        const p = B.sidePos(ev.side);
        V.ringFx(p.x, p.y - 60, "#4fc3f7", 70);
        await B.say(petName(ev.side) + "进入了守护状态！");
        break;
      }
      case "field": {
        const map = { watersport: "玩水使火系招式威力减弱了！", lightscreen: "竖起了光之壁！", mist: "白雾笼罩了全场！", safeguard: "神秘力量守护着全场！" };
        await B.say(map[ev.kind] || "环境变化了！");
        break;
      }
      case "msg": await B.say(ev.text); break;
      case "cant": {
        const nm = petName(ev.side);
        const map = { sleep: "呼呼大睡，动弹不得！", freeze: "被冻住，动弹不得！", paralysis: "麻痹得动弹不得！", fear: "害怕得不敢动弹！", confusion: "混乱得不知所措！", flinch: "畏缩了！" };
        if (ev.reason !== "skip" && ev.reason !== "switching" && ev.reason !== "fainted")
          await B.say(nm + (map[ev.reason] || "动弹不得！"));
        break;
      }
      case "ko": {
        const m = ev.side === "p" ? B.b.player : B.b.enemy;
        A.play("faint");
        B.faintAnim = { side: ev.side, t: 0 };
        await sleep(800);
        B.faintAnim = null;
        B.anim[ev.side].scale = 0.01;
        await B.say(petName(ev.side) + " 倒下了！");
        break;
      }
    }
  };

  B.lunge = function (side) {
    const a = B.anim[side];
    const dx = side === "p" ? 60 : -60;
    a.x = dx * 0.4; a.y = -20;
    setTimeout(() => { a.x = 0; a.y = 0; }, 260);
  };
  B.tweenHP = async function (side) {
    const m = side === "p" ? B.b.player : B.b.enemy;
    const target = m.pet.hp;
    const key = side;
    while (B.dispHP[key] !== target) {
      const d = target - B.dispHP[key];
      const step = Math.sign(d) * Math.max(1, Math.floor(Math.abs(d) / 8));
      B.dispHP[key] += step;
      if ((step > 0 && B.dispHP[key] > target) || (step < 0 && B.dispHP[key] < target)) B.dispHP[key] = target;
      B.updatePlates();
      await sleep(30);
    }
  };
  B.tweenExp = async function (pet, amt) {
    // 简化: 直接同步显示
    B.dispExp = pet.exp;
    B.updatePlates();
    await sleep(300);
  };

  B.updatePlates = function () {
    if (!B.b) return;
    const G = root.Game;
    const foe = B.b.enemy.pet, me = B.b.player.pet;
    const foeDef = root.PETS[foe.id], meDef = root.PETS[me.id];
    $("foeName").textContent = (B.kind === "wild" ? "野生 " : "") + foeDef.name + " Lv" + foe.lv;
    const fr = Math.max(0, B.dispHP.e / foe.stats.maxhp);
    $("foeHpBar").style.width = (fr * 100).toFixed(1) + "%";
    $("foeHpBar").className = "hp-fill" + (fr < 0.2 ? " low" : fr < 0.5 ? " mid" : "");
    $("foeHpText").textContent = B.dispHP.e + "/" + foe.stats.maxhp;
    B._statusIcon($("foeStatus"), B.b.enemy);
    $("myName").textContent = meDef.name + " Lv" + me.lv;
    const mr = Math.max(0, B.dispHP.p / me.stats.maxhp);
    $("myHpBar").style.width = (mr * 100).toFixed(1) + "%";
    $("myHpBar").className = "hp-fill" + (mr < 0.2 ? " low" : mr < 0.5 ? " mid" : "");
    $("myHpText").textContent = Math.max(0, B.dispHP.p) + "/" + me.stats.maxhp;
    B._statusIcon($("myStatus"), B.b.player);
    const need = root.Engine.expNeed(meDef.growth, me.lv);
    $("myExpBar").style.width = Math.max(0, Math.min(100, (B.dispExp / need) * 100)).toFixed(1) + "%";
  };
  B._statusIcon = function (el, mon) {
    const names = { 0: "麻", 1: "毒", 2: "烧", 5: "冻", 6: "怕", 8: "眠", 10: "乱", 100: "寄" };
    const cols = { 0: "#f9a825", 1: "#8e24aa", 2: "#e53935", 5: "#4dd0e1", 6: "#78909c", 8: "#5c6bc0", 10: "#ec407a", 100: "#43a047" };
    el.innerHTML = "";
    for (const k in mon.status) {
      if ((mon.status[k] || 0) > 0 && names[k]) {
        const s = document.createElement("span");
        s.className = "st-badge";
        s.style.background = cols[k];
        s.textContent = names[k];
        el.appendChild(s);
      }
    }
    if (mon.bound > 0) {
      const s = document.createElement("span");
      s.className = "st-badge";
      s.style.background = "#6d4c41";
      s.textContent = "缚";
      el.appendChild(s);
    }
  };

  // ---------------- 渲染 ----------------
  B.draw = function (g, t, dt) {
    if (!B.active) return;
    B._drawBg(g, t);
    g.save();
    root.VFX.applyShake(g);
    // 平台
    B._platform(g, 700, 300, 150, 34, t, 1);
    B._platform(g, 250, 500, 170, 40, t, 0);
    // 敌方
    const ex = 700 + (1 - B.intro) * 500 + B.anim.e.x;
    const ey = 300 + B.anim.e.y;
    B._drawMon(g, "e", ex, ey, t);
    // 我方
    const px = 250 - (1 - B.intro) * 500 + B.anim.p.x;
    const py = 500 + B.anim.p.y;
    B._drawMon(g, "p", px, py, t);
    // 捕捉球
    if (B.catchAnim) B._drawCatch(g, B.catchAnim, t);
    g.restore();
    root.VFX.draw(g);
    root.VFX.drawFlash(g, 960, 640);
  };

  B._drawMon = function (g, side, x, y, t) {
    const m = side === "p" ? B.b.player : B.b.enemy;
    const a = B.anim[side];
    const bob = Math.sin(t * (side === "p" ? 2.4 : 2) + (side === "p" ? 1 : 0)) * 5;
    // 受伤闪白
    a.flash = Math.max(0, a.flash - 0.06);
    // 濒死下沉
    let scaleY = 1, alpha = 1;
    if (B.faintAnim && B.faintAnim.side === side) {
      B.faintAnim.t += 0.06;
      scaleY = Math.max(0.05, 1 - B.faintAnim.t);
      alpha = Math.max(0, 1 - B.faintAnim.t * 0.8);
    }
    if (a.scale < 1 && !(B.catchAnim && side === "e")) a.scale = Math.min(1, a.scale + 0.05);
    const h = (side === "p" ? 215 : 195) * a.scale;
    if (h < 2) return;
    // 影子
    g.fillStyle = "rgba(0,0,0,0.28)";
    g.beginPath();
    g.ellipse(x, y + 6, h * 0.32, h * 0.08, 0, 0, 6.29);
    g.fill();
    const mp = side === "p" ? B.myMesh : B.foeMesh;
    const ok = side === "p" ? B.myMeshOk : B.foeMeshOk;
    g.save();
    g.globalAlpha = alpha;
    if (ok && mp) {
      try { mp.draw(performance.now()); } catch (e) { /* ignore */ }
      const cv = mp.cv;
      const dw = (cv.width / cv.height) * h;
      if (side === "p") { g.translate(x, y + bob); g.scale(-1, scaleY); g.drawImage(cv, -dw / 2, -h, dw, h); }
      else { g.translate(x, y + bob); g.scale(1, scaleY); g.drawImage(cv, -dw / 2, -h, dw, h); }
    } else {
      const img = root.Sprites.get("body", m.pet.id);
      g.translate(x, y + bob);
      g.scale(side === "p" ? -1 : 1, scaleY);
      const w = (img.width && img.height ? img.width / img.height : 0.7) * h;
      g.drawImage(img, -w / 2, -h, w, h);
    }
    g.restore();
    // 受伤闪白 overlay
    if (a.flash > 0) {
      g.save();
      g.globalAlpha = Math.min(1, a.flash) * 0.7;
      g.fillStyle = "#fff";
      g.beginPath();
      g.ellipse(x, y + bob - h / 2, h * 0.3, h * 0.48, 0, 0, 6.29);
      g.fill();
      g.restore();
    }
    // 异常状态小图标
    const st = m.status;
    let badge = null;
    if ((st[2] || 0) > 0) badge = ["🔥", "#e53935"];
    else if ((st[1] || 0) > 0) badge = ["☠", "#8e24aa"];
    else if ((st[0] || 0) > 0) badge = ["⚡", "#f9a825"];
    else if ((st[8] || 0) > 0) badge = ["💤", "#5c6bc0"];
    if (badge) {
      g.font = "20px sans-serif"; g.textAlign = "center";
      g.fillText(badge[0], x + h * 0.3, y + bob - h + 10);
    }
    // 守护罩
    if (m.protect || m.safeguard > 0 || m.lightscreen > 0) {
      g.save();
      g.globalAlpha = 0.3 + Math.sin(t * 4) * 0.1;
      g.strokeStyle = m.protect ? "#4fc3f7" : "#fff176";
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(x, y + bob - h / 2, h * 0.34, h * 0.52, 0, 0, 6.29);
      g.stroke();
      g.restore();
    }
  };

  B._platform = function (g, x, y, rx, ry, t, flip) {
    g.fillStyle = "rgba(0,0,0,0.2)";
    g.beginPath(); g.ellipse(x, y + 8, rx, ry, 0, 0, 6.29); g.fill();
    const grad = g.createLinearGradient(x, y - ry, x, y + ry);
    grad.addColorStop(0, "rgba(255,255,255,0.75)");
    grad.addColorStop(1, "rgba(200,200,200,0.55)");
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 6.29); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.8)";
    g.lineWidth = 3;
    g.beginPath(); g.ellipse(x, y, rx - 8, ry - 7, 0, 0, 6.29); g.stroke();
  };

  B._drawCatch = function (g, c, t) {
    const cols = { ball1: "#e53935", ball2: "#1e88e5", ball3: "#f9a825", master: "#6a1fb5" };
    const col = cols[c.ball] || "#e53935";
    const drawBall = (x, y, r, wob) => {
      g.save();
      g.translate(x, y);
      g.rotate(wob ? Math.sin(t * 20) * 0.35 * wob : 0);
      g.fillStyle = col;
      g.beginPath(); g.arc(0, 0, r, Math.PI, 0); g.fill();
      g.fillStyle = "#f5f5f5";
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI); g.fill();
      g.fillStyle = "#333";
      g.fillRect(-r, -2, r * 2, 4);
      g.fillStyle = "#fff";
      g.beginPath(); g.arc(0, 0, r * 0.32, 0, 6.29); g.fill();
      g.strokeStyle = "#333"; g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, r * 0.32, 0, 6.29); g.stroke();
      g.fillStyle = c.phase === "caught" ? "#ffeb3b" : "#ccc";
      g.beginPath(); g.arc(0, 0, r * 0.15, 0, 6.29); g.fill();
      g.restore();
    };
    if (c.phase === "fly") {
      c.t = Math.min(1, (c.t || 0) + 0.05);
      const x0 = 150, y0 = 560, x1 = 700, y1 = 250;
      const x = x0 + (x1 - x0) * c.t;
      const y = y0 + (y1 - y0) * c.t - Math.sin(c.t * Math.PI) * 120;
      drawBall(x, y, 16, 0);
    } else {
      drawBall(700, 292, 18, c.wob ? 1 : 0);
      if (c.wob) c.wob = Math.max(0, c.wob - 0.03);
    }
  };

  B._drawBg = function (g, t) {
    const th = B.theme;
    let top = "#79b8e0", mid = "#bfe3f2", bot = "#7ec850";
    if (th === "beach") { top = "#4aa3df"; mid = "#aee3f5"; bot = "#ecd9a0"; }
    else if (th === "volcano") { top = "#3a1f1a"; mid = "#7a3b28"; bot = "#4e2a22"; }
    else if (th === "ruins") { top = "#5f7ea6"; mid = "#b8c8dc"; bot = "#9a9a8e"; }
    else if (th === "sky") { top = "#3d8fd1"; mid = "#bfe3f2"; bot = "#e8f6fd"; }
    else if (th === "temple") { top = "#141a35"; mid = "#3d4a7a"; bot = "#2c3550"; }
    const grad = g.createLinearGradient(0, 0, 0, 640);
    grad.addColorStop(0, top);
    grad.addColorStop(0.62, mid);
    grad.addColorStop(0.63, bot);
    grad.addColorStop(1, bot);
    g.fillStyle = grad;
    g.fillRect(0, 0, 960, 640);
    // 天体
    if (th === "temple") {
      g.fillStyle = "#e8ecff";
      g.beginPath(); g.arc(830, 110, 40, 0, 6.29); g.fill();
      g.fillStyle = top;
      g.beginPath(); g.arc(845, 100, 34, 0, 6.29); g.fill();
      g.fillStyle = "#fff";
      for (let i = 0; i < 40; i++) {
        const sx = (i * 173 + 50) % 960, sy = (i * 97 + 30) % 300;
        g.globalAlpha = 0.4 + Math.sin(t * 2 + i) * 0.3;
        g.fillRect(sx, sy, 2, 2);
      }
      g.globalAlpha = 1;
    } else if (th === "volcano") {
      g.fillStyle = "#ff7043";
      g.beginPath(); g.arc(790, 130, 52, 0, 6.29); g.fill();
      g.fillStyle = "#ffab40";
      g.beginPath(); g.arc(790, 130, 38, 0, 6.29); g.fill();
    } else {
      g.fillStyle = "#fff59d";
      g.beginPath(); g.arc(830, 100, 44, 0, 6.29); g.fill();
      g.fillStyle = "#fffde7";
      g.beginPath(); g.arc(830, 100, 32, 0, 6.29); g.fill();
    }
    // 云
    g.fillStyle = th === "temple" ? "rgba(120,140,200,0.35)" : "rgba(255,255,255,0.85)";
    for (let i = 0; i < 4; i++) {
      const cx = ((i * 300 + t * (12 + i * 4)) % 1150) - 100;
      const cy = 60 + i * 52;
      g.beginPath();
      g.ellipse(cx, cy, 70, 22, 0, 0, 6.29);
      g.ellipse(cx + 40, cy + 6, 50, 18, 0, 0, 6.29);
      g.ellipse(cx - 45, cy + 8, 44, 16, 0, 0, 6.29);
      g.fill();
    }
    // 远山
    g.fillStyle = th === "temple" ? "#232b4a" : "rgba(60,90,60,0.35)";
    g.beginPath();
    g.moveTo(0, 400);
    for (let x = 0; x <= 960; x += 60) g.lineTo(x, 400 - 40 - ((x * 37) % 70));
    g.lineTo(960, 400); g.closePath(); g.fill();
    // 地面纹理
    g.fillStyle = "rgba(0,0,0,0.08)";
    for (let i = 0; i < 24; i++) {
      const gx = (i * 211) % 960, gy = 420 + (i * 53) % 200;
      g.beginPath(); g.ellipse(gx, gy, 26, 7, 0, 0, 6.29); g.fill();
    }
    if (th === "volcano") {
      // 岩浆裂缝
      g.strokeStyle = "#ff5722"; g.lineWidth = 3;
      g.globalAlpha = 0.7 + Math.sin(t * 3) * 0.3;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.moveTo(i * 350 + 60, 640);
        g.quadraticCurveTo(i * 350 + 140, 520, i * 350 + 90, 430);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
  };

  root.Battle = B;
})(typeof self !== "undefined" ? self : this);
