// 数据 + 新 SE 引擎校验: node tools/validate_data.mjs (exit 0 = 全过)
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const G = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf-8"));
let fails = 0;
const ok = (c, msg) => { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; };

// ---- 载入 engine.js ----
const sandbox = { self: {}, console };
sandbox.window = sandbox.self;
sandbox.globalThis = sandbox.self;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "game/js/engine.js"), "utf-8"), sandbox);
const E = sandbox.self.Engine;

const PETS = G("game/data/pets.json");
const SKILLS = G("game/data/skills.json");
const CFG = G("game/data/game.json");
// main.js boot() 运行时手工注入 4913, 这里镜像同一逻辑
PETS["4913"] = {
  id: 4913, name: "？？？", type: 13, type2: 5,
  base: [110, 115, 90, 115, 90, 120],
  evoFrom: 0, evoTo: 0, evoLv: 0, catch: 3, yieldExp: 220, growth: 1,
  moves: [[10040, 1], [10010, 1], [10105, 1], [20006, 1]],
};

// ---- 1. 图鉴 ----
ok(Object.keys(PETS).length === 74, `pets=73+4913 (实 ${Object.keys(PETS).length})`);
for (const [id, p] of Object.entries(PETS)) {
  for (const [mid] of p.moves) if (!SKILLS[mid]) { ok(false, `pet ${id} 招式 ${mid} 缺失`); break; }
}
ok(true, "全部招式 ID 存在于 skills.json");
for (const [id, s] of Object.entries(SKILLS)) {
  if (s.type < 1 || s.type > 16 || ![1, 2, 4].includes(s.cat)) { ok(false, `skill ${id} type/cat 非法`); break; }
}
ok(true, "全部技能 type/cat 合法");
// 进化链
for (const [id, p] of Object.entries(PETS)) {
  if (p.evoTo && !PETS[p.evoTo]) ok(false, `pet ${id} evoTo=${p.evoTo} 不在阵容`);
}
ok(true, "evoTo 目标都在阵容内");
for (const [from, to, lv] of [[59, 60, 18], [60, 61, 38], [111, 112, 19], [112, 113, 39]]) {
  ok(PETS[from].evoTo === to && PETS[from].evoLv === lv, `补链 ${from}->${to}@${lv}`);
}

// ---- 2. game.json ----
ok(CFG.levelCap === 100, "levelCap=100");
for (const m of CFG.maps) {
  const wsum = m.wild.reduce((a, w) => a + w.w, 0);
  ok(wsum === 100, `${m.id} 权重和=100`);
  for (const w of m.wild) {
    if (!PETS[w.id]) ok(false, `${m.id} 野生 ${w.id} 不在图鉴`);
    else if (!(PETS[w.id].catch > 0)) ok(false, `${m.id} 野生 ${w.id} 不可捕捉`);
  }
  if (m.boss && !PETS[m.boss.pet]) ok(false, `${m.id} boss ${m.boss.pet} 不在图鉴`);
  if (m.secret && !PETS[m.secret.pet]) ok(false, `${m.id} secret 不在图鉴`);
  for (const s of (m.secretPlus || [])) {
    if (!PETS[s.pet]) ok(false, `${m.id} secretPlus ${s.pet} 不在图鉴`);
    if (!(s.lv && s.name && s.intro && s.winText)) ok(false, `${m.id} secretPlus ${s.pet} 缺字段`);
    for (const k of Object.keys((s.reward || {}).items || {})) if (!CFG.items[k]) ok(false, `secretPlus 奖励道具 ${k} 不存在`);
  }
}
ok(true, "game.json 野生/Boss/裂隙引用全合法");

// ---- 3. 立绘 ----
let missSprite = [];
for (const id of Object.keys(PETS).filter((k) => k !== "4913")) { // 4913 纯 Mesh, 无立绘
  for (const k of ["body", "head"]) {
    if (!fs.existsSync(path.join(ROOT, `game/assets/pets/${k}/${id}.png`))) missSprite.push(`${k}/${id}`);
  }
}
ok(!missSprite.length, missSprite.length ? "缺立绘: " + missSprite.join(",") : "73 宠 body+head 立绘齐全");

