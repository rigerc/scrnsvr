import { clockPositions, type ClockConfig } from '../shared/clock';

export function mountClockControls(root: HTMLElement, config: ClockConfig, onChange: () => void): void {
  const labels = ['Top left', 'Top center', 'Top right', 'Center left', 'Center', 'Center right', 'Bottom left', 'Bottom center', 'Bottom right'];
  const arrows = ['↖', '↑', '↗', '←', '●', '→', '↙', '↓', '↘'];
  root.innerHTML = `
    <h2>Clock overlay</h2>
    <label class="clock-toggle"><input type="checkbox" data-clock="enabled">Show clock</label>
    <fieldset class="clock-options">
      <legend class="visually-hidden">Clock appearance</legend>
      <div class="placement-label">Placement <output data-clock-output="position"></output></div>
      <div class="clock-positions" role="group" aria-label="Clock placement">
        ${clockPositions.map((position, index) => `<button type="button" data-position="${position}" aria-label="${labels[index]}" title="${labels[index]}">${arrows[index]}</button>`).join('')}
      </div>
      <label class="control"><span>Font</span><select data-clock="font">
        <option value="system">System sans</option><option value="serif">Serif</option>
        <option value="monospace">Monospace</option><option value="rounded">Rounded</option>
        <option value="custom">Custom installed font</option>
      </select></label>
      <label class="clock-custom-font"><span>Installed font name</span><input data-clock="customFont" type="text" maxlength="100" placeholder="e.g. JetBrains Mono"><small>Uses a font installed on this computer.</small></label>
      <label class="control"><span>Weight</span><select data-clock="weight">
        <option value="100">Thin</option><option value="200">Extra light</option><option value="300">Light</option>
        <option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option>
        <option value="700">Bold</option><option value="800">Extra bold</option><option value="900">Black</option>
      </select></label>
      <label class="control"><span>Size <output data-clock-output="size"></output></span><input data-clock="size" type="range" min="2" max="30" step="1"></label>
      <label class="control"><span>Color</span><input data-clock="color" type="color"></label>
      <label class="control"><span>Opacity <output data-clock-output="opacity"></output></span><input data-clock="opacity" type="range" min="0.1" max="1" step="0.05"></label>
      <label class="control"><span>Edge spacing <output data-clock-output="margin"></output></span><input data-clock="margin" type="range" min="0" max="20" step="1"></label>
      <p class="clock-hint">Size and edge spacing scale with your display.</p>
      <label class="control"><span>Time format</span><select data-clock="format"><option value="24h">24-hour</option><option value="12h">12-hour (AM/PM)</option></select></label>
      <label class="clock-toggle"><input data-clock="showSeconds" type="checkbox">Show seconds</label>
      <label class="clock-toggle"><input data-clock="showDate" type="checkbox">Show date</label>
      <label class="clock-toggle"><input data-clock="shadow" type="checkbox">Text shadow</label>
    </fieldset>`;

  function sync() {
    (root.querySelector('fieldset') as HTMLFieldSetElement).disabled = !config.enabled;
    (root.querySelector('.clock-custom-font') as HTMLElement).hidden = config.font !== 'custom';
    root.querySelectorAll<HTMLButtonElement>('[data-position]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.position === config.position));
    });
    const values = { position: labels[clockPositions.indexOf(config.position)], size: `${config.size}%`, opacity: `${Math.round(config.opacity * 100)}%`, margin: `${config.margin}%` };
    root.querySelectorAll<HTMLOutputElement>('[data-clock-output]').forEach(output => {
      output.textContent = values[output.dataset.clockOutput as keyof typeof values];
    });
  }

  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-clock]').forEach(input => {
    const key = input.dataset.clock as keyof ClockConfig;
    if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = Boolean(config[key]);
    else input.value = String(config[key]);
    input.addEventListener('input', () => {
      const value = input instanceof HTMLInputElement && input.type === 'checkbox'
        ? input.checked : typeof config[key] === 'number' ? Number(input.value) : input.value;
      Object.assign(config, { [key]: value });
      sync();
      onChange();
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-position]').forEach(button => {
    button.addEventListener('click', () => {
      config.position = button.dataset.position as ClockConfig['position'];
      sync();
      onChange();
    });
  });
  sync();
}
