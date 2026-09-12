#!/usr/bin/env python3
"""Compile HTML5.ai Data V2 into the existing browser game's runtime JSON.

The current game expects numeric pet/move IDs and three legacy JSON files. Data V2
keeps durable namespaced content IDs while using reserved numeric runtime IDs as a
compatibility adapter. The default output is isolated under data/v2/compiled.
"""

import argparse
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = ROOT / "game" / "data"
DEFAULT_V2_DIR = DEFAULT_DATA_DIR / "v2"


def read_json(path):
  with Path(path).open("r", encoding="utf-8") as handle:
    return json.load(handle)


def write_json(path, value):
  path = Path(path)
  path.parent.mkdir(parents=True, exist_ok=True)
  with path.open("w", encoding="utf-8") as handle:
    json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))


def layer_by_id(manifest, layer_id):
  for layer in manifest.get("layers", []):
    if layer.get("id") == layer_id:
      return layer
  raise ValueError(f"missing manifest layer: {layer_id}")


def load_original(v2_dir, manifest):
  layer = layer_by_id(manifest, "html5ai-original")
  files = layer.get("files", {})
  required = ("pets", "moves", "world", "bosses", "items", "progression")
  missing = [name for name in required if name not in files]
  if missing:
    raise ValueError(f"original layer is missing file mappings: {', '.join(missing)}")
  return {name: read_json(v2_dir / files[name]) for name in required}


def assert_namespaced_id(content_id, namespace, label):
  if not isinstance(content_id, str) or not content_id.startswith(namespace + ":"):
    raise ValueError(f"{label} id must start with {namespace}: ({content_id!r})")


def build_runtime_map(records, namespace, runtime_range, label):
  if not isinstance(records, list):
    raise ValueError(f"{label} must be a JSON array")
  low, high = runtime_range
  content_to_runtime = {}
  seen_runtime = set()
  for record in records:
    if not isinstance(record, dict):
      raise ValueError(f"{label} entries must be objects")
    content_id = record.get("id")
    runtime_id = record.get("runtimeId")
    assert_namespaced_id(content_id, namespace, label)
    if content_id in content_to_runtime:
      raise ValueError(f"duplicate {label} content id: {content_id}")
    if not isinstance(runtime_id, int) or isinstance(runtime_id, bool):
      raise ValueError(f"{label} {content_id} runtimeId must be an integer")
    if runtime_id < low or runtime_id > high:
      raise ValueError(f"{label} {content_id} runtimeId {runtime_id} outside {low}-{high}")
    if runtime_id in seen_runtime:
      raise ValueError(f"duplicate {label} runtimeId: {runtime_id}")
    content_to_runtime[content_id] = runtime_id
    seen_runtime.add(runtime_id)
  return content_to_runtime


def adapt_identity(record, runtime_id):
  legacy = copy.deepcopy(record)
  content_id = legacy["id"]
  legacy.pop("runtimeId", None)
  legacy["contentId"] = content_id
  legacy["id"] = runtime_id
  legacy["sourceLayer"] = "html5ai-original"
  return legacy


def adapt_moves(records, content_to_runtime):
  return [adapt_identity(record, content_to_runtime[record["id"]]) for record in records]


def resolve_original_ref(value, mapping, namespace, label, allow_empty=True):
  if allow_empty and value in (None, 0, ""):
    return 0
  assert_namespaced_id(value, namespace, label)
  if value not in mapping:
    raise ValueError(f"{label} references unknown original content: {value}")
  return mapping[value]


def adapt_pets(records, pet_runtime, move_runtime, namespace):
  adapted = []
  for record in records:
    legacy = adapt_identity(record, pet_runtime[record["id"]])
    compiled_moves = []
    for move in record.get("moves", []):
      if not isinstance(move, list) or len(move) != 2:
        raise ValueError(f"pet {record['id']} moves must contain [moveId, level] pairs")
      move_id, level = move
      compiled_moves.append([
        resolve_original_ref(move_id, move_runtime, namespace, f"pet {record['id']} move", allow_empty=False),
        level,
      ])
    legacy["moves"] = compiled_moves
    legacy["evoFrom"] = resolve_original_ref(record.get("evoFrom"), pet_runtime, namespace, f"pet {record['id']} evoFrom")
    legacy["evoTo"] = resolve_original_ref(record.get("evoTo"), pet_runtime, namespace, f"pet {record['id']} evoTo")
    adapted.append(legacy)
  return adapted


