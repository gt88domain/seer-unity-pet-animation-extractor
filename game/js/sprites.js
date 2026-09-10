/* ============================================================
 * sprites.js — 图片资源加载 / 缓存 / 占位回退
 * ============================================================ */
(function (root) {
  "use strict";
  const S = { cache: {}, failed: {} };

  function placeholder(kind, key) {
    const c = document.createElement("canvas");
    c.width = kind === "head" ? 64 : kind === "type" ? 40 : 160;
    c.height = kind === "body" ? 200 : kind === "type" ? 40 : 64;
    const g = c.getContext("2d");
    g.fillStyle = "#2a2a35";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#8f8fa3";
    g.font = "bold 28px sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("?", c.width / 2, c.height / 2);
    const img = new Image();
    img.src = c.toDataURL();
    return img;
  }

  S.url = function (kind, key) {
    if (kind === "body") return "assets/pets/body/" + key + ".png";
    if (kind === "head") return "assets/pets/head/" + key + ".png";
    if (kind === "type") return "assets/types/" + key + ".png";
    return "";
  };
  // 同步取(可能尚未加载完, 用 complete 判断)
  S.get = function (kind, key) {
    const k = kind + ":" + key;
    if (S.cache[k]) return S.cache[k];
    if (S.failed[k]) return S.failed[k];
    const img = new Image();
    const ph = placeholder(kind, key);
    S.failed[k] = ph;
    img.onload = () => { S.cache[k] = img; };
    img.onerror = () => { S.cache[k] = ph; };
    img.src = S.url(kind, key);
    S.cache[k] = img.complete && img.naturalWidth ? img : ph;
    // 若还没加载好先给占位, 加载完自动替换缓存
    if (!img.complete) S.cache[k] = ph;
    return S.cache[k];
  };
  // 预加载一批, onProgress(loaded, total)
  S.preload = function (list, onProgress) {
    return new Promise((resolve) => {
      let done = 0;
      const total = list.length;
      if (!total) { resolve(); return; }
      list.forEach(([kind, key]) => {
        const k = kind + ":" + key;
        if (S.cache[k] && S.cache[k].complete !== false) { step(); return; }
        const img = new Image();
        img.onload = () => { S.cache[k] = img; step(); };
        img.onerror = () => { const ph = placeholder(kind, key); S.cache[k] = ph; S.failed[k] = ph; step(); };
        img.src = S.url(kind, key);
      });
      function step() {
        done++;
        if (onProgress) onProgress(done, total);
        if (done >= total) resolve();
      }
    });
  };
  // 按高度等比绘制(居中锚点: bottom-center)
  S.drawFitH = function (g, img, cx, bottomY, h, flip) {
    if (!img || !img.width) return;
    const w = (img.width / img.height) * h;
    g.save();
    g.translate(cx, bottomY);
    if (flip) g.scale(-1, 1);
    g.drawImage(img, -w / 2, -h, w, h);
    g.restore();
  };

  root.Sprites = S;
})(typeof self !== "undefined" ? self : this);
