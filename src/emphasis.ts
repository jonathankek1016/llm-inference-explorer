import * as T from 'three';
import { focusEase } from './camera.ts';

type Effect = { material: T.Material; owner?: string; amount: { value: number } };
/** Clones once per owner/material per build; originals, textures and palette colors stay intact. */
export class GuidedEmphasis {
  private effects: Effect[] = [];
  private originals = new Map<T.Mesh | T.Line, T.Material | T.Material[]>();
  private subject?: string;
  private levels = new Map<string | undefined, number>();
  prepare(root: T.Object3D) {
    this.clear();
    const cache = new Map<T.Material, Map<string | undefined, Effect>>();
    root.traverse((object) => {
      if (!(object instanceof T.Mesh || object instanceof T.Line)) return;
      let ancestor: T.Object3D | null = object;
      while (ancestor && !ancestor.userData.concept && ancestor !== root) ancestor = ancestor.parent;
      const owner = ancestor?.userData.concept as string | undefined;
      this.originals.set(object, object.material);
      const wrap = (original: T.Material) => {
        let owners = cache.get(original);
        if (!owners) cache.set(original, (owners = new Map()));
        let effect = owners.get(owner);
        if (!effect) {
          const material = original.clone();
          const amount = { value: this.subject ? (this.levels.get(owner) ?? 0) : 0 };
          material.onBeforeCompile = (shader) => {
            shader.uniforms.guidedSubdue = amount;
            shader.fragmentShader =
              'uniform float guidedSubdue;\n' +
              shader.fragmentShader.replace(
                '#include <color_fragment>',
                `#include <color_fragment>
              float guidedLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(guidedLuma), guidedSubdue * 0.45);
              diffuseColor.rgb *= 1.0 - guidedSubdue * 0.06;`,
              );
          };
          material.customProgramCacheKey = () => 'atlas-guided-emphasis-v1';
          effect = { material, owner, amount };
          owners.set(owner, effect);
          this.effects.push(effect);
        }
        return effect.material;
      };
      object.material = Array.isArray(object.material) ? object.material.map(wrap) : wrap(object.material);
    });
  }
  setSubject(subject?: string) {
    this.subject = subject;
    if (!subject) this.levels.clear();
  }
  update(seconds: number, reducedMotion: boolean) {
    let changed = false;
    const fraction = focusEase(seconds, reducedMotion);
    for (const effect of this.effects) {
      const target = this.subject && effect.owner !== this.subject ? 1 : 0;
      if (effect.amount.value === target) continue;
      const value = effect.amount.value + (target - effect.amount.value) * fraction;
      effect.amount.value = Math.abs(target - value) < 0.001 ? target : value;
      changed = true;
    }
    return changed;
  }
  clear() {
    for (const [object, material] of this.originals) object.material = material;
    for (const effect of this.effects) {
      // Decode/explode rebuilds replace geometry. Retain the owner's current
      // blend so new meshes do not flash back to full colour for one frame.
      this.levels.set(effect.owner, effect.amount.value);
      effect.material.dispose();
    }
    this.originals.clear();
    this.effects = [];
  }
}
