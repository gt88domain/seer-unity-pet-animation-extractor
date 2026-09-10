// Node 无头冒烟测试: stub DOM/Canvas, 跑完整游戏流程
import fs from "fs";
import vm from "vm";
import path from "path";

const ROOT = new URL("../game", import.meta.url).pathname;

// ---------- stub ----------
function makeCtx2D() {
  return new Proxy(
    { canvas: null, measureText: () => ({ width: 10 }), createLinearGradient: () => ({ addColorStop() {} }), getImageData: () => ({ data: [] }) },
    {
      get(t, k) {
        if (k in t) return t[k];
        return (...a) => undefined;
      },
      set(t, k, v) { t[k] = v; return true; },
    }
  );
}
function makeCanvas() {
  return {
    width: 300, height: 150, style: {},
    getContext: (type) => (type === "webgl" ? null : makeCtx2D()),
  };
}
class El {
  constructor(tag, id) {
    this.tagName = tag; this.id = id || "";
    this.children = []; this.style = {}; this.dataset = {};
    this._cls = new Set(); this._text = ""; this._html = "";
    this.onclick = null; this._listeners = {};
    const self = this;
    this.classList = {
      add: (...c) => c.forEach((x) => self._cls.add(x)),
      remove: (...c) => c.forEach((x) => self._cls.delete(x)),
      contains: (x) => self._cls.has(x),
      toggle: (x) => (self._cls.has(x) ? self._cls.delete(x) : self._cls.add(x)),
    };
  }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set innerText(v) { this._text = String(v); }
  get innerText() { return this._text; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }
  querySelector(sel) {
    this._qs = this._qs || {};
    if (!this._qs[sel]) this._qs[sel] = new El(sel, "");
    return this._qs[sel];
  }
  click() { if (this.onclick) this.onclick({ stopPropagation() {}, preventDefault() {} }); }
}
const reg = {};
const documentStub = {
  readyState: "complete",
  _listeners: {},
  getElementById: (id) => {
    if (!reg[id]) {
      reg[id] = id === "game" ? makeCanvas() : new El("div", id);
      if (/^(panelMask|dlgPanel|partyPanel|bagPanel|shopPanel|dexPanel|toast|titleScreen|starterScreen|mainScreen|battleLayer|battleMenu|skillMenu)$/.test(id))
        reg[id].classList.add("hidden");
    }
    return reg[id];
  },
  createElement: (tag) => (tag === "canvas" ? makeCanvas() : new El(tag)),
  addEventListener: (ev, fn) => {},
};
class ImageStub {
  constructor() { this._src = ""; this.complete = false; this.width = 64; this.height = 64; this.naturalWidth = 64; }
  set src(v) {
    this._src = v;
    setTimeout(() => {
      this.complete = true;
      if (String(v).includes("4913")) { if (this.onerror) this.onerror(); }
      else if (this.onload) this.onload();
    }, 0);
  }
  get src() { return this._src; }
}
const store = {};
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  Math, JSON, Object, Array, Number, String, Boolean, Error, Promise, Set, Map,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  document: documentStub,
  Image: ImageStub,
  fetch: (url) => {
    const f = path.join(ROOT, url);
    return Promise.resolve({
      ok: fs.existsSync(f),
      status: fs.existsSync(f) ? 200 : 404,
      json: () => Promise.resolve(JSON.parse(fs.readFileSync(f, "utf8"))),
    });
  },
};
sandbox.self = sandbox;
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ["engine.js", "audio.js", "sprites.js", "vfx.js", "meshplayer.js", "world.js", "battle.js", "ui.js", "main.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js", f), "utf8"), sandbox, { filename: f });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => documentStub.getElementById(id);
// 模拟主循环: 每 tick 推进 VFX + 渲染当前场景
let ctx2d = null;
function frame() {
  if (!ctx2d) ctx2d = $("game").getContext("2d");
  sandbox.VFX.update(0.05);
  if (sandbox.Battle.active) sandbox.Battle.draw(ctx2d, Date.now() / 1000, 0.05);
  else sandbox.World.draw(ctx2d, Date.now() / 1000);
}
async function driveBattle(maxIters) {
  let guard = 0;
  while (sandbox.Battle.active && guard++ < maxIters) {
    frame();
    sandbox.Battle.skipSay();
    if (sandbox.Battle.busy) { await sleep(120); continue; }
    if (!$("battleMenu")._cls.has("hidden")) {
      sandbox.Battle.onFight();
      await sleep(60);
      frame();
      const bs = $("skillMenu").children.filter((c) => c.textContent !== "← 返回");
      (bs[0] || $("skillMenu").children[0]).click();
    }
    await sleep(120);
  }
  return guard;
}

