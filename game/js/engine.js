/* ============================================================
 * engine.js — 战斗/数值引擎
 * 完整移植自 Seer-golang-: internal/game/{battle,pets,skills}
 *  - 伤害公式 / STAB / 双属性克制 / 暴击 / 命中
 *  - 能力等级(-6..+6) / 异常状态 / AI 选招 / 经验&赛尔豆
 *  - SideEffect 附加效果全实现(见 SE_IMPL 注释)
 * 纯逻辑, 不依赖 DOM, 可在 node 下单测。
 * ============================================================ */
(function (root) {
  "use strict";

  const E = {};

  // ---- 属性克制表 (移植自 battle.go typeChart) ----
  // 1草 2水 3火 4飞行 5电 6机械 7地面 8普通 9冰 10超能 11战斗 12光 13暗影 14神秘 15龙 16圣灵
  E.CHART = {
    1: [2, 7], 2: [3, 7], 3: [1, 6, 9], 4: [1, 11], 5: [2, 4],
    6: [9], 7: [3, 5, 6], 8: [], 9: [1, 4, 7, 15], 10: [11],
    11: [8, 9], 12: [13], 13: [10, 12], 14: [], 15: [15], 16: [13, 15],
  };
  E.STAT_NAMES = ["攻击", "防御", "特攻", "特防", "速度", "命中"];
  // 异常状态 id (与 battle.go 常量一致)
  E.ST = { PARA: 0, POISON: 1, BURN: 2, FREEZE: 5, FEAR: 6, SLEEP: 8, CONFUSION: 10, LEECH: 100 };

  E.typeMult = function (atk, def) {
    const wins = E.CHART[atk] || [];
    if (wins.indexOf(def) >= 0) return 2;
    const back = E.CHART[def] || [];
    if (back.indexOf(atk) >= 0) return 0.5;
    return 1;
  };
  E.typeMultDual = function (atk, d1, d2) {
    const m1 = E.typeMult(atk, d1 || 8);
    if (!d2 || d2 === d1) return m1;
    return m1 * E.typeMult(atk, d2);
  };
  E.stageMult = function (s) {
    s = Math.max(-6, Math.min(6, s));
    return s >= 0 ? 1 + 0.5 * s : 1 / (1 + 0.5 * -s);
  };

  // ---- 性格修正表 (移植自 pets.go, 0-24) ----
  // 返回 [atk,def,spa,spd,spe] 修正
  E.NATURES = (function () {
    const n = [];
    for (let i = 0; i < 25; i++) n.push([1, 1, 1, 1, 1]);
    const set = (i, up, down) => { n[i][up] = 1.1; n[i][down] = 0.9; };
    set(0, 0, 1); set(1, 0, 4); set(2, 0, 2); set(3, 0, 3);
    set(4, 4, 0); set(5, 4, 1); set(6, 4, 2); set(7, 4, 3);
    set(8, 1, 0); set(9, 1, 4); set(10, 1, 2); set(11, 1, 3);
    set(12, 2, 0); set(13, 2, 1); set(14, 2, 4); set(15, 2, 3);
    set(16, 3, 0); set(17, 3, 1); set(18, 3, 4); set(19, 3, 2);
    return n; // 20-24 平衡
  })();

  // ---- 种族值 -> 实际属性 (移植自 pets.go GetStats) ----
  E.calcStats = function (base, lv, dv, nature) {
    dv = dv == null ? 31 : dv;
    const f = (b) => Math.max(1, Math.floor(((b * 2 + dv) * lv) / 100) + 5);
    const hp = Math.max(1, Math.floor(((base[0] * 2 + dv) * lv) / 100) + lv + 10);
    let st = { maxhp: hp, atk: f(base[1]), def: f(base[2]), spa: f(base[3]), spd: f(base[4]), spe: f(base[5]) };
    if (nature >= 0 && nature <= 24) {
      const m = E.NATURES[nature];
      st.atk = Math.max(1, Math.floor(st.atk * m[0]));
      st.def = Math.max(1, Math.floor(st.def * m[1]));
      st.spa = Math.max(1, Math.floor(st.spa * m[2]));
      st.spd = Math.max(1, Math.floor(st.spd * m[3]));
      st.spe = Math.max(1, Math.floor(st.spe * m[4]));
    }
    return st;
  };

  // ---- 升级所需经验 (移植自 pets.go GetExpInfo) ----
  E.expNeed = function (growth, lv) {
    const c = lv * lv * lv;
    switch (growth) {
      case 0: return Math.floor((c * 4) / 5);
      case 1: return c;
      case 2: return Math.floor((c * 6) / 5);
      case 3: return Math.floor((c * 3) / 2);
      default: return c;
    }
  };

  // ---- 精灵实例 ----
  let _uid = 1;
  E.movesForLevel = function (def, lv) {
    return (def.moves || []).filter((m) => m[1] <= lv).map((m) => m[0]);
  };
  E.makePet = function (PETS, SKILLS, defId, lv, opts) {
    opts = opts || {};
    const def = PETS[defId];
    if (!def) throw new Error("unknown pet " + defId);
    const dv = opts.dv != null ? opts.dv : 24 + Math.floor(Math.random() * 8);
    const nature = opts.nature != null ? opts.nature : Math.floor(Math.random() * 25);
    const st = E.calcStats(def.base, lv, dv, nature);
    const learned = E.movesForLevel(def, lv).slice(-4);
    if (!learned.length) learned.push(10001);
    return {
      uid: _uid++, id: defId, lv: lv, exp: 0, dv: dv, nature: nature,
      _t1: def.type, _t2: def.type2 || 0,
      stats: st, hp: st.maxhp,
      moves: learned.map((id) => ({ id: id, pp: (SKILLS[id] || {}).pp || 35 })),
      status: 0, // 0 无; 否则 ST_* (仅持久类: 麻痹/中毒/烧伤; 睡眠/冻伤也存, 出战保留)
    };
  };
  // 升级: 返回 {levels, newMoves:[ids]}
  E.addExp = function (PETS, SKILLS, pet, amount, levelCap) {
    const def = PETS[pet.id];
    let levels = 0;
    const newMoves = [];
    pet.exp += amount;
    while (pet.lv < levelCap && pet.exp >= E.expNeed(def.growth, pet.lv)) {
      pet.exp -= E.expNeed(def.growth, pet.lv);
      pet.lv++;
      levels++;
      for (const [mid, mlv] of (def.moves || [])) {
        if (mlv === pet.lv) {
          newMoves.push(mid);
          if (pet.moves.length < 4) {
            pet.moves.push({ id: mid, pp: (SKILLS[mid] || {}).pp || 35 });
          } else {
            pet.moves.shift();
            pet.moves.push({ id: mid, pp: (SKILLS[mid] || {}).pp || 35 });
          }
        }
      }
      const ns = E.calcStats(def.base, pet.lv, pet.dv, pet.nature);
      const gain = ns.maxhp - pet.stats.maxhp;
      pet.stats = ns;
      pet.hp = Math.min(ns.maxhp, pet.hp + Math.max(0, gain));
    }
    if (pet.lv >= levelCap) pet.exp = 0;
    return { levels: levels, newMoves: newMoves };
  };
  E.checkEvolve = function (PETS, pet) {
    const def = PETS[pet.id];
    if (def && def.evoTo && def.evoLv > 0 && pet.lv >= def.evoLv) return def.evoTo;
    return 0;
  };
  E.doEvolve = function (PETS, SKILLS, pet, toId) {
    const def = PETS[toId];
    pet.id = toId;
    pet._t1 = def.type; pet._t2 = def.type2 || 0;
    pet.stats = E.calcStats(def.base, pet.lv, pet.dv, pet.nature);
    pet.hp = pet.stats.maxhp;
    // 进化后补学当前等级新招
    for (const [mid, mlv] of (def.moves || [])) {
      if (mlv <= pet.lv && !pet.moves.some((m) => m.id === mid)) {
        if (pet.moves.length < 4) pet.moves.push({ id: mid, pp: (SKILLS[mid] || {}).pp || 35 });
      }
    }
    return pet;
  };

  // ---- 敌方配招: 等级内最暴力的 4 招 (保证至少 1 个伤害技) ----
  E.bestMoveset = function (PETS, SKILLS, defId, lv) {
    const def = PETS[defId];
    const pool = E.movesForLevel(def, lv).map((id) => SKILLS[id]).filter(Boolean);
    const score = (s) => (s.power || 0) + (s.type === def.type || s.type === def.type2 ? 25 : 0) + (s.cat === 4 ? 5 : 0);
    pool.sort((a, b) => score(b) - score(a));
    let pick = pool.slice(0, 4);
    if (!pick.some((s) => s.power > 0) && pool.length) {
      pick = [pool.find((s) => s.power > 0) || pool[0]];
    }
    return pick.map((s) => ({ id: s.id, pp: 99 }));
  };

  // ---- 战斗 ----
  E.newBattleMon = function (pet, moves) {
    const st = {};
    if (pet.status === E.ST.SLEEP) st[E.ST.SLEEP] = 3;
    else if (pet.status === E.ST.FREEZE) st[E.ST.FREEZE] = 2;
    else if (pet.status) st[pet.status] = 999; // 麻痹/中毒/烧伤带入战斗
    return {
      pet: pet, moves: moves || pet.moves,
      stages: [0, 0, 0, 0, 0, 0],
      status: st,          // id -> turns
      bound: 0,            // 束缚剩余回合
      protect: false, flinch: false, dbond: false, rage: false,
      charge: false, focus: false,
      mist: 0, safeguard: 0, lightscreen: 0,
    };
  };
  E.newBattle = function (playerPet, enemyPet, enemyMoves) {
    return {
      turn: 0, over: false, winner: 0, // 1 玩家 2 敌方
      player: E.newBattleMon(playerPet),
      enemy: E.newBattleMon(enemyPet, enemyMoves),
      watersport: 0,
    };
  };
  E.effSpeed = function (m) {
    let s = Math.floor(m.pet.stats.spe * E.stageMult(m.stages[4]));
    if ((m.status[E.ST.PARA] || 0) > 0) s = Math.floor(s / 2);
    return Math.max(1, s);
  };
  E.effStat = function (m, key, stageIdx) {
    const v = m.pet.stats[key] * E.stageMult(m.stages[stageIdx]);
    return Math.max(1, Math.floor(v));
  };

  // AI 选招 (移植自 battle.go AISelectSkill)
  E.aiPick = function (SKILLS, ai, foe) {
    let best = null, bestScore = -1;
    for (const m of ai.moves) {
      const s = SKILLS[m.id];
      if (!s || m.pp <= 0) continue;
      let score;
      if (s.power > 0) {
        const tm = E.typeMultDual(s.type, foe.pet._t1, foe.pet._t2);
        score = Math.floor((s.power * tm * 100 * (s.acc || 100)) / 100);
        if (foe.pet.hp / foe.pet.stats.maxhp < 0.3) score = Math.floor((score * 3) / 2);
      } else {
        score = 1000;
        if (ai.pet.hp / ai.pet.stats.maxhp < 0.5) score = 10000;
      }
      if (score > bestScore) { bestScore = score; best = m; }
    }
    if (!best) best = ai.moves.find((m) => m.pp > 0) || ai.moves[0];
    return best;
  };

  // 命中判定 (移植自 battle.go CheckHit)
  E.checkHit = function (att, def, sk) {
    if (sk.must) return true;
    let acc = sk.acc || 100;
    if (acc >= 100) return true;
    const stage = Math.max(-6, Math.min(6, att.stages[5]));
    let fin = acc + 25 * stage;
    fin = Math.max(1, Math.min(100, fin));
    return Math.random() * 100 < fin;
  };
  // 暴击判定 (移植自 battle.go CheckCrit)
  E.checkCrit = function (att, def, sk, isFirst, critBonus) {
    if (sk.critFirst && isFirst) return true;
    if (sk.critSecond && !isFirst) return true;
    if (sk.critSelfHalf && att.pet.hp < att.pet.stats.maxhp / 2) return true;
    if (sk.critFoeHalf && def.pet.hp < def.pet.stats.maxhp / 2) return true;
    let rate = sk.crit || 1;
    rate += Math.max(0, att.stages[4]);
    if (att.focus) rate += 2;
    rate += critBonus || 0;
    return Math.floor(Math.random() * 16) < rate;
  };

  // 伤害计算 (移植自 battle.go CalculateDamage)
  E.calcDamage = function (att, def, sk, isCrit, b) {
    if (sk.dmgBindLv) return { dmg: att.pet.lv, mult: 1 };
    let power = sk.power || 0;
    if (sk.pwrBindDv > 0) power = sk.pwrBindDv * 5;
    if (sk.pwrDouble && Object.keys(def.status).length > 0) power *= 2;
    if (att.charge && sk.type === 5) { power *= 2; att.charge = false; }
    if (b.watersport > 0 && sk.type === 3) power = Math.floor(power / 2);
    let atk, dfn;
    if (sk.cat === 1) { atk = E.effStat(att, "atk", 0); dfn = E.effStat(def, "def", 1); }
    else if (sk.cat === 2) {
      atk = E.effStat(att, "spa", 2); dfn = E.effStat(def, "spd", 3);
      if (def.lightscreen > 0) dfn *= 2;
    } else return { dmg: 0, mult: 1 };
    dfn = Math.max(1, Math.floor(dfn));
    const lv = att.pet.lv;
    const base = Math.floor((((lv * 0.4 + 2) * power * atk) / dfn / 50) + 2);
    let stab = 1;
    if (sk.type === att.pet._t1 || (att.pet._t2 > 0 && sk.type === att.pet._t2)) stab = 1.5;
    const mult = E.typeMultDual(sk.type, def.pet._t1, def.pet._t2);
    const critM = isCrit ? 1.5 : 1;
    const rand = (217 + Math.floor(Math.random() * 39)) / 255;
    return { dmg: Math.max(1, Math.floor(base * stab * mult * critM * rand)), mult: mult };
  };

  E.applyStage = function (m, stat, delta, events, side) {
    if (delta < 0 && m.mist > 0) {
      events.push({ t: "msg", text: "白雾守护着能力，不会下降！" });
      return;
    }
    const old = m.stages[stat];
    const nw = Math.max(-6, Math.min(6, old + delta));
    m.stages[stat] = nw;
    events.push({ t: "stage", side: side, stat: stat, from: old, to: nw });
  };
  E.setStatus = function (m, st, turns, events, side) {
    if (m.safeguard > 0 && (st === E.ST.POISON || st === E.ST.BURN || st === E.ST.PARA || st === E.ST.SLEEP || st === E.ST.FREEZE)) {
      events.push({ t: "msg", text: "神秘守护挡下了异常状态！" });
      return false;
    }
    if ((m.status[st] || 0) > 0) return false;
    m.status[st] = turns;
    // 持久类异常同步到 pet(战斗外可见)
    if (st === E.ST.PARA || st === E.ST.POISON || st === E.ST.BURN || st === E.ST.SLEEP || st === E.ST.FREEZE) {
      if (!m.pet.status) m.pet.status = st;
    }
    events.push({ t: "status", side: side, status: st });
    return true;
  };

  // 行动能力判定 (移植自 battle.go CanAct)
  E.canAct = function (m) {
    const s = m.status;
    if ((s[E.ST.SLEEP] || 0) > 0) { s[E.ST.SLEEP]--; if (s[E.ST.SLEEP] <= 0) delete s[E.ST.SLEEP]; return { ok: false, reason: "sleep" }; }
    if ((s[E.ST.FREEZE] || 0) > 0) { s[E.ST.FREEZE]--; if (s[E.ST.FREEZE] <= 0) delete s[E.ST.FREEZE]; return { ok: false, reason: "freeze" }; }
    if ((s[E.ST.PARA] || 0) > 0 && Math.random() < 0.25) return { ok: false, reason: "paralysis" };
    if ((s[E.ST.FEAR] || 0) > 0) {
      s[E.ST.FEAR]--; if (s[E.ST.FEAR] <= 0) delete s[E.ST.FEAR];
      if (Math.random() < 0.5) return { ok: false, reason: "fear" };
    }
    if ((s[E.ST.CONFUSION] || 0) > 0) {
      s[E.ST.CONFUSION]--; if (s[E.ST.CONFUSION] <= 0) delete s[E.ST.CONFUSION];
      if (Math.random() < 1 / 3) return { ok: false, reason: "confusion" };
    }
    if (m.flinch) { m.flinch = false; return { ok: false, reason: "flinch" }; }
    return { ok: true };
  };

  // 回合开始: 持续伤害 (移植自 ProcessStatusEffects + 寄生/束缚)
  E.tickStatus = function (b, m, side, events) {
    let dmg = 0;
    const s = m.status, maxhp = m.pet.stats.maxhp;
    const dot = (id, turnsLeft) => {
      dmg += Math.max(1, Math.floor(maxhp / 8));
      if (turnsLeft !== Infinity) { s[id]--; if (s[id] <= 0) delete s[id]; }
    };
    if ((s[E.ST.POISON] || 0) > 0) dot(E.ST.POISON, Infinity);
    if ((s[E.ST.BURN] || 0) > 0) dot(E.ST.BURN, Infinity);
    if ((s[E.ST.LEECH] || 0) > 0) {
      const d = Math.max(1, Math.floor(maxhp / 8));
      dmg += d;
      const foe = side === "p" ? b.enemy : b.player;
      foe.pet.hp = Math.min(foe.pet.stats.maxhp, foe.pet.hp + d);
      events.push({ t: "heal", side: side === "p" ? "e" : "p", amount: d, leech: true });
      s[E.ST.LEECH]--; if (s[E.ST.LEECH] <= 0) delete s[E.ST.LEECH];
    }
    if (m.bound > 0) {
      dmg += Math.max(1, Math.floor(maxhp / 8));
      m.bound--;
    }
    if (dmg > 0) {
      m.pet.hp = Math.max(0, m.pet.hp - dmg);
      events.push({ t: "statusDmg", side: side, dmg: dmg, remain: m.pet.hp });
    }
    return dmg;
  };

  /* 单次攻击执行。返回事件数组(调用方按顺序播放动画)。
     side: 'p' 玩家攻击 'e' 敌方攻击 */
  E.execAttack = function (SKILLS, b, side, moveSlot, isFirst) {
    const events = [];
    const att = side === "p" ? b.player : b.enemy;
    const def = side === "p" ? b.enemy : b.player;
    const foeSide = side === "p" ? "e" : "p";
    const mv = att.moves[moveSlot];
    let sk = (mv && SKILLS[mv.id]) || null;
    if (!sk) { // 挣扎
      sk = { id: 0, name: "挣扎", cat: 1, type: 8, power: 40, acc: 100, crit: 1, pri: 0, must: 0, se: [], args: [], pp: 99 };
    } else if (mv.pp > 0 && mv.pp < 90) {
      mv.pp--;
    }
    events.push({ t: "use", side: side, move: sk.id, moveName: sk.name, cat: sk.cat, type: sk.type });

    // 保护类技能先行(无视命中)
    if (sk.id === 10020 || sk.se.indexOf(46) >= 0) { att.protect = true; events.push({ t: "protect", side: side }); return events; }
    if (sk.id === 10210) { // 极度冰点: 一击必杀(命中即中)
      if (def.protect) { events.push({ t: "blocked", side: foeSide }); def.protect = false; return events; }
      if (!E.checkHit(att, def, sk)) { events.push({ t: "miss", side: foeSide }); return events; }
      def.pet.hp = 0;
      events.push({ t: "damage", side: foeSide, dmg: 9999, crit: false, mult: 1, remain: 0, ohko: true });
      return events;
    }
    if (sk.id === 10036) { att.dbond = true; events.push({ t: "msg", text: "使出了同生共死！", side: side }); return events; }

    const isDamaging = (sk.cat === 1 || sk.cat === 2) && sk.power > 0;
    if (!isDamaging) {
      E.applyNonDamage(SKILLS, b, side, sk, events);
      return events;
    }

    // 命中?
    if (def.protect) { def.protect = false; events.push({ t: "blocked", side: foeSide }); return events; }
    if (!E.checkHit(att, def, sk)) { events.push({ t: "miss", side: foeSide }); return events; }

    // 连击次数
    let hits = 1;
    const se31 = sk.se.indexOf(31);
    if (se31 >= 0) {
      const pool = [2, 2, 2, 3, 3, 3, 4, 5];
      hits = pool[Math.floor(Math.random() * pool.length)];
      const mn = sk.args[se31 * 2] || 2, mx = sk.args[se31 * 2 + 1] || 5;
      hits = Math.max(mn, Math.min(mx, hits));
    }
    let critBonus = 0;
    if (sk.se.indexOf(37) >= 0) critBonus = 2; // 惊雷切: 高暴击
    let totalDmg = 0;
    for (let h = 0; h < hits; h++) {
      if (def.pet.hp <= 0) break;
      const crit = E.checkCrit(att, def, sk, isFirst, critBonus);
      const r = E.calcDamage(att, def, sk, crit, b);
      let dmg = r.dmg;
      if (sk.se.indexOf(8) >= 0) dmg = Math.min(dmg, Math.max(0, def.pet.hp - 1)); // 手下留情
      def.pet.hp = Math.max(0, def.pet.hp - dmg);
      totalDmg += dmg;
      events.push({ t: "damage", side: foeSide, dmg: dmg, crit: crit, mult: r.mult, remain: def.pet.hp, hit: h + 1, of: hits, moveType: sk.type });
      if (def.pet.hp <= 0) break;
    }
    // 吸取
    if (sk.se.indexOf(1) >= 0 && totalDmg > 0 && att.pet.hp > 0) {
      const back = Math.max(1, Math.floor(totalDmg / 2));
      att.pet.hp = Math.min(att.pet.stats.maxhp, att.pet.hp + back);
      events.push({ t: "heal", side: side, amount: back, drain: true });
    }
    // 绿光波 SE54: 按 args[0]/args[1] 比例吸取
    if (sk.se.indexOf(54) >= 0 && totalDmg > 0 && att.pet.hp > 0) {
      const num = sk.args[0] || 1, den = sk.args[1] || 2;
      const back = Math.max(1, Math.floor((totalDmg * num) / den));
      att.pet.hp = Math.min(att.pet.stats.maxhp, att.pet.hp + back);
      events.push({ t: "heal", side: side, amount: back, drain: true });
    }
    // 反冲
    if (sk.se.indexOf(6) >= 0 && totalDmg > 0) {
      const denom = sk.args[sk.se.indexOf(6)] || 4;
      const rec = Math.max(1, Math.floor(totalDmg / denom));
      att.pet.hp = Math.max(0, att.pet.hp - rec);
      events.push({ t: "recoil", side: side, dmg: rec, remain: att.pet.hp });
    }
    // 高速旋转: 清除自身下降项
    if (sk.se.indexOf(3) >= 0) {
      for (let i = 0; i < 6; i++) if (att.stages[i] < 0) att.stages[i] = 0;
      events.push({ t: "msg", text: "高速旋转清除了能力下降！", side: side });
    }
    // 愤怒: 进入激怒
    if (sk.se.indexOf(9) >= 0) { att.rage = true; events.push({ t: "msg", text: "陷入了愤怒！", side: side }); }
    // 附加: 能力变化(攻击技自带, 如泡沫降命中/飞叶风暴降特攻)
    E.applyStageSEs(sk, att, def, side, foeSide, events, true);
    // 附加: 异常状态
    if (def.pet.hp > 0) E.applyStatusSEs(sk, att, def, side, foeSide, events);
    // 激怒结算: 受伤一方若激怒则攻击+1
    if (totalDmg > 0 && def.rage) {
      E.applyStage(def, 0, 1, events, foeSide);
      events.push({ t: "msg", text: "愤怒使攻击提升了！", side: foeSide });
    }
    // 同命结算
    if (def.pet.hp <= 0 && def.dbond && att.pet.hp > 0) {
      att.pet.hp = 0;
      events.push({ t: "msg", text: "同生共死带走了对手！", side: side });
      events.push({ t: "ko", side: side });
    }
    if (def.pet.hp <= 0) events.push({ t: "ko", side: foeSide });
    if (att.pet.hp <= 0) events.push({ t: "ko", side: side });
    return events;
  };

  // 攻击技附带的能力变化 SE4(自身)/SE5(对方), args 每 3 一组 [stat,chance,stages]
  E.applyStageSEs = function (sk, att, def, side, foeSide, events, forAttack) {
    let cursor = 0;
    const args = sk.args || [];
    // 变化技: 全部 SE 都是 4/5 分组
    sk.se.forEach((se) => {
      if (se !== 4 && se !== 5) return;
      const stat = args[cursor] || 0, ch = args[cursor + 1] == null ? 100 : args[cursor + 1], dg = args[cursor + 2] || 0;
      cursor += 3;
      if (Math.random() * 100 >= ch) return;
      if (se === 4) E.applyStage(att, stat, dg, events, side);
      else E.applyStage(def, stat, dg, events, foeSide);
    });
  };

  // 攻击技附加异常
  E.applyStatusSEs = function (sk, att, def, side, foeSide, events) {
    const roll = (ch) => Math.random() * 100 < ch;
    const args = sk.args || [];
    sk.se.forEach((se, i) => {
      const a = args[i] == null ? 100 : args[i];
      switch (se) {
        case 10: if (roll(a)) E.setStatus(def, E.ST.PARA, 999, events, foeSide); break;
        case 11:
          if (sk.power <= 15) { if (roll(a)) { def.bound = 4; events.push({ t: "bound", side: foeSide }); } }
          else if (roll(a)) E.setStatus(def, E.ST.POISON, 999, events, foeSide);
          break;
        case 12: if (roll(a)) E.setStatus(def, E.ST.BURN, 999, events, foeSide); break;
        case 14:
          if (sk.type === 9) { if (roll(a)) E.setStatus(def, E.ST.FREEZE, 2, events, foeSide); }
          else if (roll(a)) { def.bound = 4; events.push({ t: "bound", side: foeSide }); }
          break;
        case 15: if (roll(a)) E.setStatus(def, E.ST.FEAR, 1, events, foeSide); break;
        case 29: if (roll(a)) E.setStatus(def, E.ST.FEAR, 1, events, foeSide); break;
        case 20: if (roll(args[0] == null ? 100 : args[0])) E.setStatus(def, E.ST.FEAR, args[1] || 1, events, foeSide); break;
        case 22: if (roll(sk.args[0] == null ? 100 : sk.args[0])) E.setStatus(def, E.ST.FEAR, sk.args[1] || 1, events, foeSide); break; // 气绝冲/龙王灭碎阵: 害怕
        default: break;
      }
    });
  };

  // 变化技主体
  E.applyNonDamage = function (SKILLS, b, side, sk, events) {
    const att = side === "p" ? b.player : b.enemy;
    const def = side === "p" ? b.enemy : b.player;
    const foeSide = side === "p" ? "e" : "p";
    if (sk.se.length === 0) { events.push({ t: "msg", text: "但是什么也没发生…", side: side }); return; }
    // 命中判定(变化技)
    if (!(sk.acc >= 100) && !E.checkHit(att, def, sk)) { events.push({ t: "miss", side: foeSide }); return; }
    if (sk.se.some((s) => s === 4 || s === 5)) E.applyStageSEs(sk, att, def, side, foeSide, events, false);
    sk.se.forEach((se, i) => {
      const a = sk.args[i] == null ? 100 : sk.args[i];
      switch (se) {
        case 4: case 5: break; // 已处理
        case 10: if (Math.random() * 100 < a) E.setStatus(def, E.ST.PARA, 999, events, foeSide); break;
        case 11: if (Math.random() * 100 < a) E.setStatus(def, E.ST.POISON, 999, events, foeSide); break; // 毒粉
        case 13: if ((def.status[E.ST.LEECH] || 0) <= 0) { def.status[E.ST.LEECH] = sk.args[0] || 5; events.push({ t: "status", side: foeSide, status: E.ST.LEECH }); } break;
        case 16: if (Math.random() * 100 < a) E.setStatus(def, E.ST.SLEEP, 3, events, foeSide); break; // 催眠粉
        case 32: att.focus = true; events.push({ t: "msg", text: "聚精会神，暴击率提升了！", side: side }); break; // 蓄气
        case 41: b.watersport = sk.args[0] || 5; events.push({ t: "field", kind: "watersport", turns: b.watersport }); break;
        case 42: // 充电
          E.applyStage(att, 3, 1, events, side);
          att.charge = true;
          events.push({ t: "msg", text: "充满了电！下次电系招式威力翻倍！", side: side });
          break;
        case 43: { // 回复: maxHP/args[0]
          const denom = sk.args[0] || 2;
          const back = Math.max(1, Math.floor(att.pet.stats.maxhp / denom));
          att.pet.hp = Math.min(att.pet.stats.maxhp, att.pet.hp + back);
          events.push({ t: "heal", side: side, amount: back });
          break;
        }
        case 44: att.lightscreen = sk.args[0] || 5; events.push({ t: "field", kind: "lightscreen", side: side, turns: att.lightscreen }); break;
        case 45: events.push({ t: "msg", text: "模仿了对方的招式！(装饰效果)", side: side }); break;
        case 47: att.mist = sk.args[0] || 5; events.push({ t: "field", kind: "mist", side: side, turns: att.mist }); break;
        case 48: att.safeguard = sk.args[0] || 5; events.push({ t: "field", kind: "safeguard", side: side, turns: att.safeguard }); break;
        case 49: { // 寒冰护体: 回复一半
          const back = Math.max(1, Math.floor(att.pet.stats.maxhp / 2));
          att.pet.hp = Math.min(att.pet.stats.maxhp, att.pet.hp + back);
          events.push({ t: "heal", side: side, amount: back });
          break;
        }
        case 52: E.applyStage(def, 5, -(sk.args[0] || 1), events, foeSide); break; // 回避: 对方命中下降
        case 55: // 属性反转: 对方能力等级取反
          for (let _i = 0; _i < 6; _i++) def.stages[_i] = Math.max(-6, Math.min(6, -def.stages[_i]));
          events.push({ t: "msg", text: "对方的能力变化反转了！", side: foeSide });
          break;
        case 56: // 属性复制: 复制对方能力等级
          for (let _i2 = 0; _i2 < 6; _i2++) att.stages[_i2] = def.stages[_i2];
          events.push({ t: "msg", text: "复制了对方的能力变化！", side: side });
          break;
        case 59: E.setStatus(def, E.ST.CONFUSION, sk.args[1] || 3, events, foeSide); break; // 灵魂附体: 混乱
        case 63: // 镜影术: 镜影迷惑, 对方命中大降
          E.applyStage(def, 5, -2, events, foeSide);
          events.push({ t: "msg", text: "镜影迷惑了对方！", side: side });
          break;
        default: break;
      }
    });
  };

  // 先后手 (移植自 battle.go CompareSpeed)
  E.playerFirst = function (b, psk, esk) {
    const priOf = (s) => ((s && s.pri) || 0) + ((s && s.se && s.se.indexOf(40) >= 0) ? 1 : 0); // 夜袭 SE40: 先制
    const p1 = priOf(psk), p2 = priOf(esk);
    if (p1 !== p2) return p1 > p2;
    const s1 = E.effSpeed(b.player), s2 = E.effSpeed(b.enemy);
    if (s1 !== s2) return s1 > s2;
    return Math.random() < 0.5;
  };

  /* 完整一回合。playerSlot: 招式槽位(0-3); 若为 -1 表示本回合玩家不攻击(已使用道具/换宠/逃跑)。
     返回 {events, enemySlot} */
  E.execTurn = function (SKILLS, b, playerSlot) {
    const events = [];
    b.turn++;
    b.player.protect = false; b.enemy.protect = false;
    // 敌方 AI
    const foeMove = E.aiPick(SKILLS, b.enemy, b.player);
    const enemySlot = Math.max(0, b.enemy.moves.indexOf(foeMove));
    const psk = playerSlot >= 0 && b.player.moves[playerSlot] ? SKILLS[b.player.moves[playerSlot].id] : null;
    const esk = SKILLS[foeMove.id];

    // 持续伤害
    E.tickStatus(b, b.player, "p", events);
    E.tickStatus(b, b.enemy, "e", events);
    if (b.player.pet.hp <= 0) { events.push({ t: "ko", side: "p" }); b.over = true; b.winner = 2; return { events: events, enemySlot: enemySlot }; }
    if (b.enemy.pet.hp <= 0) { events.push({ t: "ko", side: "e" }); b.over = true; b.winner = 1; return { events: events, enemySlot: enemySlot }; }

    const pc = playerSlot < 0 ? { ok: false, reason: "skip" } : E.canAct(b.player);
    const ec = E.canAct(b.enemy);

    const doSide = (side, slot, can, first) => {
      if (b.over) return;
      const self = side === "p" ? b.player : b.enemy;
      const foe = side === "p" ? b.enemy : b.player;
      if (self.pet.hp <= 0 || foe.pet.hp <= 0) return;
      if (!can.ok) { events.push({ t: "cant", side: side, reason: can.reason }); return; }
      const sub = E.execAttack(SKILLS, b, side, slot, first);
      events.push.apply(events, sub);
      if (foe.pet.hp <= 0 && !b.over) { b.over = true; b.winner = side === "p" ? 1 : 2; }
      else if (self.pet.hp <= 0 && !b.over) { b.over = true; b.winner = side === "p" ? 2 : 1; }
    };

    if (playerSlot < 0) {
      doSide("e", enemySlot, ec, true);
    } else if (E.playerFirst(b, psk, esk)) {
      doSide("p", playerSlot, pc, true);
      doSide("e", enemySlot, ec, false);
    } else {
      doSide("e", enemySlot, ec, true);
      doSide("p", playerSlot, pc, false);
    }

    // 回合结束: 场效递减
    if (b.watersport > 0) b.watersport--;
    ["player", "enemy"].forEach((k) => {
      const m = b[k];
      if (m.lightscreen > 0) m.lightscreen--;
      if (m.mist > 0) m.mist--;
      if (m.safeguard > 0) m.safeguard--;
      m.dbond = false;
    });
    return { events: events, enemySlot: enemySlot };
  };

  // 经验/赛尔豆: 宝可梦式 YieldingExp 产量公式 + 原版等级修正思想(/5 手感更快)
  E.rewards = function (yieldExp, enemyLv, playerLv, bossMult) {
    const mod = Math.max(0.5, Math.min(2, 1 + (enemyLv - playerLv) * 0.1));
    const bm = bossMult || 1;
    return {
      exp: Math.max(1, Math.floor(((yieldExp * enemyLv) / 5) * mod * bm)),
      money: Math.floor(enemyLv * 10 * bm),
    };
  };

  // 捕捉判定 (宝可梦第三世代公式, CatchRate 即 0-255)
  E.catchCheck = function (rate, maxhp, hp, ballBonus, status) {
    rate = rate <= 0 ? 5 : rate;
    if (ballBonus >= 255) return { caught: true, shakes: 4 };
    let statusBonus = 1;
    if (status === E.ST.SLEEP || status === E.ST.FREEZE) statusBonus = 2;
    else if (status) statusBonus = 1.5;
    const a = (((3 * maxhp - 2 * hp) * rate * ballBonus) / (3 * maxhp)) * statusBonus;
    if (a >= 255) return { caught: true, shakes: 4 };
    const b = 1048560 / Math.sqrt(Math.sqrt(16711680 / Math.max(1, a)));
    let shakes = 0;
    for (let i = 0; i < 4; i++) {
      if (Math.random() * 65536 < b) shakes++;
      else break;
    }
    return { caught: shakes >= 4, shakes: shakes };
  };

  E.escapeChance = function (playerSpe, enemySpe, attempts) {
    if (playerSpe >= enemySpe) return Math.min(1, 0.9 + attempts * 0.05);
    return Math.min(0.95, 0.45 + attempts * 0.15);
  };

  if (typeof module !== "undefined" && module.exports) module.exports = E;
  else root.Engine = E;
})(typeof self !== "undefined" ? self : this);
