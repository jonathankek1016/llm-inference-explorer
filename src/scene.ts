import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { concepts } from './content.ts';
import type { SceneId } from './content.ts';
import { randomSeed } from './core.ts';
import { sceneColours } from './theme.ts';
import type { Appearance } from './theme.ts';
import { defaultGridIntensity, gridOpacity } from './grid.ts';

const palette = {
  white: '#edf2f0',
  edge: '#b6c9c4',
  dark: '#29443f',
  teal: '#43a58f',
  mint: '#a7d6c5',
  blue: '#739ec5',
  gold: '#d8af6b',
  purple: '#a399c1',
};
type NodeRecord = { id: string; group: T.Group; label: HTMLButtonElement; anchor: T.Vector3 };
export function landscapeCanvas(refinement = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#d4e8e0');
  sky.addColorStop(0.6, '#f6e6ca');
  sky.addColorStop(1, '#6aada5');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 384, 256);
  ctx.fillStyle = '#f7c67b';
  ctx.beginPath();
  ctx.arc(284, 64, 23, 0, Math.PI * 2);
  ctx.fill();
  const mountain = (points: number[][], colour: string) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(0, 180);
    points.forEach((p) => ctx.lineTo(p[0], p[1]));
    ctx.lineTo(384, 190);
    ctx.closePath();
    ctx.fill();
  };
  mountain(
    [
      [0, 140],
      [85, 48],
      [150, 120],
      [223, 78],
      [330, 161],
      [384, 124],
    ],
    '#7b9e99',
  );
  mountain(
    [
      [0, 167],
      [86, 111],
      [168, 171],
      [261, 120],
      [384, 180],
    ],
    '#3f7773',
  );
  ctx.fillStyle = '#b3d7ce';
  ctx.fillRect(0, 182, 384, 74);
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i % 2 ? '#90bbb4' : '#d4e7dc';
    ctx.fillRect(20 + randomSeed(i) * 200, 190 + i * 4, 50 + randomSeed(i + 30) * 80, 1);
  }
  if (refinement < 1) {
    for (let y = 0; y < 256; y += 4)
      for (let x = 0; x < 384; x += 4) {
        const n = Math.floor(randomSeed(x + y * 384) * 255);
        ctx.fillStyle = `rgba(${n},${n},${n},${1 - refinement})`;
        ctx.fillRect(x, y, 4, 4);
      }
  }
  return canvas;
}

