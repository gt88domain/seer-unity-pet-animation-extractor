#!/usr/bin/env python3
"""Create a metadata-only inventory of local reference repositories.

The index deliberately stores paths/sizes/categories only. It does not copy source
records into HTML5.ai's original content layer.
"""

import argparse
import json
from pathlib import Path

KEYWORDS = {
  "pets": ("pet", "monster", "creature", "spt"),
  "moves": ("skill", "move", "fight", "battle", "buff"),
  "world": ("map", "scene", "world", "zone", "npc"),
  "items": ("item", "prop", "bag", "shop", "award", "drop"),
  "progression": ("evol", "level", "exp", "growth", "quest", "task"),
}
ALLOWED_SUFFIXES = {".json", ".xml", ".bytes", ".csv", ".txt", ".asset"}


def classify(relative_path):
  haystack = relative_path.lower()
  categories = []
  for category, keywords in KEYWORDS.items():
    if any(keyword in haystack for keyword in keywords):
      categories.append(category)
  return categories or ["other"]


def scan_root(root):
  root = root.resolve()
  files = []
  for path in root.rglob("*"):
    if not path.is_file() or path.suffix.lower() not in ALLOWED_SUFFIXES:
      continue
    relative = path.relative_to(root).as_posix()
    files.append({
      "path": relative,
      "suffix": path.suffix.lower(),
      "bytes": path.stat().st_size,
      "categories": classify(relative),
    })
  files.sort(key=lambda entry: entry["path"])
  return {
    "rootName": root.name,
    "rootPath": str(root),
    "fileCount": len(files),
    "files": files,
  }


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--root", action="append", type=Path, required=True, help="reference repository root; repeatable")
  parser.add_argument("--out", type=Path, required=True)
  args = parser.parse_args()

  missing = [str(root) for root in args.root if not root.exists()]
  if missing:
    raise SystemExit("missing reference roots: " + ", ".join(missing))

  payload = {
    "schemaVersion": 1,
    "kind": "reference-metadata-index",
    "containsSourceRecords": False,
    "sources": [scan_root(root) for root in args.root],
  }
  args.out.parent.mkdir(parents=True, exist_ok=True)
  args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
  print(f"reference metadata index -> {args.out}")
  for source in payload["sources"]:
    print(f"  {source['rootName']}: {source['fileCount']} files")


if __name__ == "__main__":
  main()