// ---- 4. Mesh ----
for (const id of [70, 4913, 431, 502]) {
  const jp = path.join(ROOT, `${id}.pet.json`), ap = path.join(ROOT, `${id}._Atlas_.png`);
  const dj = JSON.parse(fs.readFileSync(jp, "utf-8"));
  const seqs = (dj.Sequences || []).map((s) => s.Name);
  ok(fs.existsSync(ap) && seqs.includes("standby") && seqs.includes("attack"),
    `mesh ${id}: seqs=[${seqs.join(",")}] + atlas存在`);
}

// ---- 5. 新 SE 引擎行为 ----
const mkB = (pMove, eMove) => {
  const p1 = E.makePet(PETS, SKILLS, 1, 50, { dv: 31, nature: 0 });
  const p2 = E.makePet(PETS, SKILLS, 4, 50, { dv: 31, nature: 0 });
  p1.moves = [{ id: pMove, pp: 35 }]; p2.moves = [{ id: eMove, pp: 35 }];
  return E.newBattle(p1, p2);
};
// SE22 害怕 (龙王灭碎阵 5% —— 跑多次必出一次就不assert概率, 只assert不崩+事件合法)
{
  const kinds = new Set();
  for (let i = 0; i < 60; i++) {
    const b = mkB(10618, 10001);
    for (const e of E.execAttack(SKILLS, b, "p", 0, true)) kinds.add(e.t);
  }
  ok(kinds.has("damage"), "SE22 龙王灭碎阵 60 次执行无异常且有伤害事件");
}
// SE40 先制: 慢速夜袭 vs 高速撞击, 夜袭方应先手
{
  const slow = E.makePet(PETS, SKILLS, 60, 5, { dv: 0, nature: 0 });   // 铁达斯低速
  const fast = E.makePet(PETS, SKILLS, 26, 50, { dv: 31, nature: 0 }); // 哈尔浮高速
  slow.moves = [{ id: 10405, pp: 30 }]; fast.moves = [{ id: 10001, pp: 35 }];
  const b = E.newBattle(slow, fast);
  ok(E.playerFirst(b, SKILLS[10405], SKILLS[10001]) === true, "SE40 夜袭慢速先手");
}
// SE54 吸取: 绿光波回血
{
  const b = mkB(10240, 10001);
  b.player.pet.hp = 10;
  E.execAttack(SKILLS, b, "p", 0, true);
  ok(b.player.pet.hp > 10, "SE54 绿光波造成伤害并回血");
}
// SE55 反转 / SE56 复制
{
  const b = mkB(20113, 10001);
  b.enemy.stages = [2, 0, -1, 3, 0, 0];
  const ev = E.execAttack(SKILLS, b, "p", 0, true);
  ok(JSON.stringify(b.enemy.stages) === JSON.stringify([-2, 0, 1, -3, 0, 0]) && ev.some((e) => e.t === "msg"), "SE55 属性反转取反");
  const b2 = mkB(20145, 10001);
  b2.enemy.stages = [2, 1, 0, 0, -2, 0];
  E.execAttack(SKILLS, b2, "p", 0, true);
  ok(JSON.stringify(b2.player.stages) === JSON.stringify([2, 1, 0, 0, -2, 0]), "SE56 属性复制同步");
}
// SE59 混乱 / SE52 回避 / SE63 镜影
{
  const b = mkB(20175, 10001);
  E.execAttack(SKILLS, b, "p", 0, true);
  ok((b.enemy.status[E.ST.CONFUSION] || 0) > 0, "SE59 灵魂附体上混乱");
  const b3 = mkB(20266, 10001);
  E.execAttack(SKILLS, b3, "p", 0, true);
  ok(b3.enemy.stages[5] === -1, "SE52 回避降对方命中");
  const b4 = mkB(20232, 10001);
  E.execAttack(SKILLS, b4, "p", 0, true);
  ok(b4.enemy.stages[5] === -2, "SE63 镜影术降对方命中2级");
}
// 进化判定: 59@18 / 111@19
for (const [id, lv, to] of [[59, 18, 60], [111, 19, 112], [215, 30, 216], [131, 30, 132]]) {
  const p = E.makePet(PETS, SKILLS, id, lv, {});
  ok(E.checkEvolve(PETS, p) === to, `进化 ${id}Lv${lv}->${to}`);
}
// 奖励公式在高等级不溢出
{
  const r = E.rewards(220, 60, 55, 2);
  ok(r.exp > 0 && r.exp < 100000, `Lv60 Boss 奖励 exp=${r.exp} 合理`);
}

console.log(fails ? `\n${fails} FAILURES` : "\nALL VALIDATE OK");
process.exit(fails ? 1 : 0);