export class AtlasScene {
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  camera = new T.OrthographicCamera();
  controls: OrbitControls;
  root = new T.Group();
  labels: HTMLElement;
  nodes: NodeRecord[] = [];
  paths: T.CatmullRomCurve3[] = [];
  sceneId: SceneId = 'world';
  selected = 'device';
  labelsOn = true;
  local = false;
  explode = 0.65;
  decode = 0;
  refinement = 0;
  playing = false;
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  dirty = true;
  private observer: ResizeObserver;
  private raf = 0;
  private targetZoom = 1;
  private panTarget?: T.Vector3;
  private packetStart = 0;
  private ray = new T.Raycaster();
  private pointer = new T.Vector2();
  private start = { x: 0, y: 0 };
  private packet: T.Mesh;
  private halo: T.Mesh;
  private lastTime = 0;
  private materials = new Map<string, T.MeshStandardMaterial>();
  private colourMap: Record<string, string> = {};
  private framing: HTMLElement;
  private groundGrid: T.LineSegments;
  private gridIntensity = defaultGridIntensity;
  private gridBaseOpacity = 0.045;
  private boxGeometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.08);
  private sphereGeometry = new T.SphereGeometry(1, 20, 14);
  private selectedCallback: (id: string) => void;
  private manualCallback: () => void;
  constructor(
    private container: HTMLElement,
    onSelect: (id: string) => void,
    onManual: () => void,
    onFailure: () => void,
  ) {
    this.selectedCallback = onSelect;
    this.manualCallback = onManual;
    this.framing = document.getElementById('scene-framing')!;
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Interactive 3D atlas. Use the journey list or object labels to select concepts.',
    );
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      onFailure();
    });
    container.appendChild(this.renderer.domElement);
    this.labels = document.createElement('div');
    this.labels.className = 'scene-labels';
    container.appendChild(this.labels);
    this.camera.position.set(12, 11, 15);
    this.camera.near = 0.1;
    this.camera.far = 160;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.minZoom = 0.55;
    this.controls.maxZoom = 3.6;
    this.controls.maxPolarAngle = Math.PI / 2.1;
    this.controls.addEventListener('start', () => {
      this.panTarget = undefined;
      this.targetZoom = this.camera.zoom;
      this.manualCallback();
    });
    this.controls.addEventListener('change', () => {
      this.dirty = true;
    });
    const ambient = new T.HemisphereLight(0xffffff, 0x9caeaa, 2.5);
    this.scene.add(ambient);
    const sun = new T.DirectionalLight(0xfffaf0, 3.4);
    sun.position.set(-7, 16, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 45 });
    sun.shadow.normalBias = 0.025;
    sun.shadow.bias = -0.0001;
    this.scene.add(sun);
    const fill = new T.DirectionalLight(0xc5e2e9, 1.5);
    fill.position.set(10, 5, -10);
    this.scene.add(fill);
    const ground = new T.Mesh(
      new T.PlaneGeometry(200, 200),
      new T.ShadowMaterial({ color: 0x59766e, opacity: 0.13 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.07;
    ground.receiveShadow = true;
    this.scene.add(ground);
    // A quiet reference plane, fading out before its perimeter becomes visible.
    const gridVertices: number[] = [];
    for (let i = -40; i <= 40; i++) {
      gridVertices.push(i, -0.065, -40, i, -0.065, 40, -40, -0.065, i, 40, -0.065, i);
    }
    this.groundGrid = new T.LineSegments(
      new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(gridVertices, 3)),
      new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { colour: { value: new T.Color('#69747c') }, opacity: { value: 0.045 } },
        vertexShader: `varying vec2 groundPosition;
          void main() {
            groundPosition = position.xz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `uniform vec3 colour; uniform float opacity; varying vec2 groundPosition;
          void main() {
            float fade = 1.0 - smoothstep(4.0, 22.0, length(groundPosition));
            gl_FragColor = vec4(colour, opacity * fade);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.scene.add(this.groundGrid);
    this.scene.add(this.root);
    this.packet = new T.Mesh(
      new T.SphereGeometry(0.095, 12, 8),
      new T.MeshBasicMaterial({ color: palette.teal }),
    );
    this.scene.add(this.packet);
    this.halo = new T.Mesh(
      new T.RingGeometry(0.64, 0.69, 64),
      new T.MeshBasicMaterial({ color: palette.teal, transparent: true, opacity: 0.65, side: T.DoubleSide }),
    );
    this.halo.rotation.x = -Math.PI / 2;
    this.scene.add(this.halo);
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      this.start = { x: e.clientX, y: e.clientY };
    });
    this.renderer.domElement.addEventListener('pointerup', this.pick);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.observer.observe(this.framing);
    this.build('world');
    this.resize();
    this.animate(0);
  }
  material(colour: string, metalness = 0.08) {
    const key = colour + metalness;
    if (!this.materials.has(key))
      this.materials.set(key, new T.MeshStandardMaterial({ color: colour, roughness: 0.5, metalness }));
    return this.materials.get(key)!;
  }
  box(parent: T.Object3D, size: number[], pos: number[], colour = palette.white, metalness = 0.08) {
    const mesh = new T.Mesh(this.boxGeometry, this.material(colour, metalness));
    mesh.scale.set(...(size as [number, number, number]));
    mesh.position.set(...(pos as [number, number, number]));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  sphere(parent: T.Object3D, radius: number, pos: number[], colour: string) {
    const mesh = new T.Mesh(this.sphereGeometry, this.material(colour));
    mesh.scale.setScalar(radius);
    mesh.position.set(...(pos as [number, number, number]));
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  line(parent: T.Object3D, points: number[][], colour = palette.teal, radius = 0.023) {
    const curve = new T.CatmullRomCurve3(
      points.map((p) => new T.Vector3(...(p as [number, number, number]))),
      false,
      'catmullrom',
      0.12,
    );
    const mesh = new T.Mesh(new T.TubeGeometry(curve, 48, radius, 6, false), this.material(colour));
    parent.add(mesh);
    return curve;
  }
  platform(parent: T.Object3D, width: number, depth: number, tint = palette.white) {
    this.box(parent, [width, 0.23, depth], [0, 0.08, 0], tint);
    this.box(parent, [width - 0.08, 0.035, depth - 0.08], [0, 0.22, 0], '#f8faf6');
  }
  node(id: string, pos: number[], labelHeight: number, draw: (g: T.Group) => void, title?: string) {
    const group = new T.Group();
    group.position.set(...(pos as [number, number, number]));
    group.userData.concept = id;
    this.root.add(group);
    draw(group);
    const label = document.createElement('button');
    label.className = 'object-label';
    label.textContent = title || concepts[id].title;
    label.dataset.concept = id;
    label.addEventListener('click', () => this.selectedCallback(id));
    this.labels.appendChild(label);
    this.nodes.push({ id, group, label, anchor: new T.Vector3(pos[0], pos[1] + labelHeight, pos[2]) });
    return group;
  }
  laptop(g: T.Group) {
    this.platform(g, 3.2, 2.8);
    this.box(g, [2.3, 0.1, 1.6], [0, 0.36, 0.1], '#bccdc9', 0.55);
    const lid = new T.Group();
    lid.position.set(0, 0.43, -0.63);
    lid.rotation.x = -0.16;
    g.add(lid);
    this.box(lid, [2.3, 1.5, 0.09], [0, 0.73, 0], palette.dark, 0.4);
    this.box(lid, [2.1, 1.3, 0.03], [0, 0.73, 0.058], '#d8eae5');
    for (let i = 0; i < 3; i++)
      this.box(
        lid,
        [1.2 - i * 0.22, 0.055, 0.02],
        [-0.14, 0.8 - i * 0.16, 0.084],
        i === 0 ? palette.teal : '#a5c6bd',
      );
    this.box(lid, [0.24, 0.24, 0.02], [-0.78, 1.14, 0.084], palette.teal);
    for (let r = 0; r < 4; r++)
      for (let col = 0; col < 10; col++)
        this.box(g, [0.15, 0.012, 0.1], [-0.86 + col * 0.19, 0.42, -0.42 + r * 0.16], '#849d96');
    this.box(g, [0.63, 0.015, 0.35], [0, 0.42, 0.5], '#9db4ad');
  }
  router(g: T.Group) {
    this.platform(g, 2.1, 1.8);
    this.box(g, [1.55, 0.32, 0.94], [0, 0.48, 0]);
    for (const x of [-0.57, 0.57]) {
      const a = this.box(g, [0.065, 1.0, 0.065], [x, 1.0, -0.28], palette.dark);
      a.rotation.z = x * -0.16;
    }
    for (let i = 0; i < 4; i++) this.sphere(g, 0.028, [-0.4 + 0.16 * i, 0.49, 0.49], palette.teal);
    for (let i = 0; i < 6; i++) this.box(g, [0.055, 0.015, 0.35], [-0.48 + i * 0.18, 0.65, 0.03], '#bdceca');
  }
  globe(g: T.Group) {
    this.platform(g, 3.1, 3.1);
    const globe = new T.Group();
    globe.position.y = 1.65;
    g.add(globe);
    const shell = new T.Mesh(
      new T.SphereGeometry(1.1, 32, 24),
      new T.MeshStandardMaterial({ color: '#b8dbd1', transparent: true, opacity: 0.22, roughness: 0.6 }),
    );
    globe.add(shell);
    for (let i = 0; i < 6; i++) {
      const ring = new T.Mesh(new T.TorusGeometry(1.12, 0.012, 5, 70), this.material('#83b6a7'));
      ring.rotation.y = (i * Math.PI) / 6;
      globe.add(ring);
    }
    for (const y of [-0.7, -0.35, 0, 0.35, 0.7]) {
      const ring = new T.Mesh(
        new T.TorusGeometry(Math.sqrt(1.12 ** 2 - y ** 2), 0.012, 5, 70),
        this.material('#83b6a7'),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      globe.add(ring);
    }
    for (let i = 0; i < 8; i++) {
      const a = i * 2.4,
        y = -0.75 + i * 0.21,
        r = Math.sqrt(1.13 ** 2 - y * y);
      this.sphere(globe, 0.052, [Math.cos(a) * r, y, Math.sin(a) * r], palette.teal);
    }
    this.box(g, [0.5, 0.25, 0.5], [0, 0.4, 0], palette.edge);
  }
  building(g: T.Group) {
    this.platform(g, 4.5, 3.4);
    this.box(g, [3.65, 2.05, 2.45], [0, 1.28, 0], '#d5dfdb');
    this.box(g, [3.88, 0.15, 2.65], [0, 2.35, 0]);
    this.box(g, [3.66, 0.07, 0.035], [0, 1.98, 1.24], palette.teal);
    for (let i = 0; i < 7; i++) {
      this.box(g, [0.32, 1.26, 0.025], [-1.46 + i * 0.48, 1.14, 1.24], '#5c7b74', 0.4);
      for (let j = 0; j < 5; j++)
        this.box(g, [0.28, 0.035, 0.04], [-1.46 + i * 0.48, 0.72 + j * 0.19, 1.26], '#9fb9af');
    }
    for (let i = 0; i < 3; i++) {
      this.box(g, [0.74, 0.22, 0.8], [-1.12 + i * 1.12, 2.51, -0.12], '#b3c2bd');
      const fan = new T.Mesh(new T.CylinderGeometry(0.23, 0.23, 0.03, 24), this.material(palette.dark));
      fan.position.set(-1.12 + i * 1.12, 2.64, -0.12);
      g.add(fan);
    }
    for (let j = 0; j < 5; j++) this.box(g, [0.035, 1.35, 0.15], [1.85, 1.2, -0.88 + j * 0.4], '#acbeb5');
  }
  rack(g: T.Group) {
    this.platform(g, 3.5, 2.4);
    for (let r = 0; r < 3; r++) {
      const x = -1.02 + r * 1.02;
      this.box(g, [0.91, 2.6, 1.25], [x, 1.6, 0], palette.dark, 0.3);
      for (let j = 0; j < 8; j++) {
        this.box(g, [0.77, 0.23, 0.12], [x, 0.55 + j * 0.29, 0.67], '#819b91', 0.45);
        this.sphere(g, 0.025, [x + 0.28, 0.55 + j * 0.29, 0.75], palette.mint);
        for (let k = 0; k < 3; k++)
          this.box(g, [0.18, 0.035, 0.025], [x - 0.23 + k * 0.16, 0.55 + j * 0.29, 0.75], palette.dark);
      }
    }
  }
  board(g: T.Group) {
    this.platform(g, 4.1, 3.35);
    this.box(g, [3.55, 0.15, 2.65], [0, 0.42, 0], '#457e68');
    this.box(g, [1.2, 0.18, 1.2], [0, 0.62, 0], '#aac4b3', 0.6);
    this.box(g, [0.88, 0.22, 0.88], [0, 0.83, 0], palette.dark, 0.6);
    for (let i = 0; i < 8; i++) {
      const x = ((i % 4) - 1.5) * 0.69,
        z = i < 4 ? -0.93 : 0.93;
      this.box(g, [0.44, 0.16, 0.36], [x, 0.59, z], '#2f5146', 0.25);
      this.line(
        g,
        [
          [x, 0.515, z],
          [x, 0.515, z * 0.6],
          [x * 0.35, 0.515, z * 0.48],
        ],
        '#a3c6a9',
        0.012,
      );
    }
    for (let i = 0; i < 16; i++)
      this.box(g, [0.11, 0.025, 0.22], [-1.35 + i * 0.18, 0.43, 1.39], palette.gold, 0.6);
  }
  chip(g: T.Group, tint = palette.teal, width = 1.8) {
    this.platform(g, width + 0.8, 2.2);
    this.box(g, [width, 0.45, 1.35], [0, 0.56, 0], tint, 0.3);
    this.box(g, [width * 0.62, 0.11, 0.9], [0, 0.85, 0], palette.white, 0.2);
    for (let i = 0; i < 6; i++)
      for (const sign of [-1, 1])
        this.box(
          g,
          [0.12, 0.06, 0.22],
          [((-0.7 + i * 0.28) * width) / 1.8, 0.45, sign * 0.8],
          palette.edge,
          0.5,
        );
  }
  tokenGrid(g: T.Group, tint: string, rows = 4, cols = 5) {
    this.platform(g, 2.6, 2.4);
    for (let r = 0; r < rows; r++)
      for (let col = 0; col < cols; col++)
        this.box(
          g,
          [0.3, 0.18 + randomSeed(r * 7 + col) * 0.65, 0.3],
          [-0.85 + col * 0.42, 0.65, -0.68 + r * 0.42],
          (r + col) % 3 === 0 ? palette.white : tint,
        );
  }
  imageTile(g: T.Group, refinement = 1, patches = false) {
    this.platform(g, 3.5, 2.5);
    const texture = new T.CanvasTexture(landscapeCanvas(refinement));
    texture.colorSpace = T.SRGBColorSpace;
    if (!patches) {
      const m = new T.Mesh(
        new T.PlaneGeometry(2.95, 1.97),
        new T.MeshBasicMaterial({ map: texture, side: T.DoubleSide }),
      );
      m.rotation.x = -0.55;
      m.position.set(0, 1.35, -0.15);
      g.add(m);
      this.box(g, [3.13, 2.15, 0.08], [0, 1.35, -0.22], palette.dark).rotation.x = -0.55;
    } else {
      for (let y = 0; y < 3; y++)
        for (let x = 0; x < 4; x++) {
          const t = texture.clone();
          t.repeat.set(0.25, 1 / 3);
          t.offset.set(x / 4, 1 - (y + 1) / 3);
          const m = new T.Mesh(new T.BoxGeometry(0.66, 0.075, 0.57), [
            this.material(palette.white),
            this.material(palette.white),
            new T.MeshBasicMaterial({ map: t }),
            this.material(palette.white),
            this.material(palette.white),
            this.material(palette.white),
          ]);
          m.position.set((x - 1.5) * 0.79, 0.5 + (x + y) * 0.1, (y - 1) * 0.69);
          g.add(m);
        }
    }
  }
  connect(a: number[], b: number[], colour = palette.teal) {
    const points = [a, [a[0] * 0.65 + b[0] * 0.35, 0.34, a[2]], [a[0] * 0.35 + b[0] * 0.65, 0.34, b[2]], b];
    this.paths.push(this.line(this.root, points, colour, 0.035));
    const direction = new T.Vector3(b[0] - a[0], 0, b[2] - a[2]).normalize();
    const arrow = new T.ArrowHelper(
      direction,
      new T.Vector3((a[0] + b[0]) / 2, 0.38, (a[2] + b[2]) / 2),
      0.42,
      colour,
      0.22,
      0.18,
    );
    this.root.add(arrow);
  }
  build(id: SceneId) {
    this.disposeRoot();
    this.sceneId = id;
    this.nodes = [];
    this.paths = [];
    this.labels.replaceChildren();
    if (id === 'world') {
      this.node('device', [-6, 0, 2], 2.4, (g) => this.laptop(g));
      if (!this.local) {
        this.node('router', [-3, 0, 0], 2, (g) => this.router(g));
        this.node('internet', [0, 0, -2], 3.2, (g) => this.globe(g));
        this.node('datacenter', [5, 0, 0], 3.1, (g) => this.building(g));
        this.connect([-4.6, 0.32, 2], [-3.8, 0.32, 0.1]);
        this.connect([-2, 0.32, 0], [-1.4, 0.32, -2]);
        this.connect([1.5, 0.32, -2], [3, 0.32, 0]);
        this.connect([5, 0.3, 1.8], [-6, 0.3, 3.7], '#9aafbf');
        for (const [x, z] of [
          [3.1, -2.6],
          [4, -2.8],
          [6.7, 2.4],
          [7.5, 2.2],
          [-7.9, 1.5],
        ]) {
          const tree = new T.Group();
          tree.position.set(x, 0, z);
          this.box(tree, [0.09, 0.54, 0.09], [0, 0.4, 0], '#b8a88c');
          this.sphere(tree, 0.29, [0, 0.87, 0], '#aac5ab');
          this.root.add(tree);
        }
      } else {
        this.node('gpu', [1, 0, 0], 1.65, (g) => this.board(g), 'Local accelerator');
        this.connect([-4.5, 0.3, 2], [-1, 0.3, 0]);
        this.connect([1, 0.3, 1.8], [-6, 0.3, 3.7], '#9aafbf');
      }
      this.node(
        'response',
        [-0.7, 0, 3.7],
        0.72,
        (g) => {
          this.box(g, [1.4, 0.1, 0.6], [0, 0.35, 0], '#dce7ee');
          for (let i = 0; i < 3; i++)
            this.box(g, [0.75 - i * 0.15, 0.012, 0.04], [-0.05, 0.412, -0.15 + i * 0.13], '#86a0af');
        },
        'Response returns',
      );
    } else if (id === 'compute') {
      if (this.local) {
        this.node('device', [-4, 0, 0], 2.4, (g) => this.laptop(g), 'Local application');
        this.node('gpu', [1, 0, 1], 1.6, (g) => this.board(g), 'On-device accelerator');
        this.node('weights', [4, 0, -2], 1.8, (g) => this.tokenGrid(g, palette.gold, 3, 4));
        this.connect([-2.5, 0.3, 0], [-0.9, 0.3, 1]);
        this.connect([3, 0.3, -1.2], [2, 0.3, 0.1], palette.gold);
      } else {
        this.node('ingress', [-5, 0, 1], 1.7, (g) => this.chip(g, palette.blue, 1.5));
        this.node('rack', [-1, 0, -1], 3.35, (g) => this.rack(g));
        this.node('gpu', [3.5, 0, 1.5], 1.6, (g) => this.board(g));
        this.node('weights', [4.6, 0, -2.6], 1.8, (g) => this.tokenGrid(g, palette.gold, 3, 4));
        this.connect([-4, 0.3, 1], [-2.6, 0.3, -1]);
        this.connect([0.6, 0.3, -1], [1.6, 0.3, 1.5]);
        this.connect([4.6, 0.3, -1.5], [4.6, 0.3, 0.1], palette.gold);
      }
    } else if (id === 'model') {
      this.node('context', [-6.8, 0, 1.6], 1.6, (g) => {
        this.platform(g, 2, 2);
        for (let i = 0; i < 3; i++)
          this.box(
            g,
            [1.4, 0.09, 0.85],
            [i * 0.05, 0.45 + i * 0.25, 0],
            i === 2 ? palette.mint : palette.white,
          );
      });
      this.node('tokenizer', [-4.25, 0, 0.5], 1.45, (g) => this.chip(g, palette.blue, 1.35));
      this.node('embedding', [-1.5, 0, -0.5], 1.6, (g) => this.tokenGrid(g, palette.mint, 4, 4));
      this.node('block', [2, 0, -0.8], 4.1, (g) => {
        this.platform(g, 3, 2.6);
        for (let i = 0; i < 6; i++) {
          this.box(g, [2.1, 0.31, 1.7], [0, 0.6 + i * 0.5, 0], i % 2 ? palette.mint : '#b9d2c8');
          this.box(g, [1.65, 0.035, 0.045], [0, 0.63 + i * 0.5, 0.88], palette.teal);
          this.box(
            g,
            [0.42 + this.decode * 0.1, 0.2, 0.64],
            [1.55 + this.decode * 0.05, 0.6 + i * 0.5, 0.1],
            palette.gold,
          );
        }
      });
      this.node('cache', [4.65, 0, -1.9], 1.35, (g) => {
        this.platform(g, 1.8, 1.7);
        for (let i = 0; i < 3 + this.decode; i++)
          this.box(g, [0.21, 0.65, 0.68], [-0.64 + i * 0.24, 0.63, 0], palette.gold);
      });
      this.node('sampling', [5.8, 0, 1.45], 1.7, (g) => this.tokenGrid(g, palette.blue, 2, 4));
      this.node('decode', [1, 0, 3.5], 1, (g) => {
        this.platform(g, 4.8, 1.15);
        for (let i = 0; i < 4 + this.decode; i++)
          this.box(g, [0.47, 0.22, 0.55], [-1.95 + i * 0.57, 0.46, 0], i < 4 ? palette.white : palette.teal);
      });
      this.connect([-5.8, 0.3, 1.6], [-5.1, 0.3, 0.5]);
      this.connect([-3.3, 0.3, 0.5], [-2.6, 0.3, -0.5]);
      this.connect([-0.3, 0.3, -0.5], [0.7, 0.3, -0.8]);
      this.connect([3.2, 0.3, -0.3], [4.8, 0.3, 1.45]);
      this.connect([5.7, 0.3, 2.5], [3.4, 0.3, 3.5]);
      this.connect([-1.4, 0.3, 3.5], [0.7, 0.3, -0.8], palette.blue);
      this.node(
        'prefill',
        [-1.6, 0, -3.2],
        0.85,
        (g) => {
          this.box(g, [1.8, 0.13, 0.65], [0, 0.35, 0], palette.mint);
        },
        'Prefill → decode',
      );
    } else if (id === 'block') {
      const gap = 1.95 + this.explode * 0.75;
      const ids = ['norm', 'attention', 'residual', 'norm', 'mlp', 'residual'];
      const titles = [
        '01 · RMSNorm',
        '02 · Attention',
        '03 · Add residual',
        '04 · RMSNorm',
        '05 · MLP',
        '06 · Add residual',
      ];
      ids.forEach((key, i) => {
        this.node(
          key,
          [(i - 2.5) * gap, 0, 0],
          key === 'attention' ? 2.7 : i % 2 ? 1.9 : 2.2,
          (g) => {
            this.platform(g, 1.9, 2.4);
            if (key === 'attention') {
              for (let r = 0; r < 4; r++)
                for (let col = 0; col <= r; col++)
                  this.box(
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
                  this.sphere(g, 0.1, p, palette.purple);
                  if (col < 2)
                    for (let k = 0; k < (col === 0 ? 6 : 3); k++)
                      this.line(g, [p, [p[0] + 0.7, 0.55 + k * 0.23, 0]], '#c4bfd4', 0.008);
                }
              }
            } else if (key === 'norm') {
              for (let j = 0; j < 5; j++)
                this.box(g, [0.23, 0.65, 0.7], [-0.72 + j * 0.36, 0.65, 0], palette.blue);
            } else {
              this.box(g, [1.4, 0.17, 0.3], [0, 0.9, 0], palette.teal);
              this.box(g, [0.3, 0.17, 1.4], [0, 0.9, 0], palette.teal);
            }
          },
          titles[i],
        );
        if (i) this.connect([(i - 3.5) * gap + 0.8, 0.3, 0], [(i - 2.5) * gap - 0.8, 0.3, 0]);
      });
      this.line(
        this.root,
        [
          [-2.5 * gap, 0.45, 0.9],
          [-2.5 * gap, 0.45, 2.0],
          [-0.5 * gap, 0.45, 2.0],
          [-0.5 * gap, 0.45, 0.7],
        ],
        palette.gold,
        0.05,
      );
      this.line(
        this.root,
        [
          [-0.5 * gap, 0.45, 0.9],
          [-0.5 * gap, 0.45, 2.5],
          [2.5 * gap, 0.45, 2.5],
          [2.5 * gap, 0.45, 0.7],
        ],
        palette.gold,
        0.05,
      );
      this.node(
        'cache',
        [-1.5 * gap, 0, -3],
        1.4,
        (g) => this.tokenGrid(g, palette.gold, 2, 4),
        'Per-layer KV cache',
      );
      this.connect([-1.5 * gap, 0.35, -1.2], [-1.5 * gap, 0.35, -2], palette.gold);
    } else if (id === 'tools') {
      this.node('intent', [-5, 0, 1.6], 1.7, (g) => this.chip(g, palette.teal));
      this.node('host', [-1.8, 0, -0.8], 1.7, (g) => this.chip(g, palette.blue));
      this.node('mcp', [2.3, 0, -1], 2, (g) => {
        this.platform(g, 3.3, 2.7);
        this.box(g, [0.9, 1, 0.9], [-0.85, 0.85, 0], palette.blue);
        this.box(g, [0.9, 1.4, 0.9], [0.85, 1.05, 0], palette.purple);
        this.line(
          g,
          [
            [-0.4, 1.1, 0],
            [0.4, 1.1, 0],
          ],
          palette.teal,
          0.04,
        );
      });
      this.node('tool-result', [3.8, 0, 2.4], 1.6, (g) => {
        this.chip(g, palette.gold);
      });
      this.connect([-3.8, 0.3, 1.6], [-2.9, 0.3, -0.8]);
      this.connect([-0.6, 0.3, -0.8], [0.7, 0.3, -1]);
      this.connect([3.2, 0.3, 0.4], [3.8, 0.3, 1.3]);
      this.connect([2.5, 0.3, 2.5], [-4.8, 0.3, 2.9], palette.blue);
    } else if (id === 'vision') {
      this.node('image', [-4.5, 0, 1], 2.7, (g) => this.imageTile(g));
      this.node('patches', [0, 0, -1.1], 1.8, (g) => this.imageTile(g, 1, true));
      this.node('fusion', [4.3, 0, 1], 2.2, (g) => this.tokenGrid(g, palette.purple, 4, 5));
      this.connect([-2.8, 0.3, 1], [-1.7, 0.3, -1.1]);
      this.connect([1.7, 0.3, -1.1], [3, 0.3, 1]);
    } else {
      this.node('conditioning', [-5.4, 0, 1.3], 1.5, (g) => this.chip(g, palette.purple, 1.4));
      this.node('noise', [-2.4, 0, -1.5], 2.7, (g) => this.imageTile(g, 0));
      this.node('denoise', [1.7, 0, 0.1], 2.7, (g) => this.imageTile(g, 0.15 + this.refinement * 0.23));
      this.node('image-output', [5.7, 0, 1.5], 2.7, (g) => this.imageTile(g));
      this.connect([-4.4, 0.3, 1.3], [-3.9, 0.3, -1.5]);
      this.connect([-0.8, 0.3, -1.5], [0.1, 0.3, 0.1]);
      this.connect([3.3, 0.3, 0.1], [4.1, 0.3, 1.5]);
    }
    this.setSelected(this.selected);
    this.applyColours();
    this.dirty = true;
  }
  setSelected(id: string) {
    if (this.selected !== id) this.packetStart = performance.now();
    this.selected = id;
    const node = this.nodes.find((n) => n.id === id);
    this.nodes.forEach((n) => {
      n.label.classList.toggle('selected', n.id === id);
      n.label.setAttribute('aria-pressed', String(n.id === id));
    });
    this.halo.visible = !!node;
    if (node) {
      this.halo.position.copy(node.group.position);
      this.halo.position.y = 0.28;
    }
    this.dirty = true;
  }
  setPalette(appearance: Appearance) {
    this.colourMap = sceneColours(appearance);
    this.applyColours();
  }
  private applyColours() {
    this.scene.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!('color' in material) || !(material.color instanceof T.Color)) continue;
        const base = (material.userData.atlasColour ||= '#' + material.color.getHexString());
        material.color.set(this.colourMap[base] || base);
      }
    });
    this.dirty = true;
  }
  setScene(id: SceneId, follow = true) {
    if (id !== this.sceneId) {
      this.build(id);
      if (follow) this.reset();
    }
  }
  setProgress(decode: number, refinement: number) {
    if (decode !== this.decode || refinement !== this.refinement) {
      this.decode = decode;
      this.refinement = refinement;
      if (this.sceneId === 'model' || this.sceneId === 'diffusion') this.build(this.sceneId);
    }
  }
  setExplode(value: number) {
    this.explode = value;
    if (this.sceneId === 'block') this.build('block');
  }
  setLocal(value: boolean) {
    this.local = value;
    this.build(this.sceneId);
  }
  setLabels(value: boolean) {
    this.labelsOn = value;
    this.dirty = true;
  }
  setDark(value: boolean) {
    this.container.classList.toggle('dark-scene', value);
    const material = this.groundGrid.material as T.ShaderMaterial;
    material.uniforms.colour.value.set(value ? '#c0c7d2' : '#69747c');
    this.gridBaseOpacity = value ? 0.028 : 0.045;
    material.uniforms.opacity.value = gridOpacity(this.gridIntensity, this.gridBaseOpacity);
    this.dirty = true;
  }
  setGrid(value: boolean) {
    this.groundGrid.visible = value;
    this.dirty = true;
  }
  setGridIntensity(value: number) {
    // Only alpha changes; retain the existing geometry, colour and distance fade.
    this.gridIntensity = value;
    (this.groundGrid.material as T.ShaderMaterial).uniforms.opacity.value = gridOpacity(
      value,
      this.gridBaseOpacity,
    );
    this.dirty = true;
  }
  focus() {
    const node = this.nodes.find((n) => n.id === this.selected);
    if (node) {
      this.panTarget = node.group.position.clone().add(new T.Vector3(0, 0.8, 0));
      this.targetZoom = 1.65;
      this.dirty = true;
    }
  }
  reset() {
    this.panTarget = undefined;
    this.camera.position.set(11, 10.5, 15);
    this.controls.target.set(0, 0.8, 0.3);
    this.camera.zoom = 1;
    this.targetZoom = 1;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.dirty = true;
  }
  resize() {
    const width = this.container.clientWidth,
      height = this.container.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    const frame = this.framing.getBoundingClientRect(),
      bounds = this.container.getBoundingClientRect(),
      aspect = frame.width / Math.max(1, frame.height),
      horizontal = this.sceneId === 'model' || this.sceneId === 'diffusion' ? 18.7 : 17.5,
      unitsPerPixel = Math.max(9.8, horizontal / aspect) / Math.max(1, frame.height);
    // OrbitControls normalises drag distance by its element height. Compensate
    // for the larger canvas so an equal drag retains the established rotation.
    this.controls.rotateSpeed = height / Math.max(1, frame.height);
    // Render the whole window, while fitting important objects into the same
    // unobstructed area as before. The view offset remains stable during zoom.
    this.camera.left = (-width * unitsPerPixel) / 2;
    this.camera.right = (width * unitsPerPixel) / 2;
    this.camera.top = (height * unitsPerPixel) / 2;
    this.camera.bottom = (-height * unitsPerPixel) / 2;
    this.camera.setViewOffset(
      width,
      height,
      width / 2 - (frame.left - bounds.left + frame.width / 2),
      height / 2 - (frame.top - bounds.top + frame.height / 2),
      width,
      height,
    );
    this.dirty = true;
  }
  private pick = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y) > 5) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, (-(e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
    const hits = this.ray.intersectObjects(this.root.children, true);
    for (const hit of hits) {
      let obj: T.Object3D | null = hit.object;
      while (obj && !obj.userData.concept) obj = obj.parent;
      if (obj?.userData.concept) {
        this.selectedCallback(obj.userData.concept);
        break;
      }
    }
  };
  private animate = (time: number) => {
    this.raf = requestAnimationFrame(this.animate);
    if (document.hidden) return;
    const dt = Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;
    if (this.panTarget) {
      const fraction = this.reduced ? 1 : 1 - Math.exp(-dt * 7),
        delta = this.panTarget.clone().sub(this.controls.target).multiplyScalar(fraction);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
      this.camera.zoom += (this.targetZoom - this.camera.zoom) * fraction;
      this.camera.updateProjectionMatrix();
      this.dirty = true;
      if (
        this.controls.target.distanceTo(this.panTarget) < 0.01 &&
        Math.abs(this.camera.zoom - this.targetZoom) < 0.01
      )
        this.panTarget = undefined;
    }
    this.controls.update();
    this.packet.visible = this.playing && !this.reduced && this.paths.length > 0;
    if (this.packet.visible) {
      const index =
        this.sceneId === 'world'
          ? this.local
            ? this.selected === 'response'
              ? 1
              : 0
            : ({ device: 0, router: 1, internet: 2, datacenter: 2, response: 3 }[this.selected] ?? 0)
          : Math.max(
              0,
              this.nodes.findIndex((n) => n.id === this.selected),
            );
      const path = this.paths[Math.min(index, this.paths.length - 1)];
      // Selection may start later in this same animation frame than its shared
      // timestamp. Never pass a negative curve position to Three.js.
      this.packet.position.copy(path.getPointAt((Math.max(0, time - this.packetStart) / 1800) % 1));
      this.packet.position.y += 0.06;
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.dirty = false;
  };
  private updateLabels() {
    const width = this.container.clientWidth,
      height = this.container.clientHeight;
    const occupied: { x: number; y: number; w: number }[] = [];
    [...this.nodes]
      .sort((a, b) => Number(b.id === this.selected) - Number(a.id === this.selected))
      .forEach((n) => {
        const p = n.anchor.clone().project(this.camera),
          x = (p.x * 0.5 + 0.5) * width,
          y = (-p.y * 0.5 + 0.5) * height,
          w = n.label.offsetWidth || 130;
        const visible =
          (this.labelsOn || n.id === this.selected) &&
          p.z < 1 &&
          x > w / 2 &&
          x < width - w / 2 &&
          y > 12 &&
          y < height - 20 &&
          !occupied.some((o) => Math.abs(o.x - x) < (o.w + w) / 2 + 5 && Math.abs(o.y - y) < 32);
        n.label.style.visibility = visible ? 'visible' : 'hidden';
        n.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        if (visible) occupied.push({ x, y, w });
      });
  }
  private disposeRoot() {
    this.root.traverse((obj) => {
      if (obj instanceof T.Mesh || obj instanceof T.Line) {
        if (obj.geometry !== this.boxGeometry && obj.geometry !== this.sphereGeometry) obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m: T.Material & { map?: T.Texture }) => {
          if (![...this.materials.values()].includes(m as T.MeshStandardMaterial)) {
            m.map?.dispose();
            m.dispose();
          }
        });
      }
    });
    this.root.clear();
  }
  dispose() {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.controls.dispose();
    this.disposeRoot();
    this.boxGeometry.dispose();
    this.sphereGeometry.dispose();
    this.materials.forEach((m) => m.dispose());
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh || o instanceof T.LineSegments) {
        o.geometry.dispose();
        if (!Array.isArray(o.material)) o.material.dispose();
      }
    });
    this.renderer.dispose();
    this.container.replaceChildren();
  }
}
