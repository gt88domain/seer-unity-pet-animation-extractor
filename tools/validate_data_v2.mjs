#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const v2 = path.join(root, "game", "data", "v2");

function readJson(relative) {
  const full = path.join(v2, relative);
  if (!fs.existsSync(full)) throw new Error(`missing V2 file: ${relative}`);
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNamespaced(value, namespace, label) {
  assert(typeof value === "string" && value.startsWith(`${namespace}:`), `${label} must start with ${namespace}: (${String(value)})`);
}

const manifest = readJson("manifest.json");
assert(manifest.schemaVersion === 2, "manifest.schemaVersion must be 2");
const namespace = manifest.project?.namespace;
assert(typeof namespace === "string" && namespace.length > 0, "manifest.project.namespace is required");
assert(manifest.project?.creatureTerm === "pet", "V2 product vocabulary must use generic pet terminology");

const publishLayers = (manifest.layers || []).filter((layer) => layer.publish === true);
assert(publishLayers.length === 1, "exactly one V2 layer must be publishable at this stage");
assert(publishLayers[0].id === "html5ai-original", "only html5ai-original may be publishable");
assert(publishLayers[0].kind === "original", "publishable layer must be kind=original");
assert(publishLayers[0].namespace === namespace, "publishable layer namespace mismatch");
for (const layer of manifest.layers || []) {
  if (layer.kind === "reference") assert(layer.publish === false, `reference layer ${layer.id} must never be publishable`);
}

const files = publishLayers[0].files || {};
const pets = readJson(files.pets);
const moves = readJson(files.moves);
const world = readJson(files.world);
const bosses = readJson(files.bosses);
const items = readJson(files.items);
const progression = readJson(files.progression);

assert(Array.isArray(pets), "original pets must be an array");
assert(Array.isArray(moves), "original moves must be an array");
assert(Array.isArray(world.maps), "original world.maps must be an array");
assert(Array.isArray(bosses), "original bosses must be an array");
assert(Array.isArray(items), "original items must be an array");
assert(Array.isArray(progression.starters), "original progression.starters must be an array");

const petRange = manifest.runtime?.petRuntimeIdRange;
const moveRange = manifest.runtime?.moveRuntimeIdRange;
assert(Array.isArray(petRange) && petRange.length === 2, "petRuntimeIdRange must be [min,max]");
assert(Array.isArray(moveRange) && moveRange.length === 2, "moveRuntimeIdRange must be [min,max]");

function validateRuntimeRecords(records, range, label) {
  const contentIds = new Set();
  const runtimeIds = new Set();
  for (const record of records) {
    assert(record && typeof record === "object" && !Array.isArray(record), `${label} entries must be objects`);
    assertNamespaced(record.id, namespace, label);
    assert(!contentIds.has(record.id), `duplicate ${label} id: ${record.id}`);
    contentIds.add(record.id);
    assert(Number.isInteger(record.runtimeId), `${label} ${record.id} runtimeId must be an integer`);
    assert(record.runtimeId >= range[0] && record.runtimeId <= range[1], `${label} ${record.id} runtimeId out of reserved range`);
    assert(!runtimeIds.has(record.runtimeId), `duplicate ${label} runtimeId: ${record.runtimeId}`);
    runtimeIds.add(record.runtimeId);
  }
  return { contentIds, runtimeIds };
}

const petIds = validateRuntimeRecords(pets, petRange, "pet").contentIds;
const moveIds = validateRuntimeRecords(moves, moveRange, "move").contentIds;
for (const pet of pets) {
  assert(Array.isArray(pet.moves), `pet ${pet.id} moves must be an array`);
  for (const pair of pet.moves) {
    assert(Array.isArray(pair) && pair.length === 2, `pet ${pet.id} move entries must be [moveId, level]`);
    assertNamespaced(pair[0], namespace, `pet ${pet.id} move`);
    assert(moveIds.has(pair[0]), `pet ${pet.id} references unknown original move ${pair[0]}`);
    assert(Number.isInteger(pair[1]) && pair[1] >= 1, `pet ${pet.id} move level must be a positive integer`);
  }
  for (const field of ["evoFrom", "evoTo"]) {
    const value = pet[field];
    if (value == null || value === 0 || value === "") continue;
    assertNamespaced(value, namespace, `pet ${pet.id} ${field}`);
    assert(petIds.has(value), `pet ${pet.id} ${field} references unknown original pet ${value}`);
  }
}

const mapIds = new Set();
for (const map of world.maps) {
  assertNamespaced(map.id, namespace, "map");
  assert(!mapIds.has(map.id), `duplicate map id: ${map.id}`);
  mapIds.add(map.id);
  for (const wild of map.wild || []) {
    assertNamespaced(wild.id, namespace, `map ${map.id} wild.id`);
    assert(petIds.has(wild.id), `map ${map.id} references unknown wild pet ${wild.id}`);
  }
}
for (const boss of bosses) {
  assertNamespaced(boss.id, namespace, "boss");
  assertNamespaced(boss.mapId, namespace, "boss map");
  assert(mapIds.has(boss.mapId), `boss ${boss.id} references unknown original map ${boss.mapId}`);
  assert(boss.boss && typeof boss.boss === "object" && !Array.isArray(boss.boss), `boss ${boss.id} must contain a boss object`);
  if (boss.boss.pet != null) {
    assertNamespaced(boss.boss.pet, namespace, `boss ${boss.id} pet`);
    assert(petIds.has(boss.boss.pet), `boss ${boss.id} references unknown original pet ${boss.boss.pet}`);
  }
}
for (const item of items) {
  assertNamespaced(item.id, namespace, "item");
}
for (const starter of progression.starters) {
  assertNamespaced(starter, namespace, "starter");
  assert(petIds.has(starter), `starter references unknown original pet ${starter}`);
}

console.log(`Data V2 OK: pets=${pets.length} moves=${moves.length} maps=${world.maps.length} bosses=${bosses.length} items=${items.length}`);
