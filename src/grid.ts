export const defaultGridIntensity = 25;

/** One shared slider with a linear, theme-calibrated opacity range. */
export function gridOpacity(intensity: number, originalOpacity: number): number {
  const value = Math.max(0, Math.min(100, intensity));
  // Previous 28 was 4% of the way along the former 25–100 segment.
  const preferredOpacity = originalOpacity + (1 - originalOpacity) * 0.04;
  // Light 25 matches the previous light 30; the dark calibration is unchanged.
  const themeScale = originalOpacity === 0.045 ? 30 / 25 : 1;
  return preferredOpacity * themeScale * (value / defaultGridIntensity);
}
