// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDiscovery } from '../src/settings/discovery';

function gallery(): HTMLElement {
  const bank = document.createElement('aside');
  bank.className = 'shader-bank';
  bank.innerHTML = `<div class="shader-categories">
    <section class="shader-category" data-category="Ambient"><h3>Ambient <span class="shader-category-count" aria-label="2 shaders">2</span></h3><div class="gallery">
      <div class="shader-card" data-id="aurora" data-category="Polar" data-description="Northern lights"><button class="shader-select" data-id="aurora" aria-label="Preview Aurora"><strong>Aurora</strong></button></div>
      <div class="shader-card" data-id="plasma" data-description="Colorful waves"><button class="shader-select" data-id="plasma" aria-label="Preview Plasma"><strong>Plasma</strong></button></div>
    </div></section>
    <section class="shader-category" data-category="Reactive"><h3>Reactive <span class="shader-category-count" aria-label="1 shader">1</span></h3><div class="gallery">
      <div class="shader-card" data-id="pulse" data-description="Audio rings"><button class="shader-select" data-id="pulse" aria-label="Preview Pulse"><strong>Pulse</strong></button></div>
    </div></section>
  </div>`;
  document.body.append(bank);
  return bank;
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe('shader gallery discovery', () => {
  it('filters by title, description, and category without selecting a shader', () => {
    const root = gallery();
    let selected = '';
    root.querySelectorAll<HTMLButtonElement>('.shader-select').forEach(button => {
      button.addEventListener('click', () => { selected = button.dataset.id ?? ''; });
    });
    mountDiscovery(root);

    const search = root.querySelector<HTMLInputElement>('.discovery-search')!;
    search.value = 'northern';
    search.dispatchEvent(new Event('input'));
    expect(root.querySelector('.shader-card[data-id="aurora"]')!.hidden).toBe(false);
    expect(root.querySelector('.shader-card[data-id="plasma"]')!.hidden).toBe(true);
    expect(root.querySelector('.shader-category[data-category="Reactive"]')!.hidden).toBe(true);
    expect(root.querySelector('.discovery-count')?.textContent).toBe('1 visual');
    expect(root.querySelector('.shader-category[data-category="Ambient"] .shader-category-count')?.textContent).toBe('1');
    expect(root.querySelector('.shader-category[data-category="Ambient"] .shader-category-count')?.getAttribute('aria-label')).toBe('1 visual');
    expect(selected).toBe('');

    search.value = 'reactive';
    search.dispatchEvent(new Event('input'));
    expect(root.querySelector('.shader-card[data-id="pulse"]')!.hidden).toBe(false);
    search.value = 'polar';
    search.dispatchEvent(new Event('input'));
    expect(root.querySelector('.shader-card[data-id="aurora"]')!.hidden).toBe(false);
    expect(root.querySelector('.shader-card[data-id="plasma"]')!.hidden).toBe(true);

    root.querySelector<HTMLButtonElement>('.discovery-clear')!.click();
    expect(root.querySelector('.shader-category[data-category="Ambient"] .shader-category-count')?.textContent).toBe('2');
    expect(root.querySelector('.shader-category[data-category="Ambient"] .shader-category-count')?.getAttribute('aria-label')).toBe('2 visuals');
  });

  it('persists favorites, filters to them, and restores focus if a toggle hides its card', () => {
    const root = gallery();
    const remove = mountDiscovery(root);
    const favorite = root.querySelector<HTMLButtonElement>('[data-favorite-id="aurora"]')!;
    favorite.click();
    expect(JSON.parse(window.localStorage.getItem('scrnsvr.gallery.favorites.v1')!)).toEqual(['aurora']);

    root.querySelector<HTMLButtonElement>('.discovery-filter:nth-child(2)')!.click();
    expect(root.querySelector('.shader-card[data-id="aurora"]')!.hidden).toBe(false);
    expect(root.querySelector('.shader-card[data-id="plasma"]')!.hidden).toBe(true);
    const removeFavorite = root.querySelector<HTMLButtonElement>('[data-favorite-id="aurora"]')!;
    removeFavorite.focus();
    removeFavorite.click();
    expect(document.activeElement).toBe(root.querySelector('.discovery-filter:nth-child(2)'));
    expect(root.querySelector('.discovery-empty')!.hidden).toBe(false);

    remove();
    const restored = gallery();
    mountDiscovery(restored);
    restored.querySelector<HTMLButtonElement>('.discovery-filter:nth-child(2)')!.click();
    expect(restored.querySelector('.discovery-empty')!.hidden).toBe(false);
  });

  it('recovers from malformed stored favorites and offers a clear action for empty results', () => {
    window.localStorage.setItem('scrnsvr.gallery.favorites.v1', '{broken');
    const root = gallery();
    mountDiscovery(root);
    root.querySelector<HTMLButtonElement>('.discovery-filter:nth-child(2)')!.click();
    expect(root.querySelector('.discovery-count')?.textContent).toBe('0 visuals');

    const search = root.querySelector<HTMLInputElement>('.discovery-search')!;
    root.querySelector<HTMLButtonElement>('.discovery-clear')!.click();
    expect(search.value).toBe('');
    expect(search).toBe(document.activeElement);
    expect(root.querySelectorAll('.shader-card[hidden]')).toHaveLength(0);
  });

  it('announces when favorites cannot be saved while keeping them available for this session', () => {
    const root = gallery();
    mountDiscovery(root);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });

    root.querySelector<HTMLButtonElement>('[data-favorite-id="aurora"]')!.click();
    expect(root.querySelector('[data-favorite-id="aurora"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.discovery-storage-status')?.textContent).toBe('Favorites are available for this session only.');
    expect(root.querySelector('.discovery-storage-status')?.getAttribute('role')).toBe('status');
  });
});
