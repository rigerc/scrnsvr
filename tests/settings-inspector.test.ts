// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountShaderControls } from '../src/settings/shader-controls';
import type { UniformManifest } from '../src/shared/manifest';

const speed: UniformManifest = {
  name: 'speed', type: 'float', default: 1, min: 0, max: 3, step: 0.1,
  label: 'Speed', description: 'Motion speed', group: 'Motion',
};
afterEach(() => document.body.replaceChildren());

function controls() {
  const root = document.createElement('div');
  root.className = 'controls';
  document.body.append(root);
  return root;
}

describe('shader inspector controls', () => {
  it('starts with parameter locks collapsed and preserves the expanded state on remount', () => {
    const root = controls();
    const values = { speed: 1 };
    const mount = () => mountShaderControls(root, [speed], values, vi.fn());
    mount();

    const toggle = root.querySelector<HTMLButtonElement>('.parameter-lock-toggle')!;
    expect(root.dataset.showLocks).toBe('false');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('.parameter-lock-tools p')!.hidden).toBe(true);
    expect(root.querySelector('.uniform-lock')).toBeTruthy();

    toggle.click();
    expect(root.dataset.showLocks).toBe('true');
    mount();
    expect(root.querySelector<HTMLButtonElement>('.parameter-lock-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('.parameter-lock-tools p')!.hidden).toBe(false);
  });

  it('keeps a parameter lock selected when controls are remounted', () => {
    const root = controls();
    const values = { speed: 1 };
    const locks = new Set<string>();
    const mount = () => mountShaderControls(root, [speed], values, vi.fn(), () => values, { locks });
    mount();
    root.querySelector<HTMLButtonElement>('.uniform-lock')!.click();

    expect(locks.has('speed')).toBe(true);
    mount();
    const lock = root.querySelector<HTMLButtonElement>('.uniform-lock')!;
    expect(lock.getAttribute('aria-pressed')).toBe('true');
    expect(lock.textContent).toBe('Locked');
    lock.focus();
    lock.click();
    expect(document.activeElement).toBe(root.querySelector('[data-name="speed"]'));
  });

  it('clears a changed override when Reset is pressed', () => {
    const root = controls();
    const values: Record<string, number> = { speed: 2 };
    mountShaderControls(root, [speed], values, vi.fn(), () => values);
    const number = root.querySelector<HTMLInputElement>('[data-name="speed"] + input[type="number"]')!;
    number.value = '2.4';
    number.dispatchEvent(new Event('change', { bubbles: true }));
    expect(values.speed).toBe(2.4);

    root.querySelector<HTMLButtonElement>('.uniform-reset')!.click();
    expect(Object.hasOwn(values, 'speed')).toBe(false);
    expect(root.querySelector<HTMLInputElement>('[data-name="speed"]')!.value).toBe('1');
    expect(root.querySelector<HTMLButtonElement>('.uniform-reset')!.disabled).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('[data-name="speed"]'));
  });
});
