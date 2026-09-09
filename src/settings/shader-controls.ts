import type { UniformManifest, UniformValue } from '../shared/manifest';
import { bindUniforms, snapUniformValue, uniformVisible } from '../renderer/core/uniforms';

export function mountShaderControls(
  root: HTMLElement,
  definitions: UniformManifest[],
  values: Record<string, UniformValue>,
  onChange: () => void,
) {
  const wasOpen = root.querySelector('details')?.open ?? false;
  root.replaceChildren();
  const title = document.createElement('h2');
  title.textContent = 'Adjust shader';
  root.append(title);
  const advanced = document.createElement('details');
  advanced.className = 'shader-advanced';
  advanced.open = wasOpen;
  const summary = document.createElement('summary');
  summary.textContent = 'Advanced';
  advanced.append(summary);
  const sections: HTMLFieldSetElement[] = [];
  const rows: Array<{ def: UniformManifest; row: HTMLElement }> = [];
  const refreshVisibility = () => {
    const resolved = bindUniforms(definitions, values);
    rows.forEach(({ def, row }) => { row.hidden = !uniformVisible(def, resolved); });
    sections.forEach(section => { section.hidden = !section.querySelector('.shader-control:not([hidden])'); });
    advanced.hidden = !advanced.querySelector('fieldset:not([hidden])');
  };
  for (const isAdvanced of [false, true]) {
    for (const group of ['Motion', 'Shape', 'Color'] as const) {
      const defs = definitions.filter(def => Boolean(def.advanced) === isAdvanced && (def.group ?? 'Shape') === group);
      if (!defs.length) continue;
      const section = document.createElement('fieldset');
      section.className = 'shader-control-group';
      const legend = document.createElement('legend');
      legend.textContent = group;
      section.append(legend);
      sections.push(section);
      (isAdvanced ? advanced : root).append(section);
      for (const def of defs) {
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
        heading.append(label, reset);
        row.append(heading);
        const description = document.createElement('p');
        description.id = `${id}-hint`;
        description.textContent = def.description ?? '';
        let input: HTMLInputElement | HTMLSelectElement;
        let number: HTMLInputElement | undefined;
        if (def.type === 'select') {
          input = document.createElement('select');
          for (const option of def.options ?? []) {
            const element = document.createElement('option');
            element.value = option;
            element.textContent = option.charAt(0).toUpperCase() + option.slice(1);
            input.append(element);
          }
        } else {
          input = document.createElement('input');
          input.type = def.type === 'bool' ? 'checkbox' : def.type === 'color' ? 'color' : 'range';
          if (def.type === 'float' || def.type === 'int') {
            number = document.createElement('input');
            number.type = 'number';
            number.setAttribute('aria-label', `${name} value${def.unit ? ` (${def.unit})` : ''}`);
            number.setAttribute('aria-describedby', description.id);
            for (const control of [input, number]) {
              control.min = String(def.min ?? 0);
              control.max = String(def.max ?? 1);
              control.step = String(def.step ?? (def.type === 'int' ? 1 : 0.01));
            }
          }
        }
        input.id = id;
        input.dataset.name = def.name;
        input.setAttribute('aria-describedby', description.id);
        const sync = () => {
          const value = bindUniforms([def], values)[def.name];
          input.value = String(value);
          if (input instanceof HTMLInputElement && def.type === 'bool') input.checked = Boolean(value);
          if (number) number.value = String(value);
          reset.disabled = value === def.default;
        };
        const commit = (value: unknown) => {
          values[def.name] = snapUniformValue(def, value);
          sync();
          refreshVisibility();
          onChange();
        };
        input.addEventListener('input', () => commit(input instanceof HTMLInputElement && def.type === 'bool' ? input.checked : input.value));
        // Preserve intermediate text such as "-" or "0." until direct entry is committed.
        number?.addEventListener('change', () => commit(number!.value));
        number?.addEventListener('blur', sync);
        number?.addEventListener('keydown', event => {
          if (event.key === 'Enter') { commit(number!.value); event.preventDefault(); }
        });
        reset.addEventListener('click', () => {
          delete values[def.name];
          sync();
          refreshVisibility();
          onChange();
        });
        const inputs = document.createElement('div');
        inputs.className = 'shader-control-inputs';
        inputs.append(input);
        if (number) inputs.append(number);
        row.append(inputs, description);
        section.append(row);
        rows.push({ def, row });
        sync();
      }
    }
  }
  root.append(advanced);
  refreshVisibility();
}