def merge_runtime_table(base, overlay, label):
  """Merge adapted records into legacy dict/list collections by numeric runtime id."""
  if isinstance(base, dict):
    result = copy.deepcopy(base)
    for record in overlay:
      key = str(record["id"])
      existing = result.get(key)
      if existing and existing.get("contentId") not in (None, record.get("contentId")):
        raise ValueError(f"{label} runtime id collision: {record['id']}")
      result[key] = copy.deepcopy(record)
    return result
  if isinstance(base, list):
    result = copy.deepcopy(base)
    positions = {record.get("id"): index for index, record in enumerate(result) if isinstance(record, dict)}
    for record in overlay:
      runtime_id = record["id"]
      if runtime_id in positions:
        existing = result[positions[runtime_id]]
        if existing.get("contentId") not in (None, record.get("contentId")):
          raise ValueError(f"{label} runtime id collision: {runtime_id}")
        result[positions[runtime_id]] = copy.deepcopy(record)
      else:
        positions[runtime_id] = len(result)
        result.append(copy.deepcopy(record))
    return result
  raise ValueError(f"{label} legacy collection must be an object or array")


def empty_like(value, label):
  if isinstance(value, dict):
    return {}
  if isinstance(value, list):
    return []
  raise ValueError(f"{label} must be an object or array")


def rewrite_pet_ref(container, key, pet_runtime, namespace, label):
  if key not in container:
    return
  container[key] = resolve_original_ref(container[key], pet_runtime, namespace, label, allow_empty=False)


def compile_boss_payload(payload, pet_runtime, namespace, label):
  boss = copy.deepcopy(payload)
  rewrite_pet_ref(boss, "pet", pet_runtime, namespace, f"{label}.pet")
  reward = boss.get("reward")
  if isinstance(reward, dict):
    rewrite_pet_ref(reward, "pet", pet_runtime, namespace, f"{label}.reward.pet")
  return boss


def compile_map(entry, pet_runtime, namespace):
  if not isinstance(entry, dict):
    raise ValueError("world map entries must be objects")
  map_id = entry.get("id")
  assert_namespaced_id(map_id, namespace, "map")
  record = copy.deepcopy(entry)
  record["sourceLayer"] = "html5ai-original"
  for wild in record.get("wild", []):
    if not isinstance(wild, dict):
      raise ValueError(f"map {map_id} wild entries must be objects")
    rewrite_pet_ref(wild, "id", pet_runtime, namespace, f"map {map_id} wild.id")
  if isinstance(record.get("boss"), dict):
    record["boss"] = compile_boss_payload(record["boss"], pet_runtime, namespace, f"map {map_id}.boss")
  if isinstance(record.get("secret"), dict):
    record["secret"] = compile_boss_payload(record["secret"], pet_runtime, namespace, f"map {map_id}.secret")
  if isinstance(record.get("secretPlus"), list):
    record["secretPlus"] = [
      compile_boss_payload(secret, pet_runtime, namespace, f"map {map_id}.secretPlus")
      for secret in record["secretPlus"]
    ]
  return record


def merge_maps(base_maps, original_maps, pet_runtime, namespace, replace=False):
  if not isinstance(original_maps, list):
    raise ValueError("world.maps must be a JSON array")
  result = [] if replace else copy.deepcopy(base_maps or [])
  if not isinstance(result, list):
    raise ValueError("legacy game maps must be a JSON array")
  positions = {entry.get("id"): index for index, entry in enumerate(result) if isinstance(entry, dict)}
  for entry in original_maps:
    record = compile_map(entry, pet_runtime, namespace)
    map_id = record["id"]
    if map_id in positions:
      result[positions[map_id]] = record
    else:
      positions[map_id] = len(result)
      result.append(record)
  return result


def attach_bosses(game, bosses, pet_runtime, namespace):
  if not isinstance(bosses, list):
    raise ValueError("bosses must be a JSON array")
  maps = game.get("maps", [])
  by_id = {entry.get("id"): entry for entry in maps if isinstance(entry, dict)}
  for entry in bosses:
    if not isinstance(entry, dict):
      raise ValueError("boss entries must be objects")
    boss_id = entry.get("id")
    map_id = entry.get("mapId")
    assert_namespaced_id(boss_id, namespace, "boss")
    assert_namespaced_id(map_id, namespace, "boss map")
    target = by_id.get(map_id)
    if target is None:
      raise ValueError(f"boss {boss_id} references unknown original map: {map_id}")
    if not isinstance(entry.get("boss"), dict):
      raise ValueError(f"boss {boss_id} must provide a boss object")
    target["boss"] = compile_boss_payload(entry["boss"], pet_runtime, namespace, f"boss {boss_id}")
    target["boss"]["contentId"] = boss_id
    target["boss"]["sourceLayer"] = "html5ai-original"


def merge_items(game, items, namespace, replace=False):
  if not isinstance(items, list):
    raise ValueError("items must be a JSON array")
  base = {} if replace else copy.deepcopy(game.get("items", {}))
  if not isinstance(base, dict):
    raise ValueError("legacy game items must be an object")
  for item in items:
    if not isinstance(item, dict):
      raise ValueError("item entries must be objects")
    content_id = item.get("id")
    assert_namespaced_id(content_id, namespace, "item")
    record = copy.deepcopy(item)
    record["contentId"] = content_id
    record["sourceLayer"] = "html5ai-original"
    record.pop("id", None)
    base[content_id] = record
  game["items"] = base


