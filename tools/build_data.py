#!/usr/bin/env python3
"""从 Seer-golang- 的 data/spt.xml + data/skills.xml 裁剪出 HTML5 游戏用的精简 JSON.

用法:
    python tools/build_data.py --spt /path/to/spt.xml --skills /path/to/skills.xml

输出:
    game/data/pets.json    精灵图鉴(种族值/进化/升级技能)
    game/data/skills.json  技能库(威力/PP/命中/附加效果)
"""
import argparse
import json
import os
import xml.etree.ElementTree as ET
from collections import Counter

# 游戏阵容: 初始线 + 野生线 + SPT Boss + 奖励幼体 (51 只, 进化链完整)
ROSTER = [
    1, 2, 3, 4, 5, 6, 7, 8, 9,          # 三主宠线
    10, 11, 12,                          # 皮皮线
    13, 14, 15,                          # 比比鼠线
    16, 17, 18,                          # 仙人球线
    22, 23, 24,                          # 毛毛线
    27, 28, 29,                          # 小豆芽线
    30, 31, 32,                          # 贝尔线
    33, 34,                              # 利牙鱼线
    35, 36, 37,                          # 吉尔线
    38, 39, 40,                          # 火炎贝线
    41, 42,                              # 胡里亚线
    43, 44, 45,                          # 罗奇线
    46, 47,                              # 小蘑菇线
    48, 49, 50,                          # 索拉线
    53, 54, 55,                          # 莫比线
    68, 69,                              # 米拉美线
    70,                                  # 雷伊
    83, 84, 85,                          # 依依线(草)
    59, 60, 61,                          # 铁皮线(机械, 需补进化链)
    25, 26,                              # 幽浮线(飞行)
    86, 87, 88,                          # 纳格线(地面)
    111, 112, 113,                       # 雷格线(机械, 需补进化链)
    131, 132,                            # 影球线(暗影)
    186, 187,                            # 露露线(普通)
    215, 216,                            # 哈莫线(龙)
    431, 502,                              # Mesh 隐藏 Boss(鲁尔蒂尼/朵拉格, 纯手工卡组)
]

# Mesh Boss 合成覆盖: spt 里是 Unity 新技能 ID (skills.xml 没有), 用经典招式手工组卡
SYNTH = {
    431: {"type": 2, "type2": 0, "catch": 3, "yieldExp": 180, "growth": 1,
          "moves": [[10027, 1], [10021, 1], [10209, 1], [10024, 1]]},   # 高压水枪/泡沫光线/极冰风暴/水流喷射
    502: {"type": 15, "type2": 13, "catch": 3, "yieldExp": 220, "growth": 1,
          "moves": [[10618, 1], [10622, 1], [10406, 1], [10410, 1]]},  # 龙王灭碎阵/龙王波/瞬影烈刃/黑暗之门
}

# spt.xml 里 EvolvesTo=0 但有 EvolvingLv 的断链, 手工补上 (fromId -> (toId, lv))
EVO_PATCH = {59: (60, 18), 60: (61, 38), 111: (112, 19), 112: (113, 39)}

# 捕捉率修正: spt 里为 0 的野生宠按稀有度放行 (187/216 纯进化, 保持 0)
# 44/15/45 是野生二段进化 (原版不可抓), 宝可梦式放行, 稍难
CATCH_OVR = {186: 25, 215: 5, 44: 30, 15: 30, 45: 30}

TYPE_NAMES = {1: "草", 2: "水", 3: "火", 4: "飞行", 5: "电", 6: "机械", 7: "地面",
              8: "普通", 9: "冰", 10: "超能", 11: "战斗", 12: "光", 13: "暗影",
              14: "神秘", 15: "龙", 16: "圣灵"}


def to_int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def parse_pets(spt_path):
    root = ET.parse(spt_path).getroot()
    pets = {}
    for m in root.findall("Monster"):
        pid = to_int(m.get("ID"))
        if pid not in ROSTER:
            continue
        moves = []
        for mv in m.findall("LearnableMoves/Move"):
            mid = to_int(mv.get("ID"))
            lv = to_int(mv.get("LearningLv"), 1)
            if mid > 0:
                moves.append([mid, lv])
        moves.sort(key=lambda x: x[1])
        evo_to, evo_lv = to_int(m.get("EvolvesTo")), to_int(m.get("EvolvingLv"))
        if pid in EVO_PATCH and not evo_to:
            evo_to, evo_lv = EVO_PATCH[pid]
        ptype, ptype2 = to_int(m.get("Type"), 8), to_int(m.get("Type2"), 0)
        pcatch, pyield, pgrowth = CATCH_OVR.get(pid, to_int(m.get("CatchRate"), 45)), \
            to_int(m.get("YieldingExp"), 60), to_int(m.get("GrowthType"), 1)
        if pid in SYNTH:
            s = SYNTH[pid]
            ptype, ptype2 = s["type"], s["type2"]
            pcatch, pyield, pgrowth = s["catch"], s["yieldExp"], s["growth"]
            moves = [list(x) for x in s["moves"]]
        pets[pid] = {
            "id": pid,
            "name": m.get("DefName") or f"精灵#{pid}",
            "type": ptype,
            "type2": ptype2,
            "base": [to_int(m.get("HP")), to_int(m.get("Atk")), to_int(m.get("Def")),
                     to_int(m.get("SpAtk")), to_int(m.get("SpDef")), to_int(m.get("Spd"))],
            "evoFrom": to_int(m.get("EvolvesFrom")),
            "evoTo": evo_to,
            "evoLv": evo_lv,
            "catch": pcatch,
            "yieldExp": pyield,
            "growth": pgrowth,
            "moves": moves,
        }
    return pets


