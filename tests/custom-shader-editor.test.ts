// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mountShader } = vi.hoisted(() => ({ mountShader: vi.fn(() => vi.fn()) }));
vi.mock('../src/renderer/core/runtime', () => ({ mountShader }));

import { openCustomShaderEditor } from '../src/settings/custom-shader-editor';

function createGl() {
  const state = { compileOk: true, linkOk: true };
  return {
    state,
    createProgram: () => ({}),
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => state.compileOk,
    getShaderInfoLog: () => 'deliberate compile log',
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => state.linkOk,
    getProgramInfoLog: () => 'deliberate link log',
    deleteShader: () => {},
    deleteProgram: () => {},
    getExtension: () => null,
  };
}
const fakeGl = createGl();

function dialogElements() {
  const dialog = document.querySelector('dialog')!;
  return {
    dialog,
    title: dialog.querySelector<HTMLInputElement>('[data-custom-title]')!,
    source: dialog.querySelector<HTMLTextAreaElement>('[data-custom-source]')!,
    status: dialog.querySelector<HTMLElement>('[data-custom-status]')!,
    save: dialog.querySelector<HTMLButtonElement>('[data-custom-save]')!,
    test: dialog.querySelector<HTMLButtonElement>('[data-custom-test]')!,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  mountShader.mockClear();
  fakeGl.state.compileOk = true;
  fakeGl.state.linkOk = true;
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: vi.fn((type: string) => type === 'webgl2' || type === 'webgl' ? fakeGl : null) });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function showModal(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function close(this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')); } });
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'abc-123') });
});
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('openCustomShaderEditor', () => {
  it('previews a new shader and saves it', async () => {
    const save = vi.fn(async () => {});
    openCustomShaderEditor(undefined, save);
    const { dialog, title, test, status, save: saveButton } = dialogElements();
    expect(dialog.open).toBe(true);
    expect(title.value).toBe('My shader');
    test.click();
    expect(mountShader).toHaveBeenCalled();
    expect(status.textContent).toContain('Compiled successfully');
    saveButton.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'custom-abc-123' })));
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('reports schema, compile, link and WebGL failures', () => {
    openCustomShaderEditor(undefined, vi.fn(async () => {}));
    const { title, test, status, source } = dialogElements();
    title.value = '';
    test.click();
    expect(status.textContent).toBeTruthy();
    title.value = 'Broken';
    fakeGl.state.compileOk = false;
    test.click();
    expect(status.textContent).toContain('deliberate compile log');
    fakeGl.state.compileOk = true;
    fakeGl.state.linkOk = false;
    test.click();
    expect(status.textContent).toContain('deliberate link log');
    fakeGl.state.linkOk = true;
    source.value = 'void mainImage(out vec4 color, in vec2 fragCoord) { color = texture(iChannel0, fragCoord); }';
    test.click();
    expect(status.textContent).toContain('not supported');
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: vi.fn(() => null) });
    source.value = 'void mainImage(out vec4 color, in vec2 fragCoord) { color = vec4(1.0); }';
    test.click();
    expect(status.textContent).toContain('WebGL is unavailable');
  });

  it('imports a GLSL file into the editor', async () => {
    openCustomShaderEditor(undefined, vi.fn(async () => {}));
    const { title, status } = dialogElements();
    const input = document.querySelector<HTMLInputElement>('[data-custom-file]')!;
    const file = { name: 'Imported Shader.glsl', size: 42, text: async () => 'void mainImage(out vec4 color, in vec2 fragCoord) { color = vec4(1.0); }' };
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(title.value).toBe('Imported Shader'));
    expect(status.textContent).toContain('File imported');
  });

  it('rejects oversized files and recovers from save errors', async () => {
    const save = vi.fn(async () => { throw new Error('disk full'); });
    openCustomShaderEditor(undefined, save);
    const { status, save: saveButton } = dialogElements();
    const input = document.querySelector<HTMLInputElement>('[data-custom-file]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'big.glsl', size: 200_000, text: async () => '' }] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(status.textContent).toContain('100 KB'));
    saveButton.click();
    await vi.waitFor(() => expect(status.textContent).toBe('disk full'));
    expect(saveButton.disabled).toBe(false);
  });

  it('edits an existing shader without changing its identity and closes on cancel', () => {
    const save = vi.fn(async () => {});
    const existing = { id: 'custom-existing', title: 'Existing', source: 'void mainImage(out vec4 color, in vec2 fragCoord) { color = vec4(1.0); }' };
    openCustomShaderEditor(existing, save);
    const { dialog, title, source } = dialogElements();
    expect(title.value).toBe('Existing');
    expect(source.value).toBe(existing.source);
    title.value = 'Edited';
    dialog.querySelector<HTMLButtonElement>('[data-custom-cancel]')!.click();
    expect(document.querySelector('dialog')).toBeNull();
  });
});