console.log("--- 等待 boot 完成 ---");
await sleep(1500);
console.log("PETS:", Object.keys(sandbox.PETS).length, "SKILLS:", Object.keys(sandbox.SKILLS).length, "MAPS:", sandbox.CFG.maps.length);

console.log("--- 新游戏 -> 选宠(布布种子) ---");
$("btnNew").click();
await sleep(200);
// starter 卡片点击第一张
const sc = $("starterList").children[0];
sc.click();
await sleep(200);
// 确认对话框: 点"确定"(第二个按钮)
const btns = $("dlgBtns").children;
console.log("confirm buttons:", btns.map((b) => b.textContent).join(","));
btns[btns.length - 1].click();
await sleep(300);
console.log("team:", sandbox.Game.team.map((p) => sandbox.PETS[p.id].name + "Lv" + p.lv).join(","));
console.log("bag:", JSON.stringify(sandbox.Game.bag), "money:", sandbox.Game.money);
// 关闭"博士寄语"对话框
{
  const db = $("dlgBtns").children;
  if (db.length) db[db.length - 1].click();
  await sleep(100);
}

console.log("--- 世界行走 60 tick ---");
const W = sandbox.World;
W.input.right = true;
for (let i = 0; i < 30; i++) { W.update(0.05); sandbox.VFX.update(0.05); }
W.input.right = false; W.input.up = true;
for (let i = 0; i < 30; i++) { W.update(0.05); sandbox.VFX.update(0.05); }
W.input.up = false;
console.log("pos:", W.tx, W.ty, "battleActive:", sandbox.Battle.active);

console.log("--- 世界渲染帧 ---");
W.draw($("game").getContext("2d"), 1.5);
console.log("world.draw OK");

if (!sandbox.Battle.active) {
  console.log("--- 强制野战: 皮皮Lv3 ---");
  sandbox.Game.startWild();
}
// 等开场
await sleep(2500);
console.log("battle active:", sandbox.Battle.active, "menu visible:", !$("battleMenu")._cls.has("hidden"));

console.log("--- 打一回合(第一招) ---");
sandbox.Battle.onFight();
await sleep(100);
const skBtns = $("skillMenu").children.filter((c) => c.textContent !== "← 返回");
console.log("skills:", $("skillMenu").children.length, "buttons");
skBtns[0].click();
// 等回合播完
await sleep(6000);
console.log("after turn: php=", sandbox.Battle.b.player.pet.hp, "ehp=", sandbox.Battle.b.enemy.pet.hp, "busy=", sandbox.Battle.busy);

// 打到结束
await driveBattle(400);
console.log("battle over. active=", sandbox.Battle.active, "team hp:", sandbox.Game.team.map((p) => p.hp).join(","));

console.log("--- 背包/队伍/图鉴面板 ---");
sandbox.UI.openParty(false); console.log("party rows:", $("partyList").children.length);
sandbox.UI.closePanels();
sandbox.UI.openBag(false); console.log("bag rendered");
sandbox.UI.closePanels();
sandbox.UI.openDex(); console.log("dex cells:", $("dexGrid").children.length);
sandbox.UI.closePanels();

console.log("--- Boss 战: 蘑菇怪 ---");
sandbox.Game.team[0].lv = 12;
sandbox.Game.team[0].stats = sandbox.Engine.calcStats(sandbox.PETS[1].base, 12, 31, 20);
sandbox.Game.team[0].hp = sandbox.Game.team[0].stats.maxhp;
sandbox.Game.startBoss();
await sleep(300);
{
  const bb = $("dlgBtns").children;
  if (bb.length) bb[bb.length - 1].click();
}
for (let i = 0; i < 25; i++) { frame(); await sleep(100); }
console.log("boss battle active:", sandbox.Battle.active, "foe:", sandbox.Battle.b.enemy.pet.id, "lv:", sandbox.Battle.b.enemy.pet.lv);
await driveBattle(500);
console.log("boss battle over. bosses:", JSON.stringify(sandbox.Game.bosses), "money:", sandbox.Game.money, "team size:", sandbox.Game.team.length);
sandbox.UI.closePanels();

