// Interactive pixel board: renders the puzzle on a canvas and handles zoom, pan and painting.
import { EMPTY, type Puzzle } from './data';

export interface BoardCallbacks {
  onFill(colour: number, filled: number): void;
  onColourDone(colour: number): void;
  onComplete(): void;
  onWrong(): void;
  onPick(colour: number): void;
  onZoom?(scale: number): void;
}

const NUMBER_ZOOM = 15; // CSS px per cell before numbers appear
const GRID_ZOOM = 7;
const MAX_ZOOM = 64;
const LONG_PRESS_MS = 420;

export function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map(o => parseInt(hex.slice(o, o + 2), 16)) as [number, number, number];
}

const luminance = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export class Board {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private base = document.createElement('canvas');
  private baseCtx = this.base.getContext('2d')!;
  private img: ImageData;
  private rgb: [number, number, number][];
  private grey: number[];
  private dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  private viewW = 0;
  private viewH = 0;
  scale = 1;
  private tx = 0;
  private ty = 0;
  private minScale = 1;
  selected = 0;
  filledCount = 0;
  doneByColour: number[];
  private dirty = true;
  private raf = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture:
    | { kind: 'none' }
    | { kind: 'pending'; x: number; y: number; cell: number; timer: number }
    | { kind: 'paint'; lastX: number; lastY: number }
    | { kind: 'pan'; x: number; y: number }
    | { kind: 'pinch'; dist: number; scale: number; mid: { x: number; y: number }; gx: number; gy: number } = { kind: 'none' };
  private lastTap = { t: 0, x: 0, y: 0 };
  private pulse: { cell: number; start: number } | null = null;
  private anim: { from: number[]; to: number[]; start: number; dur: number } | null = null;
  private resizeObs: ResizeObserver;
  showGrid = true;
  private colours = { bg: '#f3efe8', gridLine: 'rgba(0,0,0,0.12)', text: '#5b5560', selText: '#ffffff', sel: '#8a84a8' };

  constructor(
    private host: HTMLElement,
    readonly puzzle: Puzzle,
    readonly filled: Uint8Array,
    private cb: BoardCallbacks,
  ) {
    const { w, h, palette, cells } = puzzle;
    this.rgb = palette.map(hexToRgb);
    // Unpainted cells show a pale grey version of the picture so the shape is readable.
    this.grey = this.rgb.map(c => Math.round(172 + (luminance(c) / 255) * 78));
    this.base.width = w;
    this.base.height = h;
    this.img = this.baseCtx.createImageData(w, h);
    this.doneByColour = new Array(palette.length).fill(0);
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== EMPTY && filled[i]) {
        this.filledCount++;
        this.doneByColour[cells[i]]++;
      }
    }
    this.canvas.className = 'board-canvas';
    this.canvas.style.touchAction = 'none';
    host.appendChild(this.canvas);
    this.readTheme();
    this.rebuildBase();
    this.bind();
    this.resizeObs = new ResizeObserver(() => this.resize(false));
    this.resizeObs.observe(host);
    this.resize(true);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.canvas.remove();
  }

  readTheme() {
    const s = getComputedStyle(document.documentElement);
    const v = (n: string, f: string) => s.getPropertyValue(n).trim() || f;
    this.colours = {
      bg: v('--board-bg', '#f3efe8'),
      gridLine: v('--board-grid', 'rgba(0,0,0,0.12)'),
      text: v('--board-text', '#5b5560'),
      selText: '#ffffff',
      sel: v('--board-sel', '#8a84a8'),
    };
    this.rebuildBase();
  }

  private cellRgb(i: number): [number, number, number, number] {
    const v = this.puzzle.cells[i];
    if (v === EMPTY) return [0, 0, 0, 0];
    if (this.filled[i]) return [...this.rgb[v], 255];
    if (v === this.selected) {
      const [r, g, b] = hexToRgb(this.colours.sel.startsWith('#') ? this.colours.sel : '#8a84a8');
      return [r, g, b, 255];
    }
    const g = this.grey[v];
    return [g, g, g, 255];
  }

  private rebuildBase() {
    if (!this.img) return;
    const d = this.img.data;
    for (let i = 0; i < this.puzzle.cells.length; i++) d.set(this.cellRgb(i), i * 4);
    this.baseCtx.putImageData(this.img, 0, 0);
    this.invalidate();
  }

  private updateCell(i: number) {
    const px = this.cellRgb(i);
    this.img.data.set(px, i * 4);
    const x = i % this.puzzle.w;
    const y = (i / this.puzzle.w) | 0;
    this.baseCtx.putImageData(this.img, 0, 0, x, y, 1, 1);
    this.invalidate();
  }

  select(colour: number) {
    this.selected = colour;
    this.rebuildBase();
  }

  invalidate() {
    if (this.dirty && this.raf) return;
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.draw());
  }

  private resize(initial: boolean) {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const oldW = this.viewW, oldH = this.viewH;
    this.viewW = r.width;
    this.viewH = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    const fit = Math.min(r.width / this.puzzle.w, r.height / this.puzzle.h) * 0.92;
    this.minScale = fit * 0.6;
    if (initial || !oldW) {
      this.scale = fit;
      this.tx = (r.width - this.puzzle.w * fit) / 2;
      this.ty = (r.height - this.puzzle.h * fit) / 2;
    } else {
      this.tx += (r.width - oldW) / 2;
      this.ty += (r.height - oldH) / 2;
    }
    this.clamp();
    this.invalidate();
  }

  fit() {
    const s = Math.min(this.viewW / this.puzzle.w, this.viewH / this.puzzle.h) * 0.92;
    this.animateTo(s, (this.viewW - this.puzzle.w * s) / 2, (this.viewH - this.puzzle.h * s) / 2);
  }

  private clamp() {
    const W = this.puzzle.w * this.scale, H = this.puzzle.h * this.scale;
    const m = 60;
    this.tx = Math.min(this.viewW - m, Math.max(m - W, this.tx));
    this.ty = Math.min(this.viewH - m, Math.max(m - H, this.ty));
  }

  private draw() {
    this.raf = 0;
    const now = performance.now();
    if (this.anim) {
      const t = Math.min(1, (now - this.anim.start) / this.anim.dur);
      const e = 1 - Math.pow(1 - t, 3);
      [this.scale, this.tx, this.ty] = this.anim.from.map((f, k) => f + (this.anim!.to[k] - f) * e);
      if (t >= 1) this.anim = null;
      this.cb.onZoom?.(this.scale);
    }
    this.dirty = false;
    const { ctx, dpr, scale, tx, ty } = this;
    const { w, h, cells } = this.puzzle;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.colours.bg;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, tx, ty, w * scale, h * scale);

    const x0 = Math.max(0, Math.floor(-tx / scale));
    const y0 = Math.max(0, Math.floor(-ty / scale));
    const x1 = Math.min(w - 1, Math.floor((this.viewW - tx) / scale));
    const y1 = Math.min(h - 1, Math.floor((this.viewH - ty) / scale));

    if (this.showGrid && scale >= GRID_ZOOM) {
      ctx.strokeStyle = this.colours.gridLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * w + x;
          if (cells[i] === EMPTY || this.filled[i]) continue;
          ctx.rect(Math.round(tx + x * scale) + 0.5, Math.round(ty + y * scale) + 0.5, Math.round(scale), Math.round(scale));
        }
      }
      ctx.stroke();
    }

    if (scale >= NUMBER_ZOOM) {
      const size = Math.min(22, scale * 0.48);
      ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * w + x;
          const v = cells[i];
          if (v === EMPTY || this.filled[i]) continue;
          ctx.fillStyle = v === this.selected ? this.colours.selText : this.colours.text;
          ctx.fillText(String(v + 1), tx + (x + 0.5) * scale, ty + (y + 0.54) * scale);
        }
      }
    }

    if (this.pulse) {
      const t = (now - this.pulse.start) / 1600;
      if (t < 1) {
        const x = this.pulse.cell % w, y = (this.pulse.cell / w) | 0;
        const cx = tx + (x + 0.5) * scale, cy = ty + (y + 0.5) * scale;
        for (const k of [0, 0.33]) {
          const p = (t * 2 + k) % 1;
          ctx.strokeStyle = `rgba(255,120,80,${1 - p})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cx, cy, scale * 0.6 + p * scale * 2.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        this.invalidate();
      } else {
        this.pulse = null;
      }
    }
    if (this.anim) this.invalidate();
  }

  // ---------- coordinates ----------
  private local(e: PointerEvent | WheelEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private cellAt(x: number, y: number): number {
    const cx = Math.floor((x - this.tx) / this.scale);
    const cy = Math.floor((y - this.ty) / this.scale);
    if (cx < 0 || cy < 0 || cx >= this.puzzle.w || cy >= this.puzzle.h) return -1;
    return cy * this.puzzle.w + cx;
  }

  private zoomAt(x: number, y: number, newScale: number) {
    const s = Math.max(this.minScale, Math.min(MAX_ZOOM, newScale));
    const gx = (x - this.tx) / this.scale, gy = (y - this.ty) / this.scale;
    this.scale = s;
    this.tx = x - gx * s;
    this.ty = y - gy * s;
    this.clamp();
    this.anim = null;
    this.cb.onZoom?.(s);
    this.invalidate();
  }

  zoomBy(factor: number) {
    this.zoomAt(this.viewW / 2, this.viewH / 2, this.scale * factor);
  }

  private animateTo(scale: number, tx: number, ty: number, dur = 380) {
    this.anim = { from: [this.scale, this.tx, this.ty], to: [scale, tx, ty], start: performance.now(), dur };
    this.invalidate();
  }

  /** Zoom to the nearest unpainted cell of the selected colour and pulse it. */
  hint(): boolean {
    const { w, cells } = this.puzzle;
    const cx = (this.viewW / 2 - this.tx) / this.scale, cy = (this.viewH / 2 - this.ty) / this.scale;
    let best = -1, bd = Infinity;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== this.selected || this.filled[i]) continue;
      const d = (i % w + 0.5 - cx) ** 2 + (((i / w) | 0) + 0.5 - cy) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return false;
    const s = Math.max(this.scale, 26);
    const x = best % w, y = (best / w) | 0;
    this.animateTo(s, this.viewW / 2 - (x + 0.5) * s, this.viewH / 2 - (y + 0.5) * s, 500);
    this.pulse = { cell: best, start: performance.now() + 300 };
    return true;
  }

  // ---------- painting ----------
  private paint(i: number): boolean {
    if (i < 0) return false;
    const v = this.puzzle.cells[i];
    if (v === EMPTY || this.filled[i] || v !== this.selected) return false;
    this.filled[i] = 1;
    this.filledCount++;
    this.doneByColour[v]++;
    this.updateCell(i);
    this.cb.onFill(v, this.filledCount);
    if (this.doneByColour[v] >= this.puzzle.counts[v]) this.cb.onColourDone(v);
    if (this.filledCount >= this.puzzle.total) this.cb.onComplete();
    return true;
  }

  private paintLine(x0: number, y0: number, x1: number, y1: number) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / (this.scale * 0.4)));
    for (let s = 1; s <= steps; s++) {
      this.paint(this.cellAt(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps));
    }
  }

  // ---------- input ----------
  private bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => this.up(e));
    c.addEventListener('pointercancel', e => this.up(e, true));
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const p = this.local(e);
      this.zoomAt(p.x, p.y, this.scale * Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }

  private cancelPending() {
    if (this.gesture.kind === 'pending') clearTimeout(this.gesture.timer);
  }

  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.anim = null;
    if (this.pointers.size === 2) {
      this.cancelPending();
      const [a, b] = [...this.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.gesture = {
        kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: this.scale, mid,
        gx: (mid.x - this.tx) / this.scale, gy: (mid.y - this.ty) / this.scale,
      };
      return;
    }
    if (this.pointers.size > 2) return;
    if (e.button === 1 || e.button === 2) {
      this.gesture = { kind: 'pan', x: p.x, y: p.y };
      return;
    }
    const cell = this.cellAt(p.x, p.y);
    const v = cell >= 0 ? this.puzzle.cells[cell] : EMPTY;
    // Starting on a paintable cell of the selected colour paints; anything else pans.
    if (cell >= 0 && v === this.selected && !this.filled[cell] && this.scale >= GRID_ZOOM * 0.8) {
      this.paint(cell);
      this.gesture = { kind: 'paint', lastX: p.x, lastY: p.y };
      return;
    }
    const timer = window.setTimeout(() => {
      // Long press on an unpainted cell picks up its colour.
      if (this.gesture.kind === 'pending' && cell >= 0 && v !== EMPTY && !this.filled[cell]) {
        this.cb.onPick(v);
        this.gesture = { kind: 'none' };
      }
    }, LONG_PRESS_MS);
    this.gesture = { kind: 'pending', x: p.x, y: p.y, cell, timer };
  }

  private move(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (g.kind === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const s = Math.max(this.minScale, Math.min(MAX_ZOOM, (g.scale * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist));
      this.scale = s;
      this.tx = mid.x - g.gx * s;
      this.ty = mid.y - g.gy * s;
      this.clamp();
      this.cb.onZoom?.(s);
      this.invalidate();
    } else if (g.kind === 'paint') {
      this.paintLine(g.lastX, g.lastY, p.x, p.y);
      g.lastX = p.x;
      g.lastY = p.y;
    } else if (g.kind === 'pending') {
      if (Math.hypot(p.x - g.x, p.y - g.y) > 8) {
        clearTimeout(g.timer);
        this.gesture = { kind: 'pan', x: p.x, y: p.y };
      }
    } else if (g.kind === 'pan') {
      this.tx += p.x - g.x;
      this.ty += p.y - g.y;
      g.x = p.x;
      g.y = p.y;
      this.clamp();
      this.invalidate();
    }
  }

  private up(e: PointerEvent, cancelled = false) {
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (g.kind === 'pinch') {
      // Lifting one finger of a pinch continues as a pan with the other.
      const rest = [...this.pointers.values()][0];
      this.gesture = rest ? { kind: 'pan', x: rest.x, y: rest.y } : { kind: 'none' };
      return;
    }
    if (g.kind === 'pending' && !cancelled) {
      clearTimeout(g.timer);
      const now = performance.now();
      const p = this.local(e);
      if (now - this.lastTap.t < 300 && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 30) {
        // Double tap: zoom in to read numbers, or back out to fit.
        if (this.scale < NUMBER_ZOOM * 1.2) {
          const s = NUMBER_ZOOM * 1.8;
          const gx = (p.x - this.tx) / this.scale, gy = (p.y - this.ty) / this.scale;
          this.animateTo(s, p.x - gx * s, p.y - gy * s);
        } else this.fit();
        this.lastTap.t = 0;
      } else {
        this.lastTap = { t: now, x: p.x, y: p.y };
        const v = g.cell >= 0 ? this.puzzle.cells[g.cell] : EMPTY;
        if (g.cell >= 0 && v !== EMPTY && !this.filled[g.cell] && v !== this.selected && this.scale >= GRID_ZOOM) this.cb.onWrong();
      }
    }
    if (this.pointers.size === 0) this.gesture = { kind: 'none' };
  }

  /** Full-colour snapshot for sharing; empty cells become transparent. */
  snapshot(cellPx = 16, complete = false): HTMLCanvasElement {
    const { w, h, cells } = this.puzzle;
    const out = document.createElement('canvas');
    out.width = w * cellPx;
    out.height = h * cellPx;
    const ctx = out.getContext('2d')!;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      if (v === EMPTY) continue;
      if (!complete && !this.filled[i]) {
        const g = this.grey[v];
        ctx.fillStyle = `rgb(${g},${g},${g})`;
      } else ctx.fillStyle = this.puzzle.palette[v];
      ctx.fillRect((i % w) * cellPx, ((i / w) | 0) * cellPx, cellPx, cellPx);
    }
    return out;
  }
}

/** Small preview used on cards: greyscale with painted cells in colour. */
export function renderThumb(
  canvas: HTMLCanvasElement,
  meta: { w: number; h: number; palette: string[] },
  cells: Uint8Array,
  filled: Uint8Array | null,
  complete: boolean,
) {
  canvas.width = meta.w;
  canvas.height = meta.h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(meta.w, meta.h);
  const rgb = meta.palette.map(hexToRgb);
  const grey = rgb.map(c => Math.round(110 + (luminance(c) / 255) * 135));
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    if (v === EMPTY) continue;
    if (complete || (filled && filled[i])) img.data.set([...rgb[v], 255], i * 4);
    else img.data.set([grey[v], grey[v], grey[v], 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
}
