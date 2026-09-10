#!/usr/bin/env python3
"""ppets_* AssetBundle -> 游戏用 mesh 数据 (431.pet.json + 431._Atlas_.png)。

只保留 meshplayer.js 实际读取的字段 (FrameRate/Sequences/Name/Frames/MeshData.Vertices/UVs)，
体积约为完整 dump 的 1/3。atlas 取包内面积最大的 Texture2D (与 70/4913 同一约定:
meshplayer.js 采样时做 1-v 翻转)。

用法:
    python3 tools/mesh/export_mesh.py <ppets_431 Bundle> [输出目录] [--pet-id 431]

依赖: pip install UnityPy Pillow
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def find_swf(env):
    for obj in env.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            d = obj.read()
            if d.m_Script.read().m_ClassName == "SwfClipAsset":
                return obj  # ObjectReader: 后面调 read_typetree()
        except Exception:
            continue
    return None


def prune_mesh(tree: dict) -> dict:
    seqs = []
    for seq in tree.get("Sequences", []):
        frames = []
        for fr in seq.get("Frames", []):
            md = fr.get("MeshData", {})
            verts = [{"x": float(v["x"]), "y": float(v["y"])} for v in md.get("Vertices", [])]
            uvs = [int(u) for u in md.get("UVs", [])]
            frames.append({"MeshData": {"Vertices": verts, "UVs": uvs}})
        seqs.append({"Name": seq.get("Name", ""), "Frames": frames})
    return {
        "Name": tree.get("Name", "pet"),
        "FrameRate": float(tree.get("FrameRate", 24) or 24),
        "Sequences": seqs,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("bundle", help="ppets_* AssetBundle 文件")
    ap.add_argument("outdir", nargs="?", default=".", help="输出目录 (默认当前目录)")
    ap.add_argument("--pet-id", type=int, default=0)
    ap.add_argument("--atlas-size", type=int, default=2048,
                    help="atlas 最长边缩放目标 (UV 是归一化的, 缩放不影响 JSON; 默认 2048, 与 70 一致)")
    args = ap.parse_args()

    import UnityPy

    bundle = Path(args.bundle)
    pet_id = args.pet_id
    if not pet_id:
        m = re.search(r"ppets?_?(\d+)", bundle.name, re.I)
        pet_id = int(m.group(1)) if m else 0
    if not pet_id:
        print("无法从文件名推断 pet id, 请传 --pet-id", file=sys.stderr)
        return 1

    print(f"Loading {bundle} ({bundle.stat().st_size / 1e6:.1f} MB)...")
    env = UnityPy.load(str(bundle))
    swf = find_swf(env)
    if swf is None:
        print("SwfClipAsset not found", file=sys.stderr)
        return 1
    tree = swf.read_typetree()
    data = prune_mesh(tree)
    data["PetId"] = pet_id
    nseq = len(data["Sequences"])
    nfr = sum(len(s["Frames"]) for s in data["Sequences"])
    print(f"  sequences={nseq} frames={nfr} fps={data['FrameRate']}")
    print("  seq names:", [s["Name"] for s in data["Sequences"]][:16])

    texs = [o.read() for o in env.objects if o.type.name == "Texture2D"]
    if not texs:
        print("WARNING: 包内无 Texture2D (atlas 在共享包里?), 只输出 json", file=sys.stderr)
        img = None
    else:
        texs.sort(key=lambda t: t.m_Width * t.m_Height, reverse=True)
        t0 = texs[0]
        print(f"  atlas: {t0.m_Width}x{t0.m_Height} (共 {len(texs)} 张 Texture2D, 取最大)")
        img = t0.image

    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    jp = out / f"{pet_id}.pet.json"
    jp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"  wrote {jp} ({jp.stat().st_size / 1e6:.2f} MB)")
    if img is not None:
        w, h = img.size
        mx = max(w, h)
        if mx > args.atlas_size:
            sc = args.atlas_size / mx
            img = img.resize((max(1, round(w * sc)), max(1, round(h * sc))),
                             __import__("PIL.Image").Image.LANCZOS)
            print(f"  atlas resized: {w}x{h} -> {img.size[0]}x{img.size[1]}")
        ap_ = out / f"{pet_id}._Atlas_.png"
        img.save(ap_)
        print(f"  wrote {ap_} ({ap_.stat().st_size / 1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
