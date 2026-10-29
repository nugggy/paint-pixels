// Downloads candidate images and converts them into pixel colour-by-number puzzles.
// Output: public/puzzles/index.json (metadata) + public/puzzles/<category>.bin (cell data).
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve('.');
const CACHE = path.join(ROOT, 'tools/cache');
const RAW = path.join(CACHE, 'raw');
const OUT = path.join(ROOT, 'public/puzzles');
const SHEETS = path.join(CACHE, 'sheets');
const UA = 'PaintPixels/1.0 (https://github.com/nugggy/paint-pixels)';
const EMPTY = 255;
const MAX_PER_CATEGORY = 160;

const candidates = JSON.parse(await fs.readFile(path.join(CACHE, 'candidates.json'), 'utf8'));
const rejects = new Set(
  existsSync(path.join(ROOT, 'tools/rejects.txt'))
    ? (await fs.readFile(path.join(ROOT, 'tools/rejects.txt'), 'utf8')).split('\n').map(l => l.split(' ')[0]).filter(Boolean)
    : [],
);
// After manual review, only approved images are built (one "key title" per line).
const approvedFile = path.join(ROOT, 'tools/approved.txt');
const approved = existsSync(approvedFile)
  ? new Set((await fs.readFile(approvedFile, 'utf8')).split('\n').map(l => l.split(' ')[0]).filter(Boolean))
  : null;
await fs.mkdir(RAW, { recursive: true });
await fs.mkdir(OUT, { recursive: true });
await fs.mkdir(SHEETS, { recursive: true });

// ---------- colour helpers ----------
function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function rgbToLab(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

// Seeded RNG so builds are reproducible.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function hashStr(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function kmeans(points, k, rand) {
  // k-means++ initialisation
  const centres = [points[Math.floor(rand() * points.length)].slice()];
  const d = new Float64Array(points.length).fill(Infinity);
  while (centres.length < k) {
    let sum = 0;
    const last = centres[centres.length - 1];
    for (let i = 0; i < points.length; i++) {
      d[i] = Math.min(d[i], dist2(points[i], last));
      sum += d[i];
    }
    if (sum === 0) break;
    let t = rand() * sum;
    let i = 0;
    for (; i < points.length - 1 && t > d[i]; i++) t -= d[i];
    centres.push(points[i].slice());
  }
  const assign = new Int32Array(points.length);
  for (let iter = 0; iter < 20; iter++) {
    let moved = 0;
    for (let i = 0; i < points.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const dd = dist2(points[i], centres[c]);
        if (dd < bd) { bd = dd; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; moved++; }
    }
    const acc = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < points.length; i++) {
      const a = acc[assign[i]];
      a[0] += points[i][0]; a[1] += points[i][1]; a[2] += points[i][2]; a[3]++;
    }
    acc.forEach((a, c) => { if (a[3]) centres[c] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
    if (moved === 0) break;
  }
  return centres;
}

// ---------- download ----------
async function download(item) {
  const file = path.join(RAW, item.key);
  if (existsSync(file)) return fs.readFile(file);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(item.url, { headers: { 'User-Agent': UA } });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(file, buf);
        return buf;
      }
      if (res.status === 404) return null;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    } catch {
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return null;
}

// ---------- conversion ----------
const SIZES = { art: [56, 76, 100], clip: [40, 56, 72] };
const COLOURS = { art: [12, 18, 24], clip: [8, 12, 16] };

