// Saved progress and settings, kept in localStorage (persists inside the Android WebView).

const PREFIX = 'pp:';

export interface Summary {
  filled: number;
  total: number;
  completed: boolean;
  updated: number;
}

export interface Settings {
  theme: string;
  vibrate: boolean;
  sound: boolean;
  showGrid: boolean;
  autoNext: boolean;
  skipVersion: string;
}

const defaults: Settings = {
  theme: 'daylight',
  vibrate: true,
  sound: true,
  showGrid: true,
  autoNext: true,
  skipVersion: '',
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: progress just won't persist */
  }
}

let settings: Settings = { ...defaults, ...read<Partial<Settings>>('settings', {}) };
let summaries: Record<string, Summary> = read('summaries', {});

export const getSettings = () => settings;
export function setSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  write('settings', settings);
}

export const getSummary = (id: string): Summary | undefined => summaries[id];
export const getSummaries = () => summaries;

function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Filled cells are stored as a bitset. */
export function loadFilled(id: string, size: number): Uint8Array {
  const filled = new Uint8Array(size);
  try {
    const raw = localStorage.getItem(PREFIX + 'p:' + id);
    if (raw) {
      const bits = fromBase64(raw);
      for (let i = 0; i < size; i++) if (bits[i >> 3] & (1 << (i & 7))) filled[i] = 1;
    }
  } catch {
    /* corrupt entry: start fresh */
  }
  return filled;
}

export function saveFilled(id: string, filled: Uint8Array, count: number, total: number) {
  const bits = new Uint8Array((filled.length + 7) >> 3);
  for (let i = 0; i < filled.length; i++) if (filled[i]) bits[i >> 3] |= 1 << (i & 7);
  try {
    localStorage.setItem(PREFIX + 'p:' + id, toBase64(bits));
  } catch {
    /* ignore */
  }
  summaries[id] = { filled: count, total, completed: count >= total, updated: Date.now() };
  write('summaries', summaries);
}

export function resetProgress(id: string) {
  try {
    localStorage.removeItem(PREFIX + 'p:' + id);
  } catch {
    /* ignore */
  }
  delete summaries[id];
  write('summaries', summaries);
}

export function getFavourites(): string[] {
  return read('favourites', []);
}

export function toggleFavourite(id: string): boolean {
  const favs = getFavourites();
  const i = favs.indexOf(id);
  if (i >= 0) favs.splice(i, 1);
  else favs.unshift(id);
  write('favourites', favs);
  return i < 0;
}
