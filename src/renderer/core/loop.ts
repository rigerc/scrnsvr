export function startLoop(render: (dt: number) => void, fps = 60) {
  const interval = 1000 / Math.max(1, Number.isFinite(fps) ? fps : 60);
  let previousFrame = performance.now();
  let deadline = previousFrame + interval;
  let id = 0;
  let stopped = false;
  const reset = () => {
    previousFrame = performance.now();
    deadline = previousFrame + interval;
  };
  const tick = (now: number) => {
    if (document.hidden) {
      reset();
    } else if (now + 0.01 >= deadline) {
      const delta = now - previousFrame;
      previousFrame = now;
      // Keep the original cadence instead of rounding each interval up to the
      // next display refresh. Skip missed deadlines without catch-up renders.
      deadline += (Math.floor(Math.max(0, now - deadline) / interval) + 1) * interval;
      render(delta);
    }
    if (!stopped) id = requestAnimationFrame(tick);
  };
  document.addEventListener('visibilitychange', reset);
  id = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(id);
    document.removeEventListener('visibilitychange', reset);
  };
}
