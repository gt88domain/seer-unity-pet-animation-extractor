#!/usr/bin/env python3
import json
import tempfile
import unittest
from pathlib import Path

import build_data_v2 as v2


MANIFEST = {
  "schemaVersion": 2,
  "project": {"namespace": "html5ai"},
  "runtime": {
    "petRuntimeIdRange": [900000, 909999],
    "moveRuntimeIdRange": [910000, 919999],
  },
  "layers": [{
    "id": "html5ai-original",
    "files": {
      "pets": "original/pets.json",
      "moves": "original/moves.json",
      "world": "original/world.json",
      "bosses": "original/bosses.json",
      "items": "original/items.json",
      "progression": "original/progression.json",
    },
  }],
}


def dump(path, value):
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(json.dumps(value), encoding="utf-8")


class DataV2CompilerTest(unittest.TestCase):
  def setUp(self):
    self.temp = tempfile.TemporaryDirectory()
    self.root = Path(self.temp.name)
    self.data = self.root / "data"
    self.v2 = self.data / "v2"
    dump(self.data / "game.json", {
      "title": "fixture",
      "starters": [1],
      "items": {"legacy-heal": {"name": "Legacy Heal"}},
      "maps": [{"id": "legacy-map", "wild": [{"id": 1, "w": 1, "lvMin": 1, "lvMax": 2}]}],
    })
    dump(self.data / "pets.json", {
      "1": {"id": 1, "name": "Legacy Pet", "moves": [[10, 1]]},
    })
    dump(self.data / "skills.json", {
      "10": {"id": 10, "name": "Legacy Move", "power": 1, "pp": 1},
    })
    dump(self.v2 / "manifest.json", MANIFEST)
    dump(self.v2 / "original/moves.json", [{
      "id": "html5ai:move:spark-hop", "runtimeId": 910001,
      "name": "Spark Hop", "cat": 1, "type": 5, "power": 40, "pp": 30, "acc": 100,
    }])
    dump(self.v2 / "original/pets.json", [{
      "id": "html5ai:pet:voltling", "runtimeId": 900001, "name": "Voltling",
      "type": 5, "type2": 0, "base": [40, 50, 40, 45, 40, 60],
      "evoFrom": 0, "evoTo": 0, "evoLv": 0, "catch": 120,
      "yieldExp": 60, "growth": 1, "moves": [["html5ai:move:spark-hop", 1]],
    }])
    dump(self.v2 / "original/world.json", {"maps": [{
      "id": "html5ai:map:glow-meadow", "name": "Glow Meadow",
      "wild": [{"id": "html5ai:pet:voltling", "w": 1, "lvMin": 2, "lvMax": 3}],
    }]})
    dump(self.v2 / "original/bosses.json", [{
      "id": "html5ai:boss:first-spark", "mapId": "html5ai:map:glow-meadow",
      "boss": {
        "name": "First Spark", "pet": "html5ai:pet:voltling", "lv": 5,
        "reward": {"pet": "html5ai:pet:voltling", "petLv": 2},
      },
    }])
    dump(self.v2 / "original/items.json", [{
      "id": "html5ai:item:berry-gel", "name": "Berry Gel", "kind": "heal", "power": 10,
    }])
    dump(self.v2 / "original/progression.json", {
      "starters": ["html5ai:pet:voltling"], "evolutions": [], "learnsets": [],
    })

  def tearDown(self):
    self.temp.cleanup()

  def test_compat_profile_keeps_legacy_and_adds_original(self):
    game, pets, moves, provenance = v2.compile_v2(self.data, self.v2, "compat")
    self.assertIn("1", pets)
    self.assertEqual(pets["900001"]["contentId"], "html5ai:pet:voltling")
    self.assertEqual(pets["900001"]["moves"], [[910001, 1]])
    self.assertIn("10", moves)
    self.assertEqual(moves["910001"]["contentId"], "html5ai:move:spark-hop")
    self.assertEqual(game["maps"][1]["wild"][0]["id"], 900001)
    self.assertEqual(game["maps"][1]["boss"]["pet"], 900001)
    self.assertEqual(game["maps"][1]["boss"]["reward"]["pet"], 900001)
    self.assertFalse(provenance["releaseSafeOriginalOnly"])

  def test_original_profile_strips_legacy_content_tables(self):
    game, pets, moves, provenance = v2.compile_v2(self.data, self.v2, "original")
    self.assertNotIn("1", pets)
    self.assertNotIn("10", moves)
    self.assertEqual(list(pets), ["900001"])
    self.assertEqual(list(moves), ["910001"])
    self.assertEqual([entry["id"] for entry in game["maps"]], ["html5ai:map:glow-meadow"])
    self.assertEqual(game["starters"], [900001])
    self.assertEqual(list(game["items"]), ["html5ai:item:berry-gel"])
    self.assertEqual(provenance["profile"], "original")

  def test_original_pet_cannot_reference_legacy_move_id(self):
    dump(self.v2 / "original/pets.json", [{
      "id": "html5ai:pet:bad", "runtimeId": 900002, "moves": [[10, 1]],
      "evoFrom": 0, "evoTo": 0,
    }])
    with self.assertRaisesRegex(ValueError, "must start with html5ai"):
      v2.compile_v2(self.data, self.v2, "compat")


if __name__ == "__main__":
  unittest.main()
