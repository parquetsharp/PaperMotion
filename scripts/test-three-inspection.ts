import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { createSceneClock, describeThreePart, inspectableObject } from "../lib/three-inspection";
import { buildVizPrompt } from "../lib/agents/viz";

test("3D inspection uses explicit part metadata and never invents explanations", () => {
  const mesh = new THREE.Mesh();
  assert.deepEqual(describeThreePart(mesh).part, { id: mesh.id, label: "Unnamed part", properties: [], illustrative: false, named: false });
  mesh.name = "Logical block";
  assert.equal(describeThreePart(mesh).part.description, undefined);
  mesh.userData.study = { label: "Block 2", description: "An illustrative block mapping.", properties: { owner: "Request A", slots: 4, shared: false }, illustrative: true };
  const { part } = describeThreePart(mesh);
  assert.equal(part.label, "Block 2");
  assert.equal(part.illustrative, true);
  assert.deepEqual(part.properties, [["owner", "Request A"], ["slots", "4"], ["shared", "false"]]);
});

test("Named parent parts can describe child meshes; invalid metadata is ignored", () => {
  const group = new THREE.Group();
  const child = new THREE.Mesh();
  group.add(child);
  group.userData.study = { label: "Encoder layer", description: "Supplied description." };
  assert.equal(describeThreePart(child).object, group);
  child.userData.study = { description: { unsafe: "not text" } };
  assert.equal(describeThreePart(child).part.label, "Encoder layer");
  child.userData.study = { label: "Attention head" };
  assert.equal(describeThreePart(child).object, child);
});

test("Hidden, transparent and explicitly excluded objects are not inspectable", () => {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  group.add(mesh);
  assert.equal(inspectableObject(mesh), true);
  group.visible = false;
  assert.equal(inspectableObject(mesh), false);
  group.visible = true;
  group.userData.inspectable = false;
  assert.equal(inspectableObject(mesh), false);
  delete group.userData.inspectable;
  mesh.material.transparent = true;
  mesh.material.opacity = 0;
  assert.equal(inspectableObject(mesh), false);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test("Animation time freezes independently of rotation and resumes without a jump", () => {
  const clock = createSceneClock();
  assert.equal(clock.tick(1000, true).elapsed, 0);
  assert.equal(clock.tick(1020, true).elapsed, 0.02);
  assert.deepEqual(clock.tick(1040, false), { elapsed: 0.02, delta: 0.02 });
  assert.equal(clock.tick(2000, false).elapsed, 0.02);
  assert.equal(clock.tick(2020, true).elapsed, 0.04);
  assert.equal(clock.tick(10000, true).delta, 0.1);
});

test("Metadata display is bounded and generated scenes receive the inspection contract", () => {
  const mesh = new THREE.Mesh();
  mesh.userData.study = { label: "Named part", properties: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`property${index}`, index])) };
  assert.equal(describeThreePart(mesh).part.properties.length, 12);
  mesh.userData.study = { label: "Named part", description: "x".repeat(1601) };
  assert.equal(describeThreePart(mesh).part.description, undefined);
  const prompt = buildVizPrompt({ type: "3d", label: "Logical block", context: "Memory blocks" });
  assert.match(prompt, /userData\.study/);
  assert.match(prompt, /illustrative: true/);
  assert.match(prompt, /paused time is excluded/);
  assert.match(prompt, /Do not create your own animation loops/);
});