// Plates and clip art often sit on plain paper (sometimes photographed on a grey table):
// repeatedly flood-fill the background from the edges, drop small specks such as captions,
// make the background transparent and crop to the subject.
async function cutOut(buf) {
  const { data, info } = await sharp(buf).flatten({ background: '#ffffff' }).ensureAlpha()
    .resize(320, 320, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const labs = new Array(W * H);
  for (let i = 0; i < W * H; i++) labs[i] = rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const bg = new Uint8Array(W * H);
  let removedAny = false;

  for (let pass = 0; pass < 4; pass++) {
    // Border of the region that is still foreground.
    const edge = [];
    for (let i = 0; i < W * H; i++) {
      if (bg[i]) continue;
      const x = i % W, y = (i / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || bg[i - 1] || bg[i + 1] || bg[i - W] || bg[i + W]) edge.push(i);
    }
    if (!edge.length) break;
    const el = edge.map(i => labs[i]);
    const med = [0, 1, 2].map(k => el.map(p => p[k]).sort((a, b) => a - b)[el.length >> 1]);
    const near = el.filter(p => dist2(p, med) < 14 ** 2).length / el.length;
    if (near < 0.55 || med[0] < 45) break; // what's left at the edge is the subject itself
    const stack = edge.filter(i => dist2(labs[i], med) < 16 ** 2);
    let added = 0;
    for (const i of stack) { bg[i] = 2; added++; }
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j < 0 || bg[j]) continue;
        if (dist2(labs[j], med) < 16 ** 2) { bg[j] = 2; added++; stack.push(j); }
      }
    }
    for (let i = 0; i < W * H; i++) if (bg[i] === 2) bg[i] = 1;
    if (added < W * H * 0.01) break;
    removedAny = true;
  }
  if (!removedAny) return null;

  // Keep only sizeable connected pieces of the subject.
  const comp = new Int32Array(W * H).fill(-1);
  const sizes = [];
  for (let s = 0; s < W * H; s++) {
    if (bg[s] || comp[s] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    const st = [s];
    comp[s] = id;
    while (st.length) {
      const i = st.pop(), x = i % W, y = (i / W) | 0;
      n++;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && !bg[j] && comp[j] < 0) { comp[j] = id; st.push(j); }
      }
    }
    sizes.push(n);
  }
  const biggest = Math.max(0, ...sizes);
  const minKeep = Math.max(30, biggest * 0.04);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < W * H; i++) {
    if (bg[i] || sizes[comp[i]] < minKeep) { data[i * 4 + 3] = 0; continue; }
    const x = i % W, y = (i / W) | 0;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (x1 < 0 || (x1 - x0) * (y1 - y0) < W * H * 0.04) return null;
  const pad = 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  return sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toBuffer();
}