def compile_v2(data_dir, v2_dir, profile):
  manifest = read_json(v2_dir / "manifest.json")
  if manifest.get("schemaVersion") != 2:
    raise ValueError("manifest schemaVersion must be 2")
  namespace = manifest.get("project", {}).get("namespace")
  if not namespace:
    raise ValueError("manifest project.namespace is required")
  runtime = manifest.get("runtime", {})
  pet_range = runtime.get("petRuntimeIdRange")
  move_range = runtime.get("moveRuntimeIdRange")
  if not (isinstance(pet_range, list) and len(pet_range) == 2):
    raise ValueError("manifest petRuntimeIdRange must contain [min,max]")
  if not (isinstance(move_range, list) and len(move_range) == 2):
    raise ValueError("manifest moveRuntimeIdRange must contain [min,max]")

  game = read_json(data_dir / "game.json")
  legacy_pets = read_json(data_dir / "pets.json")
  legacy_moves = read_json(data_dir / "skills.json")
  original = load_original(v2_dir, manifest)

  pet_runtime = build_runtime_map(original["pets"], namespace, pet_range, "pet")
  move_runtime = build_runtime_map(original["moves"], namespace, move_range, "move")
  original_moves = adapt_moves(original["moves"], move_runtime)
  original_pets = adapt_pets(original["pets"], pet_runtime, move_runtime, namespace)

  replace = profile == "original"
  pets_base = empty_like(legacy_pets, "legacy pets") if replace else legacy_pets
  moves_base = empty_like(legacy_moves, "legacy moves") if replace else legacy_moves
  pets = merge_runtime_table(pets_base, original_pets, "pets")
  moves = merge_runtime_table(moves_base, original_moves, "moves")

  game = copy.deepcopy(game)
  if "pets" in game:
    base = empty_like(game["pets"], "game.pets") if replace else game["pets"]
    game["pets"] = merge_runtime_table(base, original_pets, "game.pets")
  if "moves" in game:
    base = empty_like(game["moves"], "game.moves") if replace else game["moves"]
    game["moves"] = merge_runtime_table(base, original_moves, "game.moves")
  game["maps"] = merge_maps(game.get("maps", []), original["world"].get("maps", []), pet_runtime, namespace, replace=replace)
  attach_bosses(game, original["bosses"], pet_runtime, namespace)
  merge_items(game, original["items"], namespace, replace=replace)

  starters = original["progression"].get("starters", [])
  if starters or replace:
    if not isinstance(starters, list):
      raise ValueError("progression.starters must be an array")
    compiled_starters = []
    for content_id in starters:
      compiled_starters.append(resolve_original_ref(content_id, pet_runtime, namespace, "starter", allow_empty=False))
    game["starters"] = compiled_starters

  provenance = {
    "schemaVersion": 2,
    "profile": profile,
    "releaseSafeOriginalOnly": False,
    "namespace": namespace,
    "pets": {str(record["id"]): record["contentId"] for record in original_pets},
    "moves": {str(record["id"]): record["contentId"] for record in original_moves},
    "maps": [entry.get("id") for entry in original["world"].get("maps", [])],
    "note": (
      "Original profile removes legacy pets/moves/maps but the current runtime still contains legacy branding/assets/UI; this is not yet a release-safe original artifact."
      if replace else
      "Compatibility profile retains the legacy reference baseline; it is not an original-only release artifact."
    ),
  }
  return game, pets, moves, provenance


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
  parser.add_argument("--v2-dir", type=Path, default=DEFAULT_V2_DIR)
  parser.add_argument("--out", type=Path, default=None)
  parser.add_argument("--profile", choices=("compat", "original"), default="compat")
  parser.add_argument("--write-live", action="store_true", help="replace live game/data runtime JSON after validation")
  args = parser.parse_args()

  data_dir = args.data_dir.resolve()
  v2_dir = args.v2_dir.resolve()
  default_out = v2_dir / "compiled" / args.profile
  out_dir = data_dir if args.write_live else (args.out.resolve() if args.out else default_out)
  game, pets, moves, provenance = compile_v2(data_dir, v2_dir, args.profile)

  if args.write_live and args.profile == "original":
    if not provenance["pets"] or not provenance["moves"] or not provenance["maps"] or not game.get("starters"):
      raise SystemExit("refusing --write-live --profile original: add original pets, moves, maps and starters first")

  write_json(out_dir / "game.json", game)
  write_json(out_dir / "pets.json", pets)
  write_json(out_dir / "skills.json", moves)
  write_json(out_dir / "provenance.json", provenance)
  print(f"Data V2 {args.profile} build -> {out_dir}")
  print(f"original pets={len(provenance['pets'])} moves={len(provenance['moves'])} maps={len(provenance['maps'])}")
  if args.write_live:
    print("WARNING: live build is not a release-safety claim; check provenance.json and finish branding/assets migration.")


if __name__ == "__main__":
  main()
