import type { PlaybackState } from '../renderer/core/playback';

export function mountPreviewControls(root: HTMLElement, playback: PlaybackState): () => void {
  const stage = root.querySelector<HTMLElement>('.clock-stage')!;
  const pause = root.querySelector<HTMLButtonElement>('[data-preview-pause]')!;
  const fullscreen = root.querySelector<HTMLButtonElement>('[data-preview-fullscreen]')!;
  const exit = root.querySelector<HTMLButtonElement>('[data-preview-exit]')!;
  const status = root.querySelector<HTMLElement>('[data-playback-status]')!;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let userChosePlayback = false;
  const sync = () => {
    pause.textContent = playback.paused ? 'Play animation' : 'Pause animation';
    pause.setAttribute('aria-pressed', String(playback.paused));
    status.textContent = playback.paused ? 'Animation paused. Adjustments still update the preview.' : '';
  };
  const toggle = () => { userChosePlayback = true; playback.paused = !playback.paused; sync(); };
  const onMotion = () => { if (!userChosePlayback) { playback.paused = motion.matches; sync(); } };
  const fitDisplay = () => {
    const { width, height } = window.screen;
    stage.style.setProperty('--display-aspect', width > 0 && height > 0 ? `${width} / ${height}` : '16 / 9');
  };
  const onFullscreen = () => {
    if (document.fullscreenElement === stage) exit.focus();
    else fullscreen.focus();
    fitDisplay();
  };
  const enter = async () => {
    try { await stage.requestFullscreen(); }
    catch { status.textContent = 'Fullscreen preview is unavailable. You can still use the preview here.'; }
  };
  const leave = async () => {
    try { await document.exitFullscreen(); }
    catch { status.textContent = 'Could not exit fullscreen. Press Esc to return.'; }
  };
  fullscreen.disabled = !stage.requestFullscreen || document.fullscreenEnabled === false;
  if (fullscreen.disabled) fullscreen.title = 'Fullscreen is unavailable in this environment';
  pause.addEventListener('click', toggle);
  fullscreen.addEventListener('click', enter);
  exit.addEventListener('click', leave);
  motion.addEventListener('change', onMotion);
  document.addEventListener('fullscreenchange', onFullscreen);
  window.addEventListener('resize', fitDisplay);
  onMotion();
  fitDisplay();
  return () => {
    pause.removeEventListener('click', toggle);
    fullscreen.removeEventListener('click', enter);
    exit.removeEventListener('click', leave);
    motion.removeEventListener('change', onMotion);
    document.removeEventListener('fullscreenchange', onFullscreen);
    window.removeEventListener('resize', fitDisplay);
  };
}
