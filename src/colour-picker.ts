import { validColour } from './theme.ts';

export interface HSV {
  h: number;
  s: number;
  v: number;
}
export function hexToHsv(hex: string): HSV {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  const sector = !delta
    ? 0
    : max === r
      ? (g - b) / delta
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return { h: (sector * 60 + 360) % 360, s: max ? (delta / max) * 100 : 0, v: max * 100 };
}
export function hsvToHex({ h, s, v }: HSV): string {
  const hue = (((h % 360) + 360) % 360) / 60,
    c = ((v / 100) * s) / 100;
  const x = c * (1 - Math.abs((hue % 2) - 1)),
    m = v / 100 - c;
  const rgb =
    hue < 1
      ? [c, x, 0]
      : hue < 2
        ? [x, c, 0]
        : hue < 3
          ? [0, c, x]
          : hue < 4
            ? [0, x, c]
            : hue < 5
              ? [x, 0, c]
              : [c, 0, x];
  return (
    '#' +
    rgb
      .map((n) =>
        Math.round((n + m) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** Edits an accent only. The existing theme system derives all readable shades. */
export class ColourPicker {
  private hsv: HSV = { h: 0, s: 0, v: 100 };
  private colour = '';
  private plane: HTMLElement;
  private hex: HTMLInputElement;
  private hue: HTMLInputElement;
  private saturation: HTMLInputElement;
  private brightness: HTMLInputElement;
  private root: HTMLElement;
  private onChange: (colour: string) => void;
  constructor(root: HTMLElement, onChange: (colour: string) => void) {
    this.root = root;
    this.onChange = onChange;
    const input = (id: string) => root.querySelector<HTMLInputElement>('#' + id)!;
    this.plane = root.querySelector('#colour-plane')!;
    this.hex = input('custom-hex');
    this.hue = input('colour-hue');
    this.saturation = input('colour-saturation');
    this.brightness = input('colour-brightness');
    for (const [control, component] of [
      [this.hue, 'h'],
      [this.saturation, 's'],
      [this.brightness, 'v'],
    ] as const) {
      control.addEventListener('input', () => {
        this.hsv[component] = Number(control.value);
        this.commit();
      });
    }
    this.hex.addEventListener('input', () => {
      const valid = validColour(this.hex.value);
      this.hex.setCustomValidity(valid ? '' : 'Enter a six-digit HEX colour, such as #397e68.');
      this.hex.setAttribute('aria-invalid', String(!valid));
      root.querySelector<HTMLElement>('#custom-hex-error')!.hidden = valid;
      if (valid) {
        this.setColour(this.hex.value.toLowerCase());
        this.onChange(this.colour);
      }
    });
    let pointer: number | undefined;
    const choose = (event: PointerEvent) => {
      const r = this.plane.getBoundingClientRect();
      this.hsv.s = Math.max(0, Math.min(100, ((event.clientX - r.left) / r.width) * 100));
      this.hsv.v = Math.max(0, Math.min(100, 100 - ((event.clientY - r.top) / r.height) * 100));
      this.commit();
    };
    this.plane.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || pointer !== undefined) return;
      event.preventDefault();
      this.saturation.focus({ preventScroll: true });
      pointer = event.pointerId;
      this.plane.setPointerCapture(pointer);
      choose(event);
    });
    this.plane.addEventListener('pointermove', (event) => {
      if (pointer === event.pointerId) choose(event);
    });
    this.plane.addEventListener('pointerup', (event) => {
      if (pointer !== event.pointerId) return;
      choose(event);
      this.plane.releasePointerCapture(pointer);
      pointer = undefined;
    });
    this.plane.addEventListener('lostpointercapture', () => {
      pointer = undefined;
    });
  }
  setColour(colour: string) {
    if (colour !== this.colour) {
      const next = hexToHsv(colour);
      // Preserve hue in greys, and saturation in black, so moving an axis away
      // from an achromatic endpoint restores the user's chosen colour family.
      if (!next.s) next.h = this.hsv.h;
      if (!next.v) next.s = this.hsv.s;
      this.hsv = next;
      this.colour = colour;
    }
    this.render();
  }
  private commit() {
    this.colour = hsvToHex(this.hsv);
    this.render();
    this.onChange(this.colour);
  }
  private render() {
    const { h, s, v } = this.hsv;
    this.root.style.setProperty('--picker-hue', String(h));
    this.root.style.setProperty('--picker-saturation', `${s}%`);
    this.root.style.setProperty('--picker-brightness-y', `${100 - v}%`);
    this.root.style.setProperty('--picker-colour', this.colour);
    for (const [control, value, unit] of [
      [this.hue, h, 'degrees'],
      [this.saturation, s, '%'],
      [this.brightness, v, '%'],
    ] as const) {
      control.value = String(value);
      control.setAttribute('aria-valuetext', `${Math.round(value)}${unit === '%' ? '%' : ' degrees'}`);
    }
    this.hex.value = this.colour;
    this.hex.setCustomValidity('');
    this.hex.setAttribute('aria-invalid', 'false');
    this.root.querySelector<HTMLElement>('#custom-hex-error')!.hidden = true;
    this.root
      .querySelector<HTMLElement>('#colour-preview')!
      .setAttribute('aria-label', `Selected accent ${this.colour}`);
  }
}
