# HTML5.ai Pet World Data V2

This directory is the migration boundary between the current playable prototype and HTML5.ai's own pet IP.

## Rules

- `legacy-reference` is a temporary compatibility baseline only. It may be studied for mechanics and data shape, but it is not HTML5.ai original content and must not be treated as publishable IP.
- `html5ai-original` is the publishable product layer. New pets, moves, maps, bosses, items, progression, names, art and story belong here.
- Do not add Pokemon-specific species, names, terminology, IDs, assets, move names or assumptions. The product vocabulary is generic `pet`, `move`, `element`, `world`, `boss`, `item` and `progression` until HTML5.ai defines its own branded terms.
- Reference repositories are inputs for understanding mechanics and coverage, not a source of final HTML5.ai names, art or story.

## Stable identity

The current battle engine indexes pets and moves by integer IDs. V2 deliberately separates product identity from legacy runtime identity:

```json
{
  "id": "html5ai:pet:example-slug",
  "runtimeId": 900001
}
```

`id` is the durable HTML5.ai content ID. `runtimeId` is only an adapter for the existing engine. Pet runtime IDs are reserved in `900000-909999`; move runtime IDs are reserved in `910000-919999`.

The V2 compiler writes `contentId` into the legacy record so save migration can later move from numeric IDs to stable namespaced IDs without renaming the original content.

## Original layer files

- `original/pets.json` — pet stats, element IDs, evolution pointers and learnsets.
- `original/moves.json` — battle moves in the current engine-compatible shape.
- `original/world.json` — maps in the current `World` map shape.
- `original/bosses.json` — boss records. A boss can target a map with `mapId` and provides a `boss` object that is attached to that map by the compiler.
- `original/items.json` — item records reserved for the item/inventory migration.
- `original/progression.json` — starters/evolution/learnset product metadata; only `starters` is compiled into the legacy game shell today.

All original IDs must start with `html5ai:`. Runtime IDs must stay inside the reserved ranges and must be unique.

## Build without breaking the current game

The compatibility compiler keeps the working prototype as a shell and overlays the HTML5.ai original layer:

```bash
python tools/build_data_v2.py
```

By default it writes the compatibility profile to `game/data/v2/compiled/compat/` and does **not** touch the live game.

After validation, explicitly opt in to replacing the three legacy runtime files:

```bash
python tools/build_data_v2.py --profile compat --write-live
```

Then run:

```bash
node tools/validate_data_v2.mjs
node tools/validate_data.mjs
node tools/smoke.mjs
```

Use `--profile original` to compile only HTML5.ai pets/moves/maps on top of the still-temporary runtime shell. The compiler refuses to write that profile live until original pets, moves, maps and starters exist. Neither profile is a release-safety claim yet because branding/assets/UI still need migration.

## Reference inventory

Use the indexer to see what kinds of mechanics/data exist in local reference repositories without copying them into the original layer:

```bash
python tools/index_reference_data.py \
  --root ../Seer-golang- \
  --root ../seer-unity-assets- \
  --out game/data/v2/reference-index.json
```

The generated index contains paths, sizes and coarse categories only. Do not commit extracted reference content into `original/`.

## Migration order

1. Keep battle math and the current playable loop stable.
2. Add HTML5.ai original pets/moves using V2 IDs and runtime adapters.
3. Add original maps/bosses and route them through the same compiler.
4. Move items/progression from compatibility metadata into first-class runtime modules.
5. Replace the temporary legacy world shell with an HTML5.ai-owned shell.
6. Remove the numeric adapter only after saves, UI and battle lookups use stable content IDs end-to-end.
