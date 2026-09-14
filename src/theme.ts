export const palettes = [
  { id: 'sage', name: 'Original Sage', accent: '#397e68', companion: '#739ec5' },
  { id: 'blue', name: 'Powder Blue', accent: '#4d7294', companion: '#a399c1' },
  { id: 'lavender', name: 'Soft Lavender', accent: '#75618f', companion: '#739ec5' },
  { id: 'rose', name: 'Dusty Rose', accent: '#935f72', companion: '#8eaaa3' },
  { id: 'apricot', name: 'Warm Apricot', accent: '#a06a3f', companion: '#819eaf' },
  { id: 'neutral', name: 'Monochrome', accent: '#666970', companion: '#969aa1' },
] as const;
export interface Appearance {
  palette: string;
  custom: string;
}
export const defaultAppearance: Appearance = { palette: 'sage', custom: '#397e68' };
export function validColour(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}
export function readAppearance(value: unknown): Appearance {
  const a = value as Partial<Appearance> | null;
  return {
    palette: a && (a.palette === 'custom' || palettes.some((p) => p.id === a.palette)) ? a.palette! : 'sage',
    custom: validColour(a?.custom) ? a.custom.toLowerCase() : defaultAppearance.custom,
  };
}
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export function mix(a: string, b: string, amount: number) {
  const second = rgb(b);
  return (
    '#' +
    rgb(a)
      .map((n, i) =>
        Math.round(n + (second[i] - n) * amount)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
function luminance(hex: string) {
  return rgb(hex)
    .map((c) => c / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
}
export function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function readable(colour: string, backgrounds: string[], minimum = 4.6) {
  const target = luminance(backgrounds[0]) > 0.35 ? '#000000' : '#ffffff';
  for (let i = 0; i <= 100; i++) {
    const candidate = mix(colour, target, i / 100);
    if (backgrounds.every((bg) => contrast(candidate, bg) >= minimum)) return candidate;
  }
  return target;
}
export function makeTheme(appearance: Appearance, dark: boolean) {
  const preset = palettes.find((p) => p.id === appearance.palette) || palettes[0];
  const primary = appearance.palette === 'custom' ? appearance.custom : preset.accent;
  const monochrome = appearance.palette === 'neutral';
  const canvas = dark ? '#202228' : appearance.palette === 'sage' ? '#f1f3ef' : '#f4f3f1';
  const panel = dark ? '#2b2d34' : '#fffffd';
  // Conservative backing for mica text: even a white model beneath smoked
  // glass or a dark object beneath light glass must leave readable controls.
  const micaBacking = mix(panel, dark ? '#ffffff' : '#000000', dark ? 0.07 : 0.09);
  const soft = dark ? '#32353d' : '#f2f4f1';
  const selected = mix(primary, panel, dark ? 0.8 : 0.9);
  const accent = readable(primary, [canvas, soft, selected, panel, micaBacking]);
  const ink = contrast(accent, '#ffffff') > contrast(accent, '#171b20') ? '#ffffff' : '#171b20';
  const companion = monochrome ? '#777c85' : preset.companion;
  const blueSoft = mix(companion, panel, dark ? 0.83 : 0.91);
  const rose = monochrome ? '#777c85' : '#956773';
  const roseSoft = mix(rose, panel, dark ? 0.83 : 0.94);
  const heatLow = mix(primary, '#ffffff', 0.94),
    heatHigh = mix(primary, '#ffffff', 0.48);
  const tokens: Record<string, string> = {
    canvas,
    chrome: canvas,
    panel,
    'panel-solid': panel,
    text: dark ? '#edf0f2' : '#283630',
    muted: dark ? '#b9bec8' : '#65716a',
    line: dark ? '#454952' : '#e0e6df',
    soft,
    accent,
    'accent-soft': selected,
    'accent-line': mix(accent, panel, 0.6),
    'accent-ink': ink,
    'accent-hover': readable(mix(accent, ink, 0.08), [ink]),
    blue: readable(companion, [blueSoft, panel, micaBacking]),
    'blue-soft': blueSoft,
    'blue-line': mix(companion, panel, 0.7),
    rose: readable(rose, [roseSoft, panel, micaBacking]),
    'rose-soft': roseSoft,
    'rose-line': mix(rose, panel, 0.75),
    'apricot-soft': dark ? '#5a4b3c' : '#edddc6',
    'apricot-line': dark ? '#bc9467' : '#bd9766',
    error: readable(dark ? '#f0a6b0' : '#a93e49', [panel, micaBacking]),
    'heat-low': heatLow,
    'heat-high': heatHigh,
    'heat-ink': readable('#283039', [heatLow, heatHigh]),
  };
  if (appearance.palette !== 'sage' && !dark) {
    tokens.text = '#30343a';
    tokens.muted = '#686d74';
    tokens.line = '#e2e4e7';
    tokens.soft = '#f0f1f3';
  }
  tokens.muted = readable(tokens.muted, [
    canvas,
    tokens.soft,
    selected,
    panel,
    blueSoft,
    roseSoft,
    micaBacking,
  ]);
  return { tokens, primary };
}

/** Recolour the same materials in place; cameras, objects and playback stay intact. */
export function sceneColours(appearance: Appearance): Record<string, string> {
  if (appearance.palette === 'sage') return {};
  const { primary } = makeTheme(appearance, false);
  const map: Record<string, string> = {};
  for (const [source, neutral, amount] of [
    ['#43a58f', '#ffffff', 0.26],
    ['#a7d6c5', '#ffffff', 0.64],
    ['#b9d2c8', '#ffffff', 0.72],
    ['#29443f', '#313840', 0.76],
    ['#b6c9c4', '#d8dcdf', 0.85],
    ['#bccdc9', '#d4d9dc', 0.88],
    ['#d8eae5', '#ffffff', 0.9],
    ['#a5c6bd', '#ffffff', 0.72],
    ['#849d96', '#a3adb5', 0.8],
    ['#9db4ad', '#c2cbd0', 0.8],
    ['#bdceca', '#d7dcdf', 0.9],
    ['#b8dbd1', '#ffffff', 0.8],
    ['#83b6a7', '#ffffff', 0.56],
    ['#d5dfdb', '#e2e5e3', 0.9],
    ['#5c7b74', '#667984', 0.65],
    ['#9fb9af', '#c4ced1', 0.8],
    ['#b3c2bd', '#c5cdd1', 0.9],
    ['#acbeb5', '#c3cbd0', 0.85],
    ['#819b91', '#a0afb8', 0.8],
    ['#457e68', '#889cac', 0.6],
    ['#aac4b3', '#d0d8df', 0.8],
    ['#2f5146', '#344751', 0.8],
    ['#a3c6a9', '#d1dcdf', 0.85],
  ] as [string, string, number][])
    map[source] = mix(primary, neutral, amount);
  if (appearance.palette === 'neutral') {
    Object.keys(map).forEach((key) => {
      const v = rgb(map[key]);
      const c = Math.round(v.reduce((s, n) => s + n, 0) / 3)
        .toString(16)
        .padStart(2, '0');
      map[key] = '#' + c.repeat(3);
    });
    Object.assign(map, { '#739ec5': '#9ba4af', '#d8af6b': '#b5aea4', '#a399c1': '#a4a1ac' });
  }
  return map;
}
