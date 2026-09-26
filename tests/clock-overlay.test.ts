// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clockFontFamily, defaultClockConfig, formatClock } from '../src/shared/clock';
import { mountClock } from '../src/renderer/core/clock';

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { addEventListener: vi.fn(), removeEventListener: vi.fn() } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('formatClock', () => {
  const moment = new Date(2026, 8, 10, 13, 5, 7);

  it('formats 24-hour time with seconds and a date', () => {
    const formatted = formatClock(moment, { ...defaultClockConfig, format: '24h', showSeconds: true, showDate: true }, 'en-US');
    expect(formatted.time).toContain('13');
    expect(formatted.time).toContain('07');
    expect(formatted.period).toBe('');
    expect(formatted.date).toBeTruthy();
  });

  it('formats 12-hour time without seconds and with the day period', () => {
    const formatted = formatClock(moment, { ...defaultClockConfig, format: '12h', showSeconds: false, showDate: false }, 'en-US');
    expect(formatted.time).not.toContain('05:07:07');
    expect(formatted.period).toBe('PM');
    expect(formatted.date).toBe('');
  });

  it('resolves font families including the custom fallback', () => {
    expect(clockFontFamily({ ...defaultClockConfig, font: 'system' })).toContain('system-ui');
    expect(clockFontFamily({ ...defaultClockConfig, font: 'custom', customFont: 'Fira Code' })).toContain('Fira Code');
    expect(clockFontFamily({ ...defaultClockConfig, font: 'custom', customFont: '   ' })).toContain('system-ui');
  });
});

describe('mountClock', () => {
  it('renders, reposition, ticks and tears down the overlay', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.append(host);
    const clock = mountClock(host, { ...defaultClockConfig, enabled: true, position: 'top-left', font: 'custom', customFont: 'Mono', showSeconds: true });
    const overlay = host.querySelector<HTMLElement>('.clock-overlay')!;
    expect(overlay.dataset.position).toBe('top-left');
    expect(overlay.style.alignItems).toBe('start');
    vi.advanceTimersByTime(1000);
    expect(host.querySelector('.clock-digits')?.textContent).toBeTruthy();
    expect(host.querySelector('.clock-content')?.style.fontFamily).toContain('Mono');
    clock.update({ ...defaultClockConfig, enabled: true, position: 'bottom-right', format: '12h' });
    expect(overlay.dataset.position).toBe('bottom-right');
    expect(overlay.style.justifyItems).toBe('end');
    clock.update({ ...defaultClockConfig, enabled: false });
    expect(overlay.hidden).toBe(true);
    clock.destroy();
    expect(host.querySelector('.clock-overlay')).toBeNull();
  });
});