def parse_skills(skills_path, wanted_ids):
    root = ET.parse(skills_path).getroot()
    skills = {}
    for m in root.find("Moves").findall("Move"):
        mid = to_int(m.get("ID"))
        if mid not in wanted_ids:
            continue
        se_raw = (m.get("SideEffect") or "").strip()
        se_list = [to_int(x) for x in se_raw.split()] if se_raw else []
        args_raw = (m.get("SideEffectArg") or "").strip()
        args_list = [to_int(x) for x in args_raw.split()] if args_raw else []
        skills[mid] = {
            "id": mid,
            "name": m.get("Name") or f"技能#{mid}",
            "cat": to_int(m.get("Category"), 1),          # 1 物攻 2 特攻 4 变化
            "type": to_int(m.get("Type"), 8),
            "power": to_int(m.get("Power")),
            "pp": to_int(m.get("MaxPP"), 35) or 35,
            "acc": to_int(m.get("Accuracy"), 100) or 100,
            "crit": to_int(m.get("CritRate"), 1) or 1,
            "pri": to_int(m.get("Priority"), 0),
            "must": to_int(m.get("MustHit"), 0),
            "se": se_list,
            "args": args_list,
            "dmgBindLv": to_int(m.get("DmgBindLv"), 0),
            "pwrBindDv": to_int(m.get("PwrBindDv"), 0),
            "pwrDouble": to_int(m.get("PwrDouble"), 0),
            "critFirst": to_int(m.get("CritAtkFirst"), 0),
            "critSecond": to_int(m.get("CritAtkSecond"), 0),
            "critSelfHalf": to_int(m.get("CritSelfHalfHp"), 0),
            "critFoeHalf": to_int(m.get("CritFoeHalfHp"), 0),
        }
    return skills


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spt", required=True)
    ap.add_argument("--skills", required=True)
    ap.add_argument("--out", default="game/data")
    args = ap.parse_args()

    pets = parse_pets(args.spt)
    missing = [i for i in ROSTER if i not in pets]
    if missing:
        print("WARNING: spt.xml 缺少:", missing)

    wanted = set()
    for p in pets.values():
        for mid, lv in p["moves"]:
            wanted.add(mid)
    skills = parse_skills(args.skills, wanted)
    missing_sk = sorted(wanted - set(skills))
    if missing_sk:
        print("WARNING: skills.xml 缺少技能:", missing_sk)
        # 缺失技能补一个 Struggle 替身, 保证游戏不崩
        for mid in missing_sk:
            skills[mid] = {"id": mid, "name": "撞击", "cat": 1, "type": 8,
                           "power": 35, "pp": 35, "acc": 95, "crit": 1, "pri": 0,
                           "must": 0, "se": [], "args": [], "dmgBindLv": 0,
                           "pwrBindDv": 0, "pwrDouble": 0, "critFirst": 0,
                           "critSecond": 0, "critSelfHalf": 0, "critFoeHalf": 0}

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "pets.json"), "w", encoding="utf-8") as f:
        json.dump(pets, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(args.out, "skills.json"), "w", encoding="utf-8") as f:
        json.dump(skills, f, ensure_ascii=False, separators=(",", ":"))

    # 报告: 阵容实际用到的 SideEffect, 指导 JS 引擎实现优先级
    se_counter = Counter()
    se_example = {}
    for s in skills.values():
        for e in s["se"]:
            se_counter[e] += 1
            se_example.setdefault(e, (s["id"], s["name"], s["args"]))
    print(f"pets={len(pets)} skills={len(skills)}")
    print("SideEffect usage:")
    for e, c in se_counter.most_common():
        print(f"  SE{e}: x{c}  e.g. {se_example[e]}")
    print("OK ->", args.out)


if __name__ == "__main__":
    main()
