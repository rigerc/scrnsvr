import type { UniformManifest, UniformValue } from '../shared/manifest';
import { bindUniforms, snapUniformValue, uniformVisible } from '../renderer/core/uniforms';

type ControlInput = HTMLInputElement | HTMLSelectElement;

export interface ShaderControlOptions {
  locks?: Set<string>;
  inheritedValues?: () => Record<string, UniformValue>;
}

interface ControlContext {
  options: ShaderControlOptions;
  values: Record<string, UniformValue>;
  resolveValues: () => Record<string, UniformValue>;
  refreshVisibility: () => void;
  onChange: () => void;
}

interface ControlRow { def: UniformManifest; row: HTMLElement; }

/** Build the `<select>` or range/number/checkbox/color input for one control. */
function createSelectInput(def: UniformManifest): HTMLSelectElement {
  const input = document.createElement('select');
  for (const option of def.options ?? []) {
    const element = document.createElement('option');
    element.value = option;
    element.textContent = option.charAt(0).toUpperCase() + option.slice(1);
    input.append(element);
  }
  return input;
}

function createRangeInput(def: UniformManifest, name: string, descriptionId: string): { input: HTMLInputElement; number: HTMLInputElement } {
  const input = document.createElement('input');
  input.type = 'range';
  const number = document.createElement('input');
  number.type = 'number';
  number.setAttribute('aria-label', `${name} value${def.unit ? ` (${def.unit})` : ''}`);
  number.setAttribute('aria-describedby', descriptionId);
  for (const control of [input, number]) {
    control.min = String(def.min ?? 0);
    control.max = String(def.max ?? 1);
    control.step = String(def.step ?? (def.type === 'int' ? 1 : 0.01));
  }
  return { input, number };
}

function createControlInput(def: UniformManifest, name: string, descriptionId: string): { input: ControlInput; number?: HTMLInputElement } {
  if (def.type === 'select') return { input: createSelectInput(def) };
  if (def.type === 'float' || def.type === 'int') return createRangeInput(def, name, descriptionId);
  const input = document.createElement('input');
  input.type = def.type === 'bool' ? 'checkbox' : 'color';
  return { input };
}

function buildRow(def: UniformManifest, context: ControlContext): ControlRow {
  const name = def.label ?? def.name;
  const id = `uniform-${def.name}`;
  const row = document.createElement('div');
  row.className = 'shader-control';
  row.dataset.control = def.name;
  const heading = document.createElement('div');
  heading.className = 'shader-control-heading';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = name + (def.unit ? ` (${def.unit})` : '');
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'uniform-reset';
  reset.textContent = 'Reset';
  reset.setAttribute('aria-label', `Reset ${name}`);
  const lock = document.createElement('button');
  lock.type = 'button';
  lock.className = 'uniform-lock';
  const syncLock = () => {
    const locked = context.options.locks?.has(def.name) ?? false;
    lock.textContent = locked ? 'Locked' : 'Lock';
    lock.setAttribute('aria-pressed', String(locked));
    lock.setAttribute('aria-label', `Lock ${name} during randomization`);
  };
  lock.addEventListener('click', () => {
    const locks = context.options.locks;
    if (locks?.has(def.name)) locks.delete(def.name); else locks?.add(def.name);
    syncLock();
    if (!locks?.has(def.name) && row.closest<HTMLElement>('[data-show-locks]')?.dataset.showLocks !== 'true') {
      row.querySelector<HTMLElement>('input, select')?.focus();
    }
  });
  syncLock();
  heading.append(label, lock, reset);
  row.append(heading);
  const description = document.createElement('p');
  description.id = `${id}-hint`;
  description.textContent = def.description ?? '';
  description.hidden = !def.description;
  const { input, number } = createControlInput(def, name, description.id);
  input.id = id;
  input.dataset.name = def.name;
  input.setAttribute('aria-describedby', description.id);
  const source = document.createElement('span');
  source.className = 'uniform-source';
  const hex = def.type === 'color' ? document.createElement('input') : undefined;
  const error = document.createElement('p');
  error.id = `${id}-error`;
  error.className = 'uniform-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  if (hex) {
    hex.type = 'text';
    hex.className = 'uniform-hex';
    hex.spellcheck = false;
    hex.maxLength = 7;
    hex.setAttribute('aria-label', `${name} hex color`);
    hex.setAttribute('aria-describedby', `${description.id} ${error.id}`);
  }
  const sync = () => {
    const value = bindUniforms([def], context.resolveValues())[def.name];
    input.value = String(value);
    if (input instanceof HTMLInputElement && def.type === 'bool') input.checked = Boolean(value);
    if (number) number.value = String(value);
    const custom = Object.hasOwn(context.values, def.name);
    reset.disabled = !custom;
    const inherited = context.options.inheritedValues?.() ?? {};
    source.textContent = custom ? 'Custom' : Object.hasOwn(inherited, def.name) ? 'From scheme' : 'Built-in';
    reset.title = `Return to ${inherited[def.name] ?? def.default}`;
    if (hex) {
      hex.value = String(value);
      hex.removeAttribute('aria-invalid');
      error.hidden = true;
    }
  };
  const commit = (value: unknown) => {
    context.values[def.name] = snapUniformValue(def, value);
    sync();
    context.refreshVisibility();
    context.onChange();
  };
  input.addEventListener('input', () => commit(input instanceof HTMLInputElement && def.type === 'bool' ? input.checked : input.value));
  // Preserve intermediate text such as "-" or "0." until direct entry is committed.
  number?.addEventListener('change', () => commit(number.value));
  number?.addEventListener('blur', sync);
  number?.addEventListener('keydown', event => {
    if (event.key === 'Enter') { commit(number.value); event.preventDefault(); }
  });
  const commitHex = () => {
    if (!hex) return;
    const value = hex.value.trim();
    if (!/^#[\da-f]{6}$/i.test(value)) {
      hex.setAttribute('aria-invalid', 'true');
      error.textContent = 'Enter six hex digits, for example #aabbcc.';
      error.hidden = false;
      return;
    }
    commit(value.toLowerCase());
  };
  hex?.addEventListener('change', commitHex);
  hex?.addEventListener('keydown', event => {
    if (event.key === 'Enter') { commitHex(); event.preventDefault(); }
    if (event.key === 'Escape') { sync(); event.preventDefault(); }
  });
  reset.addEventListener('click', () => {
    delete context.values[def.name];
    sync();
    context.refreshVisibility();
    context.onChange();
    input.focus();
  });
  const inputs = document.createElement('div');
  inputs.className = 'shader-control-inputs';
  inputs.append(input);
  if (number) inputs.append(number);
  if (hex) inputs.append(hex, source);
  row.append(inputs, description, error);
  sync();
  return { def, row };
}

