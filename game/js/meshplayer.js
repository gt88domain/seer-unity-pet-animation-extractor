/* ============================================================
 * meshplayer.js — Unity Mesh 动画 WebGL 播放器
 * 由根目录 index.html 播放器改写: 封装为可复用类, 按序列懒解析,
 * 渲染到自有透明画布, 由战斗场景每帧 drawImage 合成。
 * ============================================================ */
(function (root) {
  "use strict";

  function decodeUV(v) {
    return [((v >>> 16) & 0xffff) / 65536, (v & 0xffff) / 65536];
  }

  const VS = [
    "attribute vec2 a_position;attribute vec2 a_texCoord;varying vec2 v_texCoord;",
    "uniform vec2 u_resolution;uniform vec2 u_offset;uniform float u_scale;",
    // 与 index.py 的 to_screen 等价: x=off.x+x*s, y=off.y-y*s (Unity Y-up -> 画布 Y-down)
    "void main(){vec2 sp=vec2(u_offset.x+a_position.x*u_scale,u_offset.y-a_position.y*u_scale);",
    "vec2 cs=((sp/u_resolution)*2.0)-1.0;",
    "gl_Position=vec4(cs.x,-cs.y,0,1);v_texCoord=a_texCoord;}",
  ].join("\n");
  const FS = [
    "precision mediump float;varying vec2 v_texCoord;uniform sampler2D u_image;",
    "void main(){vec4 c=texture2D(u_image,v_texCoord);",
    "if(c.a<0.01) discard;gl_FragColor=c;}",
  ].join("\n");

  function MeshPet(canvas) {
    this.cv = canvas;
    this.gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false });
    if (!this.gl) throw new Error("WebGL unavailable");
    this.data = null;
    this.fps = 24;
    this.seqCache = {};   // name -> {frames:[{pos,uv,n}], bounds}
    this.seqName = "";
    this.frames = [];
    this.idx = 0;
    this.lastT = 0;
    this.once = false;
    this.onDone = null;
    this.targetH = 220;
    this.ready = false;
    this._initGL();
  }

  MeshPet.prototype._initGL = function () {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(s));
      return s;
    };
    const pr = gl.createProgram();
    gl.attachShader(pr, mk(gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(pr));
    this.pr = pr;
    this.aPos = gl.getAttribLocation(pr, "a_position");
    this.aUV = gl.getAttribLocation(pr, "a_texCoord");
    this.uRes = gl.getUniformLocation(pr, "u_resolution");
    this.uOff = gl.getUniformLocation(pr, "u_offset");
    this.uScale = gl.getUniformLocation(pr, "u_scale");
    this.uImg = gl.getUniformLocation(pr, "u_image");
    this.bufPos = gl.createBuffer();
    this.bufUV = gl.createBuffer();
    this.tex = gl.createTexture();
  };

  MeshPet.prototype.load = function (jsonUrl, atlasUrl) {
    const self = this;
    return fetch(jsonUrl).then((r) => {
      if (!r.ok) throw new Error("mesh json " + r.status);
      return r.json();
    }).then((data) => {
      self.data = data;
      self.fps = data.FrameRate || 24;
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = atlasUrl;
      });
    }).then((img) => {
      const gl = self.gl;
      gl.bindTexture(gl.TEXTURE_2D, self.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      self.ready = true;
      const first = (self.data.Sequences[0] || {}).Name || "standby";
      self.play(first);
    });
  };

  MeshPet.prototype._parse = function (name) {
    if (this.seqCache[name]) return this.seqCache[name];
    const seq = (this.data.Sequences || []).find((s) => s.Name === name);
    if (!seq) return null;
    const frames = seq.Frames.map((fd) => {
      const vs = fd.MeshData.Vertices, uvs = fd.MeshData.UVs;
      const pos = [], uv = [];
      const qc = Math.floor(vs.length / 4);
      for (let qi = 0; qi < qc; qi++) {
        const vi = qi * 4;
        if (vi + 3 >= vs.length) break;
        const q = [vs[vi], vs[vi + 1], vs[vi + 2], vs[vi + 3]];
        const ui = qi * 2;
        if (ui + 1 >= uvs.length) continue;
        const uv1 = decodeUV(uvs[ui]), uv2 = decodeUV(uvs[ui + 1]);
        const uMin = Math.min(uv1[0], uv2[0]), uMax = Math.max(uv1[0], uv2[0]);
        const vMin = Math.min(uv1[1], uv2[1]), vMax = Math.max(uv1[1], uv2[1]);
        const idx = [0, 1, 2, 0, 2, 3];
        for (const k of idx) {
          pos.push(q[k].x, q[k].y);
          uv.push(k === 1 || k === 2 ? uMax : uMin, 1 - (k === 2 || k === 3 ? vMax : vMin));
        }
      }
      return { pos: new Float32Array(pos), uv: new Float32Array(uv), n: pos.length / 2 };
    });
    // 包围盒
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    seq.Frames.forEach((fd) => fd.MeshData.Vertices.forEach((v) => {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }));
    const entry = { frames: frames, minX: minX, maxX: maxX, minY: minY, maxY: maxY };
    // 只保留最近 2 个序列, 控制内存
    const keys = Object.keys(this.seqCache);
    if (keys.length >= 2) delete this.seqCache[keys[0]];
    this.seqCache[name] = entry;
    return entry;
  };

  MeshPet.prototype.setHeight = function (h) {
    this.targetH = h;
    if (this.seqName) this._fit(this.seqName);
  };

  MeshPet.prototype._fit = function (name) {
    const e = this.seqCache[name];
    if (!e) return;
    const pad = 6;
    const mw = (e.maxX - e.minX) || 1, mh = (e.maxY - e.minY) || 1;
    const scale = (this.targetH - pad * 2) / mh;
    const w = Math.max(2, Math.ceil(mw * scale) + pad * 2);
    const h = Math.max(2, Math.ceil(mh * scale) + pad * 2);
    this.cv.width = w; this.cv.height = h;
    this.gl.viewport(0, 0, w, h);
    this._off = [pad - e.minX * scale, pad + e.maxY * scale];
    this._size = [w, h];
    this._scale = scale;
  };

  MeshPet.prototype.has = function (name) {
    return !!((this.data && this.data.Sequences || []).find((s) => s.Name === name));
  };
  MeshPet.prototype.play = function (name, opts) {
    opts = opts || {};
    if (!this.has(name)) name = "standby";
    if (!this.has(name)) return;
    this._parse(name);
    this.seqName = name;
    this.frames = this.seqCache[name].frames;
    this.idx = 0;
    this.once = !!opts.once;
    this.onDone = opts.onDone || null;
    this._fit(name);
  };
  MeshPet.prototype.playOnce = function (name, fallback) {
    const self = this;
    if (!this.has(name)) { if (fallback) self.play(fallback); return; }
    this.play(name, {
      once: true,
      onDone: function () { self.play(fallback || "standby"); },
    });
  };

  MeshPet.prototype.draw = function (now) {
    if (!this.ready || !this.frames.length) return;
    const gl = this.gl;
    const dur = 1000 / this.fps;
    if (!this.lastT) this.lastT = now;
    if (now - this.lastT >= dur) {
      this.lastT = now;
      this.idx++;
      if (this.idx >= this.frames.length) {
        if (this.once) {
          this.idx = this.frames.length - 1;
          const cb = this.onDone;
          this.once = false; this.onDone = null;
          if (cb) cb();
        } else this.idx = 0;
      }
    }
    const f = this.frames[this.idx];
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, f.pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufUV);
    gl.bufferData(gl.ARRAY_BUFFER, f.uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.aUV);
    gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(this.uRes, this._size[0], this._size[1]);
    gl.uniform2fv(this.uOff, this._off);
    gl.uniform1f(this.uScale, this._scale);
    gl.uniform1i(this.uImg, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.drawArrays(gl.TRIANGLES, 0, f.n);
  };

  root.MeshPet = MeshPet;
})(typeof self !== "undefined" ? self : this);