console.log("--- 换地图/逃跑/捕捉/换宠/商店/进化 ---");
sandbox.World.cb.onExit(0);
console.log("mapIdx:", sandbox.Game.mapIdx, "map:", sandbox.CFG.maps[sandbox.Game.mapIdx].name);
// 逃跑测试
sandbox.Game.startWild();
for (let i = 0; i < 25; i++) { frame(); await sleep(100); }
sandbox.Battle.onRun();
for (let i = 0; i < 30; i++) { frame(); sandbox.Battle.skipSay(); await sleep(100); }
console.log("after run: active=", sandbox.Battle.active);
if (sandbox.Battle.active) await driveBattle(400);
// 捕捉测试: 扔球直到战斗结束
sandbox.Game.startWild();
for (let i = 0; i < 25; i++) { frame(); await sleep(100); }
console.log("catch foe:", sandbox.Battle.b.enemy.pet.id, "hp:", sandbox.Battle.b.enemy.pet.hp);
// 等待可行动(削弱几回合)
await driveBattle(40);
console.log("weakened foe hp:", sandbox.Battle.active ? sandbox.Battle.b.enemy.pet.hp : "battle-over");
if (sandbox.Battle.active) {
  // 等待菜单出现
  for (let i = 0; i < 100 && (sandbox.Battle.busy || $("battleMenu")._cls.has("hidden")); i++) { frame(); sandbox.Battle.skipSay(); await sleep(120); }
}
if (sandbox.Battle.active && !sandbox.Battle.busy) {
  console.log("throw ball1... foe hp:", sandbox.Battle.b.enemy.pet.hp, "/", sandbox.Battle.b.enemy.pet.stats.maxhp);
  sandbox.Battle.useItem("ball1");
  for (let i = 0; i < 80; i++) { frame(); sandbox.Battle.skipSay(); await sleep(100); if (!sandbox.Battle.active) break; }
  console.log("after ball1: active=", sandbox.Battle.active, "balls left=", sandbox.Game.bag.ball1);
}
// 大师球必中路径
if (sandbox.Battle.active) {
  for (let i = 0; i < 100 && (sandbox.Battle.busy || $("battleMenu")._cls.has("hidden")); i++) { frame(); sandbox.Battle.skipSay(); await sleep(120); }
  sandbox.Game.bag.master = 1;
  sandbox.Battle.useItem("master");
  for (let i = 0; i < 80; i++) { frame(); sandbox.Battle.skipSay(); await sleep(100); if (!sandbox.Battle.active) break; }
}
console.log("after catch: active=", sandbox.Battle.active, "team=", sandbox.Game.team.length, "box=", sandbox.Game.box.length);
if (sandbox.Battle.active) await driveBattle(400);
// 换宠测试
sandbox.Game.startWild();
for (let i = 0; i < 25; i++) { frame(); await sleep(100); }
if (sandbox.Game.team.length > 1 && sandbox.Game.team[1].hp > 0) {
  sandbox.Battle.switchTo(1, false);
  for (let i = 0; i < 40; i++) { frame(); sandbox.Battle.skipSay(); await sleep(100); }
  console.log("switched to:", sandbox.Battle.b.player.pet.id);
}
await driveBattle(400);
// 商店购买
sandbox.UI.openShop(["ball1", "potion2"], "test");
{
  const row = $("shopList").children[0];
  const before = sandbox.Game.money;
  row.querySelector("button").click();
  console.log("shop buy: money", before, "->", sandbox.Game.money, "ball1:", sandbox.Game.bag.ball1);
}
sandbox.UI.closePanels();
// 战外用药
{
  sandbox.Game.team[0].hp = 5;
  sandbox.Game.useItemOutside("potion1");
  const rows = $("partyList").children;
  rows[0].click();
  await sleep(200);
  console.log("potion outside: hp=", sandbox.Game.team[0].hp);
  sandbox.UI.closePanels();
}
// 进化
{
  const pet = sandbox.Game.team[0];
  pet.lv = 18;
  const evo = sandbox.Engine.checkEvolve(sandbox.PETS, pet);
  console.log("evolve check at 18:", evo);
  if (evo) { sandbox.Engine.doEvolve(sandbox.PETS, sandbox.SKILLS, pet, evo); console.log("evolved to:", pet.id, sandbox.PETS[pet.id].name); }
}

console.log("--- 存档/读档 ---");
sandbox.Game.save();
console.log("saved bytes:", (store["seer_legends_save_v1"] || "").length);
const pos = sandbox.Game.loadSave();
console.log("loaded pos:", JSON.stringify(pos), "team:", sandbox.Game.team.length);

console.log("ALL SMOKE OK");
process.exit(0);