function buildGroup(group: string, defs: UniformManifest[], context: ControlContext): { section: HTMLFieldSetElement; rows: ControlRow[] } {
  const section = document.createElement('fieldset');
  section.className = 'shader-control-group';
  const legend = document.createElement('legend');
  legend.textContent = group;
  section.append(legend);
  const rows = defs.map(def => {
    const built = buildRow(def, context);
    section.append(built.row);
    return built;
  });
  return { section, rows };
}

export function mountShaderControls(
  root: HTMLElement,
  definitions: UniformManifest[],
  values: Record<string, UniformValue>,
  onChange: () => void,
  resolveValues: () => Record<string, UniformValue> = () => values,
  options: ShaderControlOptions = {},
) {
  const wasOpen = root.querySelector('details')?.open ?? false;
  root.replaceChildren();
  const lockTools = document.createElement('div');
  lockTools.className = 'parameter-lock-tools';
  const toggleLocks = document.createElement('button');
  toggleLocks.type = 'button';
  toggleLocks.className = 'parameter-lock-toggle';
  const lockHint = document.createElement('p');
  lockHint.textContent = 'Locked parameters stay fixed when you randomize.';
  const syncLocks = () => {
    const shown = root.dataset.showLocks === 'true';
    root.dataset.showLocks = String(shown);
    toggleLocks.textContent = shown ? 'Hide parameter locks' : 'Show parameter locks';
    toggleLocks.setAttribute('aria-expanded', String(shown));
    lockHint.hidden = !shown;
  };
  toggleLocks.addEventListener('click', () => {
    root.dataset.showLocks = String(root.dataset.showLocks !== 'true');
    syncLocks();
  });
  syncLocks();
  lockTools.append(toggleLocks, lockHint);
  root.append(lockTools);
  const advanced = document.createElement('details');
  advanced.className = 'shader-advanced';
  advanced.open = wasOpen;
  const summary = document.createElement('summary');
  summary.textContent = 'Advanced';
  advanced.append(summary);
  const sections: HTMLFieldSetElement[] = [];
  const rows: ControlRow[] = [];
  const refreshVisibility = () => {
    const resolved = bindUniforms(definitions, resolveValues());
    rows.forEach(({ def, row }) => { row.hidden = !uniformVisible(def, resolved); });
    sections.forEach(section => { section.hidden = !section.querySelector('.shader-control:not([hidden])'); });
    advanced.hidden = !advanced.querySelector('fieldset:not([hidden])');
  };
  options.locks ??= new Set();
  const context: ControlContext = { options, values, resolveValues, refreshVisibility, onChange };
  for (const isAdvanced of [false, true]) {
    for (const group of ['Motion', 'Shape', 'Color'] as const) {
      const defs = definitions.filter(def => Boolean(def.advanced) === isAdvanced && (def.group ?? 'Shape') === group);
      if (!defs.length) continue;
      const built = buildGroup(group, defs, context);
      sections.push(built.section);
      rows.push(...built.rows);
      (isAdvanced ? advanced : root).append(built.section);
    }
  }
  root.append(advanced);
  refreshVisibility();
}
