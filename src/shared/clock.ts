export const clockPositions = [
  'top-left', 'top-center', 'top-right',
  'center-left', 'center', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
] as const;
export const clockFonts = ['system', 'serif', 'monospace', 'rounded', 'custom'] as const;

export interface ClockConfig {
  enabled: boolean;
  position: typeof clockPositions[number];
  font: typeof clockFonts[number];
  customFont: string;
  size: number;
  weight: number;
  color: string;
  opacity: number;
  margin: number;
  format: '24h' | '12h';
  showSeconds: boolean;
  showDate: boolean;
  shadow: boolean;
}

export const defaultClockConfig: ClockConfig = {
  enabled: true, position: 'center', font: 'system', customFont: '',
  size: 12, weight: 300, color: '#ffffff', opacity: 0.95, margin: 5,
  format: '24h', showSeconds: false, showDate: true, shadow: true,
};

export function clockFontFamily(config: ClockConfig): string {
  const families = {
    system: 'system-ui, sans-serif',
    serif: 'Georgia, "Liberation Serif", serif',
    monospace: '"DejaVu Sans Mono", "Liberation Mono", monospace',
    rounded: 'ui-rounded, "Nunito", "Quicksand", system-ui, sans-serif',
    custom: config.customFont.trim() ? `${JSON.stringify(config.customFont.trim())}, system-ui, sans-serif` : 'system-ui, sans-serif',
  };
  return families[config.font];
}

export function formatClock(now: Date, config: ClockConfig, locale?: string) {
  const parts = new Intl.DateTimeFormat(locale, {
    hour: config.format === '24h' ? '2-digit' : 'numeric', minute: '2-digit',
    second: config.showSeconds ? '2-digit' : undefined,
    hourCycle: config.format === '24h' ? 'h23' : 'h12',
  }).formatToParts(now);
  return {
    time: parts.filter(part => part.type !== 'dayPeriod').map(part => part.value).join('').trim(),
    period: parts.find(part => part.type === 'dayPeriod')?.value ?? '',
    date: config.showDate
      ? new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(now)
      : '',
  };
}
