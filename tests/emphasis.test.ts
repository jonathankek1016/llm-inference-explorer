import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { GuidedEmphasis } from '../src/emphasis.ts';

test('owner-scoped emphasis handles shared materials reversibly, including textures, without per-frame clones', () => {
  const root = new T.Group();
  const original = new T.MeshStandardMaterial({ color: '#43a58f', map: new T.Texture() });
  const nodes = ['a', 'b'].map((id) => {
    const group = new T.Group();
    group.userData.concept = id;
    root.add(group);
    const mesh = new T.Mesh(new T.BoxGeometry(), original);
    group.add(mesh);
    return mesh;
  });
  const emphasis = new GuidedEmphasis();
  emphasis.prepare(root);
  const materials = nodes.map((n) => n.material);
  assert.notEqual(materials[0], materials[1]);
  assert.notEqual(materials[0], original);
  const shaders = materials.map((material) => {
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      fragmentShader: '#include <map_fragment>\n#include <color_fragment>',
    };
    material.onBeforeCompile(shader as any, {} as T.WebGLRenderer);
    return shader;
  });
  emphasis.setSubject('a');
  emphasis.update(0.05, false);
  assert.equal(shaders[0].uniforms.guidedSubdue.value, 0);
  assert.ok(shaders[1].uniforms.guidedSubdue.value > 0 && shaders[1].uniforms.guidedSubdue.value < 1);
  emphasis.update(1, true);
  assert.equal(shaders[1].uniforms.guidedSubdue.value, 1);
  assert.match(shaders[1].fragmentShader, /guidedSubdue \* 0\.45/);
  assert.match(shaders[1].fragmentShader, /#include <map_fragment>/);
  assert.equal(materials[1].opacity, 1);
  assert.equal(materials[1].map, original.map);
  assert.equal(materials[1].color.getHex(), original.color.getHex());
  emphasis.setSubject('b');
  emphasis.update(0.05, false);
  assert.ok(shaders[0].uniforms.guidedSubdue.value > 0);
  assert.ok(shaders[1].uniforms.guidedSubdue.value < 1);
  emphasis.setSubject();
  emphasis.update(1, true);
  assert.equal(shaders[0].uniforms.guidedSubdue.value, 0);
  assert.equal(shaders[1].uniforms.guidedSubdue.value, 0);
  assert.deepEqual(
    nodes.map((n) => n.material),
    materials,
  );
  let disposed = 0;
  materials.forEach((m) => m.addEventListener('dispose', () => disposed++));
  emphasis.clear();
  assert.equal(disposed, 2);
  nodes.forEach((n) => assert.equal(n.material, original));
  assert.equal(original.opacity, 1);
});

test('geometry rebuild retains each subject blend and free exploration starts neutral', () => {
  const root = new T.Group();
  const original = new T.MeshStandardMaterial({ color: '#43a58f' });
  const mesh = new T.Mesh(new T.BoxGeometry(), original);
  mesh.userData.concept = 'context';
  root.add(mesh);
  const emphasis = new GuidedEmphasis();
  const amount = () => {
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      fragmentShader: '#include <color_fragment>',
    };
    mesh.material.onBeforeCompile(shader as any, {} as T.WebGLRenderer);
    return shader.uniforms.guidedSubdue.value;
  };
  emphasis.prepare(root);
  emphasis.setSubject('decode');
  emphasis.update(1, true);
  assert.equal(amount(), 1);
  emphasis.clear(); // Renderer disposes the old geometry before preparing a new root.
  emphasis.prepare(root);
  assert.equal(amount(), 1);
  emphasis.setSubject();
  emphasis.clear();
  emphasis.prepare(root);
  assert.equal(amount(), 0);
  emphasis.clear();
});
