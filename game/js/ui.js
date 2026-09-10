/* ============================================================
 * ui.js — 标题/选宠/HUD/队伍/背包/商店/图鉴/对话 面板
 * ============================================================ */
(function (root) {
  "use strict";
  const UI = { partyCb: null, partyForced: false, bagCb: null, bagInBattle: false };
  const $ = (id) => document.getElementById(id);
  const E = () => root.Engine;

  UI.toast = function (text, ms) {
    const t = $("toast");
    t.textContent = text;
    t.classList.remove("hidden");
    clearTimeout(UI._toastT);
    UI._toastT = setTimeout(() => t.classList.add("hidden"), ms || 2200);
  };

  UI.dialog = function (title, html, buttons) {
    $("dlgTitle").textContent = title;
    $("dlgBody").innerHTML = html;
    const bar = $("dlgBtns");
    bar.innerHTML = "";
    (buttons || [{ text: "确定", cb: () => UI.closePanels() }]).forEach((b) => {
      const btn = document.createElement("button");
      btn.className = "btn" + (b.primary ? " primary" : "");
      btn.textContent = b.text;
      btn.onclick = () => { root.AudioSys.play("select"); if (b.cb) b.cb(); };
      bar.appendChild(btn);
    });
    UI._show("dlgPanel");
  };
  UI.talk = function (text) {
    UI.dialog("对话", "<p class='talk-text'>" + text + "</p>");
  };
  UI.confirm = function (title, text, onYes) {
    UI.dialog(title, "<p class='talk-text'>" + text + "</p>", [
      { text: "取消", cb: () => UI.closePanels() },
      { text: "确定", primary: true, cb: () => { UI.closePanels(); onYes(); } },
    ]);
  };

  UI._show = function (id) {
    ["dlgPanel", "partyPanel", "bagPanel", "shopPanel", "dexPanel"].forEach((p) => $(p).classList.add("hidden"));
    $(id).classList.remove("hidden");
    $("panelMask").classList.remove("hidden");
  };
  UI.closePanels = function () {
    ["dlgPanel", "partyPanel", "bagPanel", "shopPanel", "dexPanel"].forEach((p) => $(p).classList.add("hidden"));
    $("panelMask").classList.add("hidden");
    UI.partyCb = null; UI.bagCb = null;
  };
  UI.anyOpen = function () { return !$("panelMask").classList.contains("hidden"); };

  function typeBadge(t) {
    const info = (root.CFG.types[t] || { name: "?", color: "#999" });
    return "<span class='type-badge' style='background:" + info.color + "'>" + info.name + "</span>";
  }
  UI.typeBadge = typeBadge;

  // ---------------- 队伍 ----------------
  // inBattle: 选择模式(回调 index); forced: 必选(不可取消, 首发倒下)
  UI.openParty = function (inBattle, cb, forced) {
    UI.partyCb = cb || null;
    UI.partyForced = !!forced;
    UI.bagInBattle = !!inBattle;
    const G = root.Game;
    const list = $("partyList");
    list.innerHTML = "";
    G.team.forEach((pet, i) => {
      const def = root.PETS[pet.id];
      const div = document.createElement("div");
      div.className = "member" + (pet.hp <= 0 ? " fainted" : "") + (i === 0 ? " lead" : "");
      const r = Math.max(0, pet.hp / pet.stats.maxhp);
      div.innerHTML =
        "<img class='head' src='" + root.Sprites.url("head", pet.id) + "'/>" +
        "<div class='m-info'><div class='m-name'>" + (i === 0 ? "★ " : "") + def.name +
        " <span class='m-lv'>Lv" + pet.lv + "</span></div>" +
        "<div class='hp-mini'><div class='hp-fill" + (r < 0.2 ? " low" : r < 0.5 ? " mid" : "") + "' style='width:" + (r * 100) + "%'></div></div>" +
        "<div class='m-hp'>" + pet.hp + "/" + pet.stats.maxhp + "</div></div>";
      div.onclick = () => {
        root.AudioSys.play("click");
        if (UI.partyCb) {
          if (!UI._itemMode) {
            if (pet.hp <= 0) { UI.toast("这只精灵已经倒下了！"); return; }
            if (!forced && root.Battle.b && pet.uid === root.Battle.b.player.pet.uid) { UI.toast("已经在场上了！"); return; }
          }
          const cb = UI.partyCb;
          UI.closePanels();
          cb(i);
        } else {
          UI.petDetail(i);
        }
      };
      list.appendChild(div);
    });
    // 电脑(非战斗中可存取)
    if (!inBattle && G.box.length) {
      const sep = document.createElement("div");
      sep.className = "box-sep";
      sep.textContent = "—— 电脑 ——";
      list.appendChild(sep);
      G.box.forEach((pet, bi) => {
        const def = root.PETS[pet.id];
        const div = document.createElement("div");
        div.className = "member box";
        const r = Math.max(0, pet.hp / pet.stats.maxhp);
        div.innerHTML =
          "<img class='head' src='" + root.Sprites.url("head", pet.id) + "'/>" +
          "<div class='m-info'><div class='m-name'>" + def.name +
          " <span class='m-lv'>Lv" + pet.lv + "</span></div>" +
          "<div class='hp-mini'><div class='hp-fill" + (r < 0.2 ? " low" : r < 0.5 ? " mid" : "") + "' style='width:" + (r * 100) + "%'></div></div></div>";
        div.onclick = () => {
          root.AudioSys.play("select");
          if (G.team.length >= root.CFG.teamSize) { UI.toast("队伍已满(6只)，先把某只存入电脑！"); return; }
          G.box.splice(bi, 1);
          G.team.push(pet);
          G.save();
          UI.toast(def.name + "加入了队伍！");
          UI.openParty(false);
        };
        list.appendChild(div);
      });
    }
    $("partyClose").style.display = forced ? "none" : "";
    UI._show("partyPanel");
  };

  UI.petDetail = function (i) {
    const G = root.Game;
    const pet = G.team[i];
    const def = root.PETS[pet.id];
    const S = root.SKILLS;
    const moves = pet.moves.map((m) => {
      const sk = S[m.id] || {};
      const cat = sk.cat === 1 ? "物" : sk.cat === 2 ? "特" : "变";
      return "<div class='move-row'>" + typeBadge(sk.type) +
        "<span class='mv-name'>" + (sk.name || "?") + "</span>" +
        "<span class='mv-cat'>" + cat + "</span>" +
        "<span class='mv-pow'>" + (sk.power || "-") + "</span>" +
        "<span class='mv-pp'>PP" + m.pp + "/" + (sk.pp || "-") + "</span></div>";
    }).join("");
    const need = E().expNeed(def.growth, pet.lv);
    const evo = def.evoTo ? "<p>进化：Lv" + def.evoLv + " → " + ((root.PETS[def.evoTo] || {}).name || "?") + "</p>" : "<p>已是最终形态</p>";
    const stats = [["体力", pet.stats.maxhp], ["攻击", pet.stats.atk], ["防御", pet.stats.def], ["特攻", pet.stats.spa], ["特防", pet.stats.spd], ["速度", pet.stats.spe]]
      .map(([k, v]) => "<div class='stat-row'><span>" + k + "</span><b>" + v + "</b></div>").join("");
    const btns = [
      { text: "返回", cb: () => UI.openParty(false) },
      { text: "设为首发", primary: true, cb: () => { G.team.splice(i, 1); G.team.unshift(pet); G.save(); UI.openParty(false); } },
    ];
    if (G.team.length > 1) {
      btns.push({
        text: "存入电脑", cb: () => {
          G.team.splice(i, 1); G.box.push(pet); G.save();
          UI.toast(def.name + "已存入电脑。");
          UI.openParty(false);
        },
      });
    }
    UI.dialog(def.name + " Lv" + pet.lv,
      "<div class='detail'>" +
      "<img class='detail-img' src='" + root.Sprites.url("body", pet.id) + "'/>" +
      "<div class='detail-types'>" + typeBadge(def.type) + (def.type2 ? typeBadge(def.type2) : "") + "</div>" +
      "<div class='stat-grid'>" + stats + "</div>" +
      "<p>经验：" + pet.exp + " / " + need + "</p>" + evo +
      "<div class='move-list'>" + moves + "</div></div>",
      btns);
  };

  // ---------------- 背包 ----------------
  UI.openBag = function (inBattle, cb) {
    UI.bagCb = cb || null;
    UI.bagInBattle = !!inBattle;
    UI._itemMode = null;
    const G = root.Game;
    const list = $("bagList");
    list.innerHTML = "";
    const order = ["ball1", "ball2", "ball3", "master", "potion1", "potion2", "potion3", "revive", "antidote", "ppup"];
    let empty = true;
    order.forEach((id) => {
      const n = G.bag[id] || 0;
      if (n <= 0) return;
      empty = false;
      const def = root.CFG.items[id];
      const div = document.createElement("div");
      div.className = "item-row";
      div.innerHTML = UI.itemIcon(id) +
        "<div class='it-info'><div class='it-name'>" + def.name + " ×" + n + "</div>" +
        "<div class='it-desc'>" + def.desc + "</div></div>" +
        "<button class='btn small'>使用</button>";
      div.querySelector("button").onclick = (ev) => {
        ev.stopPropagation();
        root.AudioSys.play("select");
        if (UI.bagCb) { const cb = UI.bagCb; UI.closePanels(); cb(id); }
        else G.useItemOutside(id);
      };
      list.appendChild(div);
    });
    if (empty) list.innerHTML = "<p class='empty'>背包空空如也，去商店看看吧。</p>";
    $("bagMoney").textContent = "赛尔豆：" + G.money;
    UI._show("bagPanel");
  };

  UI.itemIcon = function (id) {
    const ballCols = { ball1: "#e53935", ball2: "#1e88e5", ball3: "#f9a825", master: "#6a1fb5" };
    if (ballCols[id]) {
      return "<span class='ball-icon' style='--c:" + ballCols[id] + "'></span>";
    }
    const icons = { potion1: "🧪", potion2: "⚗️", potion3: "💊", revive: "💖", antidote: "🌿", ppup: "🔋" };
    return "<span class='item-emoji'>" + (icons[id] || "🎒") + "</span>";
  };

  // ---------------- 商店 ----------------
  UI.openShop = function (stock, greet) {
    const G = root.Game;
    const list = $("shopList");
    const render = () => {
      list.innerHTML = "";
      stock.forEach((id) => {
        const def = root.CFG.items[id];
        const div = document.createElement("div");
        div.className = "item-row";
        div.innerHTML = UI.itemIcon(id) +
          "<div class='it-info'><div class='it-name'>" + def.name + "</div>" +
          "<div class='it-desc'>" + def.desc + "</div></div>" +
          "<div class='buy-col'><span class='price'>" + def.price + " 🪙</span>" +
          "<button class='btn small primary'>购买</button></div>";
        div.querySelector("button").onclick = () => {
          if (G.money < def.price) { UI.toast("赛尔豆不足！"); root.AudioSys.play("back"); return; }
          G.money -= def.price;
          G.bag[id] = (G.bag[id] || 0) + 1;
          G.save();
          root.AudioSys.play("coin");
          $("shopMoney").textContent = "赛尔豆：" + G.money;
          $("hudMoney").textContent = "🪙 " + G.money;
          UI.toast("购买了" + def.name + "！");
        };
        list.appendChild(div);
      });
    };
    render();
    $("shopMoney").textContent = "赛尔豆：" + G.money;
    $("shopGreet").textContent = greet || "欢迎光临！";
    UI._show("shopPanel");
  };

  // ---------------- 图鉴 ----------------
  UI.openDex = function () {
    const G = root.Game;
    const grid = $("dexGrid");
    grid.innerHTML = "";
    const ids = Object.keys(root.PETS).map(Number).sort((a, b) => a - b);
    let caught = 0;
    ids.forEach((id) => {
      const d = G.dex[id];
      const def = root.PETS[id];
      if (d && d.caught) caught++;
      const div = document.createElement("div");
      div.className = "dex-cell" + (d ? "" : " unseen") + (d && d.caught ? " caught" : "");
      div.innerHTML = "<img src='" + root.Sprites.url("head", id) + "'/>" +
        "<span>No." + id + "<br/>" + (d ? def.name : "？？？") + "</span>";
      if (d) div.onclick = () => { root.AudioSys.play("click"); UI.dexDetail(id); };
      grid.appendChild(div);
    });
    $("dexCount").textContent = "已收服：" + caught + " / " + ids.length;
    UI._show("dexPanel");
  };
  UI.dexDetail = function (id) {
    const def = root.PETS[id];
    const base = def.base;
    const stats = [["体力", base[0]], ["攻击", base[1]], ["防御", base[2]], ["特攻", base[3]], ["特防", base[4]], ["速度", base[5]]]
      .map(([k, v]) => "<div class='stat-row'><span>" + k + "</span><b>" + v + "</b></div>").join("");
    let evo = "最终形态";
    if (def.evoFrom) evo = ((root.PETS[def.evoFrom] || {}).name || "?") + " → " + def.name;
    if (def.evoTo) evo += " → " + ((root.PETS[def.evoTo] || {}).name || "?") + "(Lv" + def.evoLv + ")";
    UI.dialog("No." + id + " " + def.name,
      "<div class='detail'><img class='detail-img' src='" + root.Sprites.url("body", id) + "'/>" +
      "<div class='detail-types'>" + typeBadge(def.type) + (def.type2 ? typeBadge(def.type2) : "") + "</div>" +
      "<div class='stat-grid'>" + stats + "</div><p>" + evo + "</p></div>",
      [{ text: "返回图鉴", primary: true, cb: () => UI.openDex() }]);
  };

  // ---------------- 标题 / 选宠 ----------------
  UI.showTitle = function (hasSave) {
    $("titleScreen").classList.remove("hidden");
    $("btnContinue").style.display = hasSave ? "" : "none";
  };
  UI.hideTitle = function () { $("titleScreen").classList.add("hidden"); };

  UI.showStarter = function (cb) {
    const wrap = $("starterList");
    wrap.innerHTML = "";
    root.CFG.starters.forEach((id) => {
      const def = root.PETS[id];
      const card = document.createElement("div");
      card.className = "starter-card t" + def.type;
      card.innerHTML = "<img src='" + root.Sprites.url("body", id) + "'/>" +
        "<h3>" + def.name + "</h3>" +
        "<div>" + typeBadge(def.type) + "</div>" +
        "<p>No." + id + " · " + ["体", "攻", "防", "特攻", "特防", "速"].map((k, i) => k + def.base[i]).join(" ") + "</p>";
      card.onclick = () => {
        root.AudioSys.play("select");
        [...wrap.children].forEach((c) => c.classList.remove("picked"));
        card.classList.add("picked");
        UI.confirm("选择初始精灵", "和 <b>" + def.name + "</b> 一起踏上冒险吗？", () => {
          $("starterScreen").classList.add("hidden");
          cb(id);
        });
      };
      wrap.appendChild(card);
    });
    $("starterScreen").classList.remove("hidden");
  };

  root.UI = UI;
})(typeof self !== "undefined" ? self : this);
