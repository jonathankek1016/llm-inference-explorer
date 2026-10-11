/** One visual frame scheduler, regardless of how many retained atlas views exist.
 * This does not own educational time, session admission or request execution. */
const frames = new Set<(time: number) => void>();
let pending = 0;
function tick(time: number) {
  pending = requestAnimationFrame(tick);
  for (const frame of frames) frame(time);
}
export function observeSceneFrames(frame: (time: number) => void): () => void {
  frames.add(frame);
  if (!pending) pending = requestAnimationFrame(tick);
  return () => {
    frames.delete(frame);
    if (!frames.size) {
      cancelAnimationFrame(pending);
      pending = 0;
    }
  };
}
