#!/usr/bin/env python3
"""Ghibli 皮肤批处理: 品红底 AI 图 -> 透明底游戏立绘.

输入: 原始生成图 (纯色品红背景, 文件名 {body,head}_<id>.png)
输出: game/assets/skins/ghibli/{body,head}/<id>.png + manifest.json

用法:
    python3 tools/skins/chromakey.py /tmp/dl/ghibli/raw [--ids 1,2,3]
    # 缺失的 head_* 会从 body_* 上半部分自动裁 (临时方案, 后续补正式头像)
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SKIN_DIR = ROOT / "game" / "assets" / "skins" / "ghibli"


def key_magenta(im: Image.Image, thresh: int = 60, strict: int = 30) -> Image.Image:
    """品红抠图: 四角采样背景色, 边缘泛洪 + 全局严格键除包住的纯底色."""
    im = im.convert("RGB")
    w, h = im.size
    px = im.load()
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))

    def dist2(p):
        return (p[0] - bg[0]) ** 2 + (p[1] - bg[1]) ** 2

    t2, s2 = thresh * thresh, strict * strict
    kill = bytearray(w * h)
    # 边缘泛洪
    dq: deque = deque()
    for x in range(w):
        dq.append((x, 0)); dq.append((x, h - 1))
    for y in range(h):
        dq.append((0, y)); dq.append((w - 1, y))
    while dq:
        x, y = dq.popleft()
        i = y * w + x
        if kill[i]:
            continue
        if dist2(px[x, y]) > t2:
            continue
        kill[i] = 1
        if x > 0: dq.append((x - 1, y))
        if x < w - 1: dq.append((x + 1, y))
        if y > 0: dq.append((x, y - 1))
        if y < h - 1: dq.append((x, y + 1))
    # 全局严格键 (去包住的底洞)
    for y in range(h):
        for x in range(w):
            if not kill[y * w + x] and dist2(px[x, y]) <= s2:
                kill[y * w + x] = 1
    # alpha + 去边
    alpha = Image.new("L", (w, h), 255)
    apx = alpha.load()
    for y in range(h):
        for x in range(w):
            if kill[y * w + x]:
                apx[x, y] = 0
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out


def trim_pad(im: Image.Image, pad: int = 6) -> Image.Image:
    bbox = im.getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    l = max(0, l - pad); t = max(0, t - pad)
    r = min(im.width, r + pad); b = min(im.height, b + pad)
    return im.crop((l, t, r, b))


def auto_head(body: Image.Image) -> Image.Image:
    """从立绘上半部分裁头像 (临时): 取 alpha 包围盒上部 60% 的居中正方形."""
    bbox = body.getbbox() or (0, 0, body.width, body.height)
    l, t, r, b = bbox
    bw, bh = r - l, b - t
    side = min(bw, int(bh * 0.62))
    cx = (l + r) // 2
    x0 = max(0, cx - side // 2)
    y0 = max(0, t)
    x1 = min(body.width, x0 + side)
    y1 = min(body.height, y0 + side)
    return body.crop((x0, y0, x1, y1))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("rawdir", help="原始图目录 ({body,head}_<id>.png)")
    ap.add_argument("--ids", default="1,2,3,4,5,6,7,8,9")
    args = ap.parse_args()
    raw = Path(args.rawdir)
    ids = [int(x) for x in args.ids.split(",") if x.strip()]
    (SKIN_DIR / "body").mkdir(parents=True, exist_ok=True)
    (SKIN_DIR / "head").mkdir(parents=True, exist_ok=True)
    done_body, done_head, auto = [], [], []
    for pid in ids:
        bf = raw / f"body_{pid}.png"
        if not bf.exists():
            print(f"  body {pid}: 缺原始图, 跳过")
            continue
        body = trim_pad(key_magenta(Image.open(bf)))
        body.thumbnail((512, 512), Image.LANCZOS)
        body.save(SKIN_DIR / "body" / f"{pid}.png")
        done_body.append(pid)
        hf = raw / f"head_{pid}.png"
        if hf.exists():
            head = trim_pad(key_magenta(Image.open(hf)))
        else:
            head = auto_head(body)
            auto.append(pid)
        head.thumbnail((256, 256), Image.LANCZOS)
        head.save(SKIN_DIR / "head" / f"{pid}.png")
        done_head.append(pid)
        print(f"  {pid}: body {body.size} head {head.size}" + (" (头像自动裁)" if pid in auto else ""))
    (SKIN_DIR / "manifest.json").write_text(
        json.dumps({"skin": "ghibli", "ids": sorted(set(done_body) & set(done_head)),
                    "autoHead": sorted(auto)}, ensure_ascii=False), encoding="utf-8")
    print(f"manifest ids={sorted(set(done_body) & set(done_head))} autoHead={sorted(auto)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
