import type * as T from 'three';
import type { AtlasScene } from './scene.ts';

export const palette = {
  white: '#edf2f0',
  edge: '#b6c9c4',
  dark: '#29443f',
  teal: '#43a58f',
  mint: '#a7d6c5',
  blue: '#739ec5',
  gold: '#d8af6b',
  purple: '#a399c1',
};

// Model recipes only: no routes, placements, stage ordering or camera policy.
const assets = {
  device: (atlas: AtlasScene, g: T.Group) => atlas.laptop(g),
  router: (atlas: AtlasScene, g: T.Group) => atlas.router(g),
  internet: (atlas: AtlasScene, g: T.Group) => atlas.globe(g),
  datacenter: (atlas: AtlasScene, g: T.Group) => atlas.building(g),
  gpu: (atlas: AtlasScene, g: T.Group) => atlas.board(g),
  response: (atlas: AtlasScene, g: T.Group) => {
    atlas.box(g, [1.4, 0.1, 0.6], [0, 0.35, 0], '#dce7ee');
    for (let i = 0; i < 3; i++)
      atlas.box(g, [0.75 - i * 0.15, 0.012, 0.04], [-0.05, 0.412, -0.15 + i * 0.13], '#86a0af');
  },
  weights: (atlas: AtlasScene, g: T.Group) => atlas.tokenGrid(g, palette.gold, 3, 4),
  ingress: (atlas: AtlasScene, g: T.Group) => atlas.chip(g, palette.blue, 1.5),
  rack: (atlas: AtlasScene, g: T.Group) => atlas.rack(g),
  context: (atlas: AtlasScene, g: T.Group) => {
    atlas.platform(g, 2, 2);
    for (let i = 0; i < 3; i++)
      atlas.box(g, [1.4, 0.09, 0.85], [i * 0.05, 0.45 + i * 0.25, 0], i === 2 ? palette.mint : palette.white);
  },
  tokenizer: (atlas: AtlasScene, g: T.Group) => atlas.chip(g, palette.blue, 1.35),
  embedding: (atlas: AtlasScene, g: T.Group) => atlas.tokenGrid(g, palette.mint, 4, 4),
  block: (atlas: AtlasScene, g: T.Group) => {
    atlas.platform(g, 3, 2.6);
    for (let i = 0; i < 6; i++) {
      atlas.box(g, [2.1, 0.31, 1.7], [0, 0.6 + i * 0.5, 0], i % 2 ? palette.mint : '#b9d2c8');
      atlas.box(g, [1.65, 0.035, 0.045], [0, 0.63 + i * 0.5, 0.88], palette.teal);
      atlas.box(
        g,
        [0.42 + atlas.decode * 0.1, 0.2, 0.64],
        [1.55 + atlas.decode * 0.05, 0.6 + i * 0.5, 0.1],
        palette.gold,
      );
    }
  },
  cache: (atlas: AtlasScene, g: T.Group) => {
    atlas.platform(g, 1.8, 1.7);
    for (let i = 0; i < 3 + atlas.decode; i++)
      atlas.box(g, [0.21, 0.65, 0.68], [-0.64 + i * 0.24, 0.63, 0], palette.gold);
  },
  sampling: (atlas: AtlasScene, g: T.Group) => atlas.tokenGrid(g, palette.blue, 2, 4),
  decode: (atlas: AtlasScene, g: T.Group) => {
    atlas.platform(g, 4.8, 1.15);
    for (let i = 0; i < 4 + atlas.decode; i++)
      atlas.box(g, [0.47, 0.22, 0.55], [-1.95 + i * 0.57, 0.46, 0], i < 4 ? palette.white : palette.teal);
  },
  prefill: (atlas: AtlasScene, g: T.Group) => {
    atlas.box(g, [1.8, 0.13, 0.65], [0, 0.35, 0], palette.mint);
  },
  'cache-block': (atlas: AtlasScene, g: T.Group) => atlas.tokenGrid(g, palette.gold, 2, 4),
  intent: (atlas: AtlasScene, g: T.Group) => atlas.chip(g, palette.teal),
  host: (atlas: AtlasScene, g: T.Group) => atlas.chip(g, palette.blue),
  mcp: (atlas: AtlasScene, g: T.Group) => {
    atlas.platform(g, 3.3, 2.7);
    atlas.box(g, [0.9, 1, 0.9], [-0.85, 0.85, 0], palette.blue);
    atlas.box(g, [0.9, 1.4, 0.9], [0.85, 1.05, 0], palette.purple);
    atlas.line(
      g,
      [
        [-0.4, 1.1, 0],
        [0.4, 1.1, 0],
      ],
      palette.teal,
      0.04,
    );
  },
  'tool-result': (atlas: AtlasScene, g: T.Group) => {
    atlas.chip(g, palette.gold);
  },
  image: (atlas: AtlasScene, g: T.Group) => atlas.imageTile(g),
  patches: (atlas: AtlasScene, g: T.Group) => atlas.imageTile(g, 1, true),
  fusion: (atlas: AtlasScene, g: T.Group) => atlas.tokenGrid(g, palette.purple, 4, 5),
  conditioning: (atlas: AtlasScene, g: T.Group) => atlas.chip(g, palette.purple, 1.4),
  noise: (atlas: AtlasScene, g: T.Group) => atlas.imageTile(g, 0),
  denoise: (atlas: AtlasScene, g: T.Group) => atlas.imageTile(g, 0.15 + atlas.refinement * 0.23),
  'image-output': (atlas: AtlasScene, g: T.Group) => atlas.imageTile(g),
};
const blockAsset = (atlas: AtlasScene, g: T.Group, key: string) => {
  atlas.platform(g, 1.9, 2.4);
  if (key === 'attention') {
    for (let r = 0; r < 4; r++)
      for (let col = 0; col <= r; col++)
        atlas.box(
          g,
          [0.33, 0.25 + r * 0.22, 0.33],
          [-0.7 + col * 0.43, 0.65 + r * 0.2, -0.7 + r * 0.43],
          palette.teal,
        );
  } else if (key === 'mlp') {
    for (let col = 0; col < 3; col++) {
      const count = col === 1 ? 6 : 3;
      for (let j = 0; j < count; j++) {
        const p = [-0.7 + col * 0.7, 0.55 + j * 0.23, 0];
        atlas.sphere(g, 0.1, p, palette.purple);
        if (col < 2)
          for (let k = 0; k < (col === 0 ? 6 : 3); k++)
            atlas.line(g, [p, [p[0] + 0.7, 0.55 + k * 0.23, 0]], '#c4bfd4', 0.008);
      }
    }
  } else if (key === 'norm') {
    for (let j = 0; j < 5; j++) atlas.box(g, [0.23, 0.65, 0.7], [-0.72 + j * 0.36, 0.65, 0], palette.blue);
  } else {
    atlas.box(g, [1.4, 0.17, 0.3], [0, 0.9, 0], palette.teal);
    atlas.box(g, [0.3, 0.17, 1.4], [0, 0.9, 0], palette.teal);
  }
};
export type ConceptAssetId = keyof typeof assets | 'attention' | 'mlp' | 'norm' | 'residual';
export function drawConceptAsset(atlas: AtlasScene, group: T.Group, id: ConceptAssetId) {
  if (id in assets) assets[id as keyof typeof assets](atlas, group);
  else blockAsset(atlas, group, id);
}
export const assetLabelHeights: Record<ConceptAssetId, number> = {
  device: 2.4,
  router: 2,
  internet: 3.2,
  datacenter: 3.1,
  gpu: 1.6,
  response: 0.72,
  weights: 1.8,
  ingress: 1.7,
  rack: 3.35,
  context: 1.6,
  tokenizer: 1.45,
  embedding: 1.6,
  block: 4.1,
  cache: 1.35,
  sampling: 1.7,
  decode: 1,
  prefill: 0.85,
  'cache-block': 1.4,
  intent: 1.7,
  host: 1.7,
  mcp: 2,
  'tool-result': 1.6,
  image: 2.7,
  patches: 1.8,
  fusion: 2.2,
  conditioning: 1.5,
  noise: 2.7,
  denoise: 2.7,
  'image-output': 2.7,
  attention: 2.7,
  mlp: 1.9,
  norm: 2.2,
  residual: 2.2,
};
