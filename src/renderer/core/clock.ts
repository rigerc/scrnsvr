import { clockFontFamily, formatClock, type ClockConfig } from '../../shared/clock';

export interface ClockOverlay { update(config: ClockConfig): void; destroy(): void; }

/** The same overlay is used on the screensaver and its scaled settings preview. */
export function mountClock(host: HTMLElement, initial: ClockConfig): ClockOverlay {
  let config = initial;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const overlay = document.createElement('div');
  overlay.className = 'clock-overlay';
  overlay.setAttribute('role', 'timer');
  overlay.setAttribute('aria-live', 'off');
  const content = document.createElement('div');
  content.className = 'clock-content';
  const time = document.createElement('time');
  time.className = 'clock-time';
  const digits = document.createElement('span');
  digits.className = 'clock-digits';
  const period = document.createElement('span');
  period.className = 'clock-period';
  const date = document.createElement('div');
  date.className = 'clock-date';
  time.append(digits, period);
  content.append(time, date);
  overlay.append(content);
  host.append(overlay);

  function fit() {
    if (!config.enabled) return;
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    const shorter = Math.min(width, height);
    const padding = shorter * config.margin / 100;
    const size = shorter * config.size / 100;
    overlay.style.padding = `${padding}px`;
    content.style.fontSize = `${size}px`;
    // Keep long dates, custom fonts, and large 12-hour clocks inside the display.
    const bounds = content.getBoundingClientRect();
    const scale = Math.min(1, (width - 2 * padding) / Math.max(1, bounds.width), (height - 2 * padding) / Math.max(1, bounds.height));
    content.style.fontSize = `${size * scale}px`;
  }

  function tick() {
    if (!config.enabled) return;
    const now = new Date();
    const formatted = formatClock(now, config);
    if (digits.textContent !== formatted.time || period.textContent !== formatted.period || date.textContent !== formatted.date) {
      digits.textContent = formatted.time;
      period.textContent = formatted.period;
      period.hidden = !formatted.period;
      date.textContent = formatted.date;
      date.hidden = !formatted.date;
      time.dateTime = now.toISOString();
      fit();
    }
    // Re-read wall time on every tick so suspend/resume and time changes stay correct.
    timer = setTimeout(tick, 1000 - Date.now() % 1000);
  }

  function update(next: ClockConfig) {
    if (timer !== undefined) clearTimeout(timer);
    config = next;
    overlay.hidden = !config.enabled;
    overlay.dataset.position = config.position;
    const vertical = config.position.startsWith('top') ? 'start' : config.position.startsWith('bottom') ? 'end' : 'center';
    const horizontal = config.position.endsWith('left') ? 'start' : config.position.endsWith('right') ? 'end' : 'center';
    overlay.style.alignItems = vertical;
    overlay.style.justifyItems = horizontal;
    content.style.textAlign = horizontal === 'start' ? 'left' : horizontal === 'end' ? 'right' : 'center';
    content.style.fontFamily = clockFontFamily(config);
    content.style.fontWeight = String(config.weight);
    content.style.color = config.color;
    content.style.opacity = String(config.opacity);
    content.style.textShadow = config.shadow ? '0 0.025em 0.15em rgb(0 0 0 / 55%)' : 'none';
    tick();
    fit();
  }

  const observer = new ResizeObserver(fit);
  observer.observe(host);
  const refresh = () => update(config);
  document.addEventListener('visibilitychange', refresh);
  document.fonts.addEventListener('loadingdone', fit);
  update(config);
  return {
    update,
    destroy() {
      if (timer !== undefined) clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener('visibilitychange', refresh);
      document.fonts.removeEventListener('loadingdone', fit);
      overlay.remove();
    },
  };
}
