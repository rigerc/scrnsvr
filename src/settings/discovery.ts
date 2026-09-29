const FAVORITES_KEY = 'scrnsvr.gallery.favorites.v1';

type Filter = 'all' | 'favorites';

function readFavorites(): Set<string> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? '[]');
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((item): item is string => typeof item === 'string'));
  } catch {
    return new Set();
  }
}

function saveFavorites(favorites: Set<string>): boolean {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
    return true;
  } catch {
    return false;
  }
}

/** Adds search and personal favorites to a mounted shader gallery. */
export function mountDiscovery(root: HTMLElement): () => void {
  const bank = root.matches('.shader-bank') ? root : root.querySelector<HTMLElement>('.shader-bank');
  const categories = bank?.querySelector<HTMLElement>('.shader-categories');
  if (!bank || !categories) return () => undefined;
  const galleryRoot: HTMLElement = categories;

  const toolbar = document.createElement('div');
  toolbar.className = 'discovery-toolbar';

  const search = document.createElement('input');
  search.className = 'discovery-search';
  search.type = 'search';
  search.placeholder = 'Search visuals';
  search.setAttribute('aria-label', 'Search visuals');

  const filterGroup = document.createElement('div');
  filterGroup.className = 'discovery-filters';
  filterGroup.setAttribute('role', 'group');
  filterGroup.setAttribute('aria-label', 'Filter visuals');
  const allButton = document.createElement('button');
  allButton.type = 'button';
  allButton.className = 'discovery-filter';
  allButton.textContent = 'All';
  const favoritesButton = document.createElement('button');
  favoritesButton.type = 'button';
  favoritesButton.className = 'discovery-filter';
  favoritesButton.textContent = 'Favorites';
  filterGroup.append(allButton, favoritesButton);

  const count = document.createElement('p');
  count.className = 'discovery-count';
  count.setAttribute('role', 'status');
  count.setAttribute('aria-live', 'polite');
  const storageStatus = document.createElement('p');
  storageStatus.className = 'discovery-storage-status';
  storageStatus.setAttribute('role', 'status');
  storageStatus.setAttribute('aria-live', 'polite');
  storageStatus.hidden = true;
  const empty = document.createElement('div');
  empty.className = 'discovery-empty';
  empty.hidden = true;
  const emptyMessage = document.createElement('p');
  emptyMessage.textContent = 'No visuals match these filters.';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'discovery-clear';
  clear.textContent = 'Clear filters';
  empty.append(emptyMessage, clear);
  toolbar.append(search, filterGroup, count, storageStatus, empty);
  bank.insertBefore(toolbar, categories);

  let activeFilter: Filter = 'all';
  const favorites = readFavorites();
  const cards = Array.from(galleryRoot.querySelectorAll<HTMLElement>('.shader-card[data-id]'));

  for (const card of cards) {
    const id = card.dataset.id!;
    const select = card.querySelector<HTMLButtonElement>('.shader-select');
    if (!select) continue;
    const favorite = document.createElement('button');
    favorite.type = 'button';
    favorite.className = 'discovery-favorite';
    favorite.dataset.favoriteId = id;
    favorite.addEventListener('click', () => {
      if (favorites.has(id)) favorites.delete(id);
      else favorites.add(id);
      const saved = saveFavorites(favorites);
      storageStatus.textContent = saved ? '' : 'Favorites are available for this session only.';
      storageStatus.hidden = saved;
      render();
    });
    card.append(favorite);
  }

  const cardTitle = (card: HTMLElement) => card.dataset.title
    ?? card.querySelector('.shader-select strong')?.textContent
    ?? card.querySelector('.shader-select')?.getAttribute('aria-label')?.replace(/^Preview\s+/i, '')
    ?? card.dataset.id
    ?? '';

  function render(): void {
    const query = search.value.trim().toLocaleLowerCase();
    const focusedCard = document.activeElement?.closest('.shader-card') as HTMLElement | null | undefined;
    allButton.setAttribute('aria-pressed', String(activeFilter === 'all'));
    favoritesButton.setAttribute('aria-pressed', String(activeFilter === 'favorites'));
    const visibleBySection = new Map<HTMLElement, number>();
    let visible = 0;
    for (const card of cards) {
      const id = card.dataset.id ?? '';
      const section = card.closest('.shader-category') as HTMLElement | null;
      const title = cardTitle(card);
      const category = card.dataset.category ?? section?.dataset.category ?? section?.querySelector('h3')?.textContent ?? '';
      const searchable = [title, card.dataset.description, category].filter(Boolean).join(' ').toLocaleLowerCase();
      const matches = (!query || searchable.includes(query)) && (activeFilter === 'all' || favorites.has(id));
      card.hidden = !matches;
      const button = card.querySelector<HTMLButtonElement>('.discovery-favorite');
      if (button) {
        const isFavorite = favorites.has(id);
        button.textContent = isFavorite ? 'Remove favorite' : 'Add favorite';
        button.setAttribute('aria-label', `${isFavorite ? 'Remove' : 'Add'} ${title} ${isFavorite ? 'from' : 'to'} favorites`);
        button.setAttribute('aria-pressed', String(isFavorite));
      }
      if (matches) {
        visible++;
        if (section) visibleBySection.set(section, (visibleBySection.get(section) ?? 0) + 1);
      }
    }
    for (const section of Array.from(galleryRoot.querySelectorAll<HTMLElement>('.shader-category'))) {
      const sectionCount = visibleBySection.get(section) ?? 0;
      section.hidden = sectionCount === 0;
      const badge = section.querySelector<HTMLElement>('.shader-category-count');
      if (badge) {
        badge.textContent = String(sectionCount);
        badge.setAttribute('aria-label', `${sectionCount} ${sectionCount === 1 ? 'visual' : 'visuals'}`);
      }
    }
    count.textContent = `${visible} ${visible === 1 ? 'visual' : 'visuals'}`;
    empty.hidden = visible !== 0;
    if (focusedCard?.hidden) favoritesButton.focus();
  }

  allButton.setAttribute('aria-pressed', 'true');
  favoritesButton.setAttribute('aria-pressed', 'false');
  allButton.addEventListener('click', () => { activeFilter = 'all'; render(); });
  favoritesButton.addEventListener('click', () => { activeFilter = 'favorites'; render(); });
  search.addEventListener('input', render);
  clear.addEventListener('click', () => {
    search.value = '';
    activeFilter = 'all';
    render();
    search.focus();
  });
  render();

  return () => {
    for (const favorite of Array.from(bank.querySelectorAll('.discovery-favorite'))) favorite.remove();
    toolbar.remove();
  };
}
