// Puzzle library: metadata from puzzles/index.json, cell data from one .bin file per category.

export const EMPTY = 255;

export interface PuzzleMeta {
  id: string;
  title: string;
  artist: string;
  date: string;
  source: string;
  licence: string;
  level: 0 | 1 | 2;
  w: number;
  h: number;
  palette: string[];
  offset: number;
  category: string;
}

export interface Category {
  id: string;
  name: string;
  file: string;
  puzzles: PuzzleMeta[];
}

export interface Puzzle extends PuzzleMeta {
  cells: Uint8Array;
  /** Number of paintable (non-empty) cells. */
  total: number;
  /** Cells per palette index. */
  counts: number[];
}

let categories: Category[] = [];
const byId = new Map<string, PuzzleMeta>();
const bins = new Map<string, Promise<Uint8Array>>();

export async function loadLibrary(): Promise<Category[]> {
  if (categories.length) return categories;
  const res = await fetch('./puzzles/index.json');
  const index = (await res.json()) as { categories: Category[] };
  categories = index.categories;
  for (const c of categories) {
    for (const p of c.puzzles) {
      p.category = c.id;
      byId.set(p.id, p);
    }
  }
  return categories;
}

export const getCategories = () => categories;
export const getMeta = (id: string) => byId.get(id);
export const allPuzzles = () => categories.flatMap(c => c.puzzles);

function loadBin(cat: Category): Promise<Uint8Array> {
  let p = bins.get(cat.id);
  if (!p) {
    p = fetch('./puzzles/' + cat.file)
      .then(r => r.arrayBuffer())
      .then(b => new Uint8Array(b));
    bins.set(cat.id, p);
  }
  return p;
}

const cache = new Map<string, Puzzle>();

export async function loadPuzzle(id: string): Promise<Puzzle> {
  const hit = cache.get(id);
  if (hit) return hit;
  const meta = byId.get(id);
  if (!meta) throw new Error('Unknown puzzle ' + id);
  const cat = categories.find(c => c.id === meta.category)!;
  const bin = await loadBin(cat);
  const cells = bin.subarray(meta.offset, meta.offset + meta.w * meta.h);
  const counts = new Array(meta.palette.length).fill(0);
  let total = 0;
  for (const v of cells) {
    if (v !== EMPTY) {
      counts[v]++;
      total++;
    }
  }
  const puzzle = { ...meta, cells, total, counts };
  cache.set(id, puzzle);
  return puzzle;
}

/** Pick a stable "puzzle of the day" from the whole library. */
export function dailyPuzzle(date = new Date()): PuzzleMeta | undefined {
  const all = allPuzzles();
  if (!all.length) return undefined;
  const day = Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 86400000);
  let h = day * 2654435761;
  h = (h ^ (h >>> 13)) >>> 0;
  return all[h % all.length];
}

export const LEVELS = ['Easy', 'Medium', 'Hard'] as const;