async function convert(item, buf, difficulty) {
  const kind = item.source === 'commons' ? 'clip' : item.source === 'plate' ? 'plate' : 'art';
  const conf = kind === 'clip' ? 'clip' : 'art';
  const side = SIZES[conf][difficulty];
  if ((kind === 'plate' && !item.nocut) || kind === 'clip') {
    const cut = await cutOut(buf);
    if (cut) buf = cut;
  }
  const meta = await sharp(buf).metadata();
  const ratio = meta.width / meta.height;
  if (ratio > 2.2 || ratio < 0.45) return { reject: 'odd shape' };
  const w = ratio >= 1 ? side : Math.max(8, Math.round(side * ratio));
  const h = ratio >= 1 ? Math.max(8, Math.round(side / ratio)) : side;

  let img = sharp(buf).ensureAlpha();
  if (kind !== 'clip') img = img.modulate({ saturation: 1.2 }); // old scans tend to be a little flat
  const { data } = await img
    .resize(w, h, { fit: 'fill', kernel: kind === 'clip' ? 'cubic' : 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const labs = [];
  const index = new Int32Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] < 128) continue;
    index[i] = labs.length;
    labs.push(rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]));
  }
  if (labs.length < w * h * (kind === 'plate' ? 0.3 : 0.2)) return { reject: 'too empty' };

  const rand = rng(hashStr(item.key));
  let centres = kmeans(labs, COLOURS[conf][difficulty], rand);

  // Merge colours people couldn't tell apart.
  const mergeLimit = 8 ** 2;
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let a = 0; a < centres.length; a++) {
      for (let b = a + 1; b < centres.length; b++) {
        if (dist2(centres[a], centres[b]) < mergeLimit) {
          centres[a] = centres[a].map((v, i) => (v + centres[b][i]) / 2);
          centres.splice(b, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  const nearest = p => {
    let best = 0, bd = Infinity;
    for (let c = 0; c < centres.length; c++) {
      const dd = dist2(p, centres[c]);
      if (dd < bd) { bd = dd; best = c; }
    }
    return best;
  };
  let cells = new Uint8Array(w * h).fill(EMPTY);
  for (let i = 0; i < w * h; i++) if (index[i] >= 0) cells[i] = nearest(labs[index[i]]);

  // Drop colours that cover almost nothing, then reassign.
  const count = () => {
    const n = new Array(centres.length).fill(0);
    for (const v of cells) if (v !== EMPTY) n[v]++;
    return n;
  };
  let counts = count();
  const minCells = Math.max(4, labs.length * 0.004);
  const keep = centres.map((_, c) => counts[c] >= minCells);
  if (keep.some(k => !k)) {
    centres = centres.filter((_, c) => keep[c]);
    for (let i = 0; i < w * h; i++) if (index[i] >= 0) cells[i] = nearest(labs[index[i]]);
  }

  // Despeckle: a lone cell surrounded by one other colour takes that colour.
  const next = cells.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, v = cells[i];
      if (v === EMPTY) continue;
      const nb = [];
      if (x > 0) nb.push(cells[i - 1]);
      if (x < w - 1) nb.push(cells[i + 1]);
      if (y > 0) nb.push(cells[i - w]);
      if (y < h - 1) nb.push(cells[i + w]);
      if (nb.length === 4 && nb.every(n => n === nb[0] && n !== v && n !== EMPTY)) next[i] = nb[0];
    }
  }
  cells = next;
  counts = count();

  // Quality gates.
  const used = centres.map((_, c) => counts[c] > 0);
  if (used.filter(Boolean).length < 4) return { reject: 'too few colours' };
  let colourful = 0;
  for (const p of labs) if (Math.hypot(p[1], p[2]) > 20) colourful++;
  if (colourful / labs.length < (kind === 'plate' ? 0.2 : kind === 'art' ? 0.3 : 0)) return { reject: 'not colourful' };
  if (kind !== 'clip' && Math.max(...counts) > labs.length * (kind === 'plate' ? 0.6 : 0.5)) return { reject: 'one colour dominates' };
  const lightness = centres.map(c => c[0]);
  if (Math.max(...lightness) - Math.min(...lightness) < 30) return { reject: 'low contrast' };

  // Order palette from dark to light, grouped roughly by hue, for a tidy palette bar.
  const order = centres
    .map((c, i) => ({ c, i, hue: Math.atan2(c[2], c[1]), chroma: Math.hypot(c[1], c[2]) }))
    .filter(o => counts[o.i] > 0)
    .sort((a, b) => {
      const ga = a.chroma < 12 ? -10 : Math.floor(((a.hue + Math.PI) / (2 * Math.PI)) * 8);
      const gb = b.chroma < 12 ? -10 : Math.floor(((b.hue + Math.PI) / (2 * Math.PI)) * 8);
      return ga - gb || a.c[0] - b.c[0];
    });
  const remap = new Map(order.map((o, n) => [o.i, n]));
  for (let i = 0; i < cells.length; i++) if (cells[i] !== EMPTY) cells[i] = remap.get(cells[i]);
  const palette = order.map(o => hex(labToRgb(o.c)));
  return { w, h, palette, cells };
}

function labToRgb([L, A, B]) {
  let y = (L + 16) / 116, x = A / 500 + y, z = y - B / 200;
  const f = t => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  x = f(x) * 0.95047; y = f(y); z = f(z) * 1.08883;
  const lin = [x * 3.2406 + y * -1.5372 + z * -0.4986, x * -0.9689 + y * 1.8758 + z * 0.0415, x * 0.0557 + y * -0.204 + z * 1.057];
  return lin.map(c => {
    c = Math.max(0, Math.min(1, c));
    return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  });
}

// ---------- contact sheets for manual review ----------
async function contactSheet(name, entries) {
  const T = 120, COLS = 10;
  const rows = Math.ceil(entries.length / COLS);
  const composites = [];
  for (let n = 0; n < entries.length; n++) {
    const { puzzle, key } = entries[n];
    const rgba = Buffer.alloc(puzzle.w * puzzle.h * 4);
    const pal = puzzle.palette.map(p => [1, 3, 5].map(o => parseInt(p.slice(o, o + 2), 16)));
    puzzle.cells.forEach((v, i) => {
      if (v === EMPTY) { rgba.set([235, 235, 235, 255], i * 4); return; }
      rgba.set([...pal[v], 255], i * 4);
    });
    const tile = await sharp(rgba, { raw: { width: puzzle.w, height: puzzle.h, channels: 4 } })
      .resize(T - 4, T - 18, { fit: 'contain', kernel: 'nearest', background: '#fff' })
      .png().toBuffer();
    const label = Buffer.from(`<svg width="${T}" height="16"><text x="2" y="12" font-size="11" font-family="Arial">${n}</text></svg>`);
    composites.push({ input: tile, left: (n % COLS) * T + 2, top: Math.floor(n / COLS) * T + 16 });
    composites.push({ input: label, left: (n % COLS) * T, top: Math.floor(n / COLS) * T });
  }
  await sharp({ create: { width: COLS * T, height: rows * T, channels: 3, background: '#fff' } })
    .composite(composites).jpeg({ quality: 80 }).toFile(path.join(SHEETS, name + '.jpg'));
}

// Long book titles read badly on cards: keep the part before the first break.
function shortTitle(t) {
  t = t.replace(/[_\s]+/g, ' ').trim();
  const first = t.split(/[,:;(]| - | – /)[0].trim();
  if (first.length >= 4) t = first;
  return t.length > 48 ? t.slice(0, 46).replace(/\s+\S*$/, '') + '…' : t;
}

// Titles that are file names or repeat a book title are replaced with "Category 12".
function niceTitles(catName, titles) {
  const freq = new Map();
  for (const t of titles) freq.set(t, (freq.get(t) || 0) + 1);
  let n = 0;
  return titles.map(t => {
    const fileLike = /\d{3,}|[a-z][A-Z]/.test(t) || /^(illustration|plate|image|file)\b/i.test(t) || t.length < 4;
    const generic = freq.get(t) > 1 || /^(beatrix potter|walter ?crane|john gould|japanese|kunstformen der natur|ichthyologie)$/i.test(t);
    return fileLike || generic ? `${catName} ${++n}` : t;
  });
}

// ---------- main ----------
async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

const index = { version: 1, generated: new Date().toISOString().slice(0, 10), categories: [] };
const sheetIndex = {};
let total = 0;
const reasons = {};
for (const cat of candidates.categories) {
  const items = cat.items.filter(i => !rejects.has(i.key) && (!approved || approved.has(i.key)));
  const results = await pool(items, 6, async (item, i) => {
    const buf = await download(item);
    if (!buf) return { reject: 'download failed' };
    try {
      return await convert(item, buf, hashStr(item.key) % 3);
    } catch (e) {
      return { reject: 'convert error ' + e.message };
    }
  });
  const good = [];
  results.forEach((r, i) => {
    if (r.reject) { reasons[r.reject] = (reasons[r.reject] || 0) + 1; return; }
    if (approved || good.length < MAX_PER_CATEGORY) good.push({ item: items[i], puzzle: r, difficulty: hashStr(items[i].key) % 3 });
  });

  if (good.length < 12) {
    console.log(`${cat.id}: only ${good.length} usable, category skipped`);
    continue;
  }
  // Binary layout: puzzles back to back, one byte per cell.
  const bin = Buffer.concat(good.map(g => Buffer.from(g.puzzle.cells)));
  await fs.writeFile(path.join(OUT, cat.id + '.bin'), bin);
  const titles = niceTitles(cat.name, good.map(g => shortTitle(g.item.title)));
  let offset = 0;
  index.categories.push({
    id: cat.id,
    name: cat.name,
    file: cat.id + '.bin',
    puzzles: good.map((g, n) => {
      const p = {
        id: g.item.key,
        title: titles[n],
        artist: g.item.artist,
        date: g.item.date,
        source: g.item.page,
        licence: g.item.licence,
        level: g.difficulty,
        w: g.puzzle.w,
        h: g.puzzle.h,
        palette: g.puzzle.palette,
        offset,
      };
      offset += g.puzzle.w * g.puzzle.h;
      return p;
    }),
  });
  for (let s = 0; s * 100 < good.length; s++) {
    const slice = good.slice(s * 100, s * 100 + 100);
    await contactSheet(`${cat.id}-${s}`, slice.map(g => ({ puzzle: g.puzzle, key: g.item.key })));
    sheetIndex[`${cat.id}-${s}`] = slice.map(g => g.item.key + ' ' + g.item.title);
  }
  total += good.length;
  console.log(`${cat.id}: ${good.length} puzzles (${(bin.length / 1024).toFixed(0)} KB)`);
}
await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify(index));
await fs.writeFile(path.join(SHEETS, 'index.json'), JSON.stringify(sheetIndex, null, 1));
console.log('total puzzles', total, 'rejected', reasons);
