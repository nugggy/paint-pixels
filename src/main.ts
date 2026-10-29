import './styles.css';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import {
  loadLibrary, getCategories, getMeta, loadPuzzle, allPuzzles, dailyPuzzle, LEVELS,
  type PuzzleMeta,
} from './data';
import {
  getSettings, setSettings, getSummary, getSummaries, loadFilled, saveFilled, resetProgress,
  getFavourites, toggleFavourite,
} from './store';
import { Board, renderThumb } from './board';
import { icons } from './icons';
import { pop, chime, fanfare, buzz } from './feedback';
import { checkForUpdate, APP_VERSION, REPO, type UpdateInfo } from './updater';

// ---------- helpers ----------
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number) => n.toLocaleString('en-AU');

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

export const THEMES = [
  { id: 'daylight', name: 'Daylight', swatch: ['#fbf7f0', '#ff7a59'] },
  { id: 'midnight', name: 'Midnight', swatch: ['#16151c', '#9b8cff'] },
  { id: 'ocean', name: 'Ocean', swatch: ['#eef6fb', '#1f8fc4'] },
  { id: 'blossom', name: 'Blossom', swatch: ['#fff3f6', '#e5578b'] },
  { id: 'forest', name: 'Forest', swatch: ['#f1f6ef', '#3f8f5a'] },
  { id: 'sunset', name: 'Sunset', swatch: ['#2a1b2e', '#ffab5e'] },
];

function applyTheme() {
  const theme = getSettings().theme;
  document.documentElement.dataset.theme = theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  $('meta[name="theme-color"]')?.setAttribute('content', bg);
  if (Capacitor.isNativePlatform()) {
    const dark = theme === 'midnight' || theme === 'sunset';
    StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
    StatusBar.setBackgroundColor({ color: bg }).catch(() => {});
  }
}

function toast(msg: string) {
  const t = el(`<div class="toast">${esc(msg)}</div>`);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2200);
}

function modal(html: string, onMount?: (m: HTMLElement, close: () => void) => void) {
  const m = el(`<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`);
  const close = () => {
    m.classList.remove('show');
    setTimeout(() => m.remove(), 250);
  };
  m.addEventListener('click', e => {
    if (e.target === m) close();
  });
  m.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  document.body.appendChild(m);
  requestAnimationFrame(() => m.classList.add('show'));
  onMount?.(m, close);
  return close;
}

function confirmBox(title: string, text: string, ok: string): Promise<boolean> {
  return new Promise(resolve => {
    let answered = false;
    modal(
      `<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
       <div class="modal-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" data-ok>${esc(ok)}</button></div>`,
      (m, close) => {
        $('[data-ok]', m).addEventListener('click', () => {
          answered = true;
          resolve(true);
          close();
        });
        m.addEventListener('transitionend', () => {
          if (!answered && !m.classList.contains('show')) resolve(false);
        });
        m.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => resolve(false)));
      },
    );
  });
}

// ---------- thumbnails (rendered lazily as cards scroll into view) ----------
const thumbObserver = new IntersectionObserver(
  entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      thumbObserver.unobserve(e.target);
      drawThumb(e.target as HTMLCanvasElement);
    }
  },
  { rootMargin: '300px' },
);

async function drawThumb(canvas: HTMLCanvasElement) {
  const id = canvas.dataset.id!;
  const p = await loadPuzzle(id);
  const s = getSummary(id);
  const filled = s && !s.completed ? loadFilled(id, p.cells.length) : null;
  renderThumb(canvas, p, p.cells, filled, !!s?.completed);
  canvas.classList.add('ready');
}

function card(p: PuzzleMeta) {
  const s = getSummary(p.id);
  const pct = s ? Math.floor((s.filled / s.total) * 100) : 0;
  const fav = getFavourites().includes(p.id);
  const c = el(`
    <button class="card" data-id="${p.id}" aria-label="${esc(p.title)}">
      <div class="thumb"><canvas data-id="${p.id}"></canvas></div>
      <div class="card-meta">
        <span class="level l${p.level}" title="${LEVELS[p.level]}">${LEVELS[p.level]}</span>
        ${fav ? `<span class="fav">${icons.heart}</span>` : ''}
        ${s?.completed ? `<span class="done">${icons.check}</span>` : s ? `<span class="pct">${pct}%</span>` : ''}
      </div>
      ${s && !s.completed ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}
    </button>`);
  thumbObserver.observe($('canvas', c));
  c.addEventListener('click', () => go('play/' + p.id));
  return c;
}

/** Appends cards in pages as the user scrolls, so 1000+ items stay smooth. */
function grid(items: PuzzleMeta[], container: HTMLElement) {
  const g = el('<div class="grid"></div>');
  container.appendChild(g);
  let shown = 0;
  const sentinel = el('<div class="sentinel"></div>');
  const more = () => {
    const next = items.slice(shown, shown + 36);
    next.forEach(p => g.appendChild(card(p)));
    shown += next.length;
    if (shown >= items.length) {
      sentinel.remove();
      io.disconnect();
    }
  };
  const io = new IntersectionObserver(e => e[0].isIntersecting && more(), { rootMargin: '600px' });
  container.appendChild(sentinel);
  more();
  if (shown < items.length) io.observe(sentinel);
  if (!items.length) g.replaceWith(el('<p class="empty">Nothing here yet.</p>'));
}

// ---------- views ----------
const view = () => $('#view');
let libState = { cat: 'all', level: -1, query: '' };

function renderLibrary() {
  const v = view();
  const total = allPuzzles().length;
  const daily = dailyPuzzle();
  const inProgress = Object.entries(getSummaries())
    .filter(([id, s]) => !s.completed && getMeta(id))
    .sort((a, b) => b[1].updated - a[1].updated)
    .slice(0, 12)
    .map(([id]) => getMeta(id)!);

  v.innerHTML = `
    <header class="hero">
      <div class="brand"><img src="./icon.svg" alt="" class="logo"/><div><h1>Paint Pixels</h1><p class="muted">${fmt(total)} pictures to colour</p></div></div>
    </header>
    ${daily ? `<section class="daily" data-id="${daily.id}">
        <div class="daily-thumb"><canvas data-id="${daily.id}"></canvas></div>
        <div class="daily-text"><span class="eyebrow">Picture of the day</span><h2>${esc(daily.title)}</h2><p class="muted small">${esc(daily.artist)}</p><span class="btn small">Start painting</span></div>
      </section>` : ''}
    ${inProgress.length ? `<h3 class="section-title">Continue painting</h3><div class="row-scroll" id="continue"></div>` : ''}
    <div class="filters">
      <label class="search">${icons.search}<input type="search" id="q" placeholder="Search pictures" value="${esc(libState.query)}"/></label>
      <div class="chips" id="cats"></div>
      <div class="seg" id="levels"></div>
    </div>
    <div id="results"></div>`;

  if (daily) {
    thumbObserver.observe($('.daily canvas', v));
    $('.daily', v).addEventListener('click', () => go('play/' + daily.id));
  }
  const cont = $('#continue', v);
  inProgress.forEach(p => cont.appendChild(card(p)));

  const cats = $('#cats', v);
  const catList = [{ id: 'all', name: 'All' }, ...getCategories().map(c => ({ id: c.id, name: c.name }))];
  for (const c of catList) {
    const b = el(`<button class="chip ${libState.cat === c.id ? 'on' : ''}">${esc(c.name)}</button>`);
    b.addEventListener('click', () => {
      libState.cat = c.id;
      cats.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
      results();
    });
    cats.appendChild(b);
  }
  requestAnimationFrame(() => cats.querySelector('.chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }));

  const lv = $('#levels', v);
  ['All', ...LEVELS].forEach((name, i) => {
    const b = el(`<button class="${libState.level === i - 1 ? 'on' : ''}">${name}</button>`);
    b.addEventListener('click', () => {
      libState.level = i - 1;
      lv.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      results();
    });
    lv.appendChild(b);
  });

  let debounce = 0;
  $<HTMLInputElement>('#q', v).addEventListener('input', e => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      libState.query = (e.target as HTMLInputElement).value.trim().toLowerCase();
      results();
    }, 200);
  });

  function results() {
    const r = $('#results', v);
    r.innerHTML = '';
    const q = libState.query;
    const items = (libState.cat === 'all' ? allPuzzles() : getCategories().find(c => c.id === libState.cat)?.puzzles || [])
      .filter(p => libState.level < 0 || p.level === libState.level)
      .filter(p => !q || p.title.toLowerCase().includes(q) || p.artist.toLowerCase().includes(q));
    r.appendChild(el(`<p class="muted small count">${fmt(items.length)} pictures</p>`));
    grid(items, r);
  }
  results();
}

let mineTab: 'progress' | 'done' | 'favs' = 'progress';
function renderMine() {
  const v = view();
  const sums = getSummaries();
  const done = Object.values(sums).filter(s => s.completed).length;
  const cells = Object.values(sums).reduce((n, s) => n + s.filled, 0);
  v.innerHTML = `
    <header class="hero"><h1>My Art</h1></header>
    <div class="stats">
      <div><b>${fmt(done)}</b><span>finished</span></div>
      <div><b>${fmt(Object.keys(sums).length - done)}</b><span>in progress</span></div>
      <div><b>${fmt(cells)}</b><span>pixels painted</span></div>
    </div>
    <div class="seg wide" id="mt">
      <button data-t="progress">In progress</button><button data-t="done">Finished</button><button data-t="favs">Favourites</button>
    </div>
    <div id="mine"></div>`;
  const draw = () => {
    v.querySelectorAll<HTMLButtonElement>('#mt button').forEach(b => b.classList.toggle('on', b.dataset.t === mineTab));
    const list =
      mineTab === 'favs'
        ? getFavourites().map(getMeta).filter(Boolean)
        : Object.entries(sums)
            .filter(([, s]) => s.completed === (mineTab === 'done'))
            .sort((a, b) => b[1].updated - a[1].updated)
            .map(([id]) => getMeta(id))
            .filter(Boolean);
    const box = $('#mine', v);
    box.innerHTML = '';
    grid(list as PuzzleMeta[], box);
  };
  v.querySelectorAll<HTMLButtonElement>('#mt button').forEach(b =>
    b.addEventListener('click', () => {
      mineTab = b.dataset.t as typeof mineTab;
      draw();
    }),
  );
  draw();
}

function renderSettings() {
  const v = view();
  const s = getSettings();
  const toggle = (key: keyof typeof s, label: string, hint: string) => `
    <label class="toggle"><span><b>${label}</b><small>${hint}</small></span>
    <input type="checkbox" data-k="${key}" ${s[key] ? 'checked' : ''}/><i></i></label>`;
  v.innerHTML = `
    <header class="hero"><h1>Settings</h1></header>
    <section class="panel">
      <h3>Theme</h3>
      <div class="themes">${THEMES.map(
        t => `<button class="theme ${s.theme === t.id ? 'on' : ''}" data-theme-id="${t.id}">
          <span class="sw" style="background:linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%)"></span>${t.name}</button>`,
      ).join('')}</div>
    </section>
    <section class="panel">
      ${toggle('sound', 'Sounds', 'Soft pops while you paint')}
      ${toggle('vibrate', 'Vibration', 'A little buzz when a colour is finished')}
      ${toggle('showGrid', 'Grid lines', 'Outline unpainted squares when zoomed in')}
      ${toggle('autoNext', 'Next colour automatically', 'Jump to the next colour when one is done')}
    </section>
    <section class="panel">
      <h3>Updates</h3>
      <p class="muted small">You have version ${APP_VERSION}. Paint Pixels checks GitHub for a new version each time it opens.</p>
      <div class="row"><button class="btn" id="chk">${icons.refresh} Check now</button><span class="muted small" id="chk-status"></span></div>
    </section>
    <section class="panel">
      <h3>How to play</h3>
      <ul class="howto">
        <li>Pick a colour at the bottom, then tap or drag over squares with that number.</li>
        <li>Pinch to zoom. Drag from a painted square to move around. Double-tap to zoom in or out.</li>
        <li>Long-press a square to pick up its colour. Stuck? The light bulb finds the next square.</li>
      </ul>
    </section>
    <section class="panel">
      <h3>About the pictures</h3>
      <p class="muted small">The cartoon animals were drawn especially for Paint Pixels. Every other picture is in the public domain. They are scans of classic natural history plates, storybooks and Japanese prints shared on Wikimedia Commons, including works by John Gould, Edward Lear, Pierre-Joseph Redouté, Ernst Haeckel, Beatrix Potter, Walter Crane, Kate Greenaway, Hokusai, Hiroshige and Kōno Bairei, and the USDA Pomological Watercolor Collection. Each picture's info panel links to its source.</p>
      <p class="muted small"><a href="https://github.com/${REPO}" id="gh">github.com/${REPO}</a></p>
    </section>
    <section class="panel">
      <button class="btn danger ghost" id="reset">Clear all progress</button>
    </section>
    <p class="muted small center">Paint Pixels ${APP_VERSION}</p>`;

  v.querySelectorAll<HTMLButtonElement>('.theme').forEach(b =>
    b.addEventListener('click', () => {
      setSettings({ theme: b.dataset.themeId! });
      applyTheme();
      v.querySelectorAll('.theme').forEach(x => x.classList.toggle('on', x === b));
    }),
  );
  v.querySelectorAll<HTMLInputElement>('.toggle input').forEach(i =>
    i.addEventListener('change', () => setSettings({ [i.dataset.k!]: i.checked })),
  );
  $('#chk', v).addEventListener('click', async () => {
    const st = $('#chk-status', v);
    st.textContent = 'Checking…';
    try {
      const u = await checkForUpdate();
      if (u) {
        st.textContent = '';
        showUpdate(u, true);
      } else st.textContent = 'You have the latest version.';
    } catch {
      st.textContent = 'Could not reach GitHub. Check your connection.';
    }
  });
  $('#gh', v).addEventListener('click', e => {
    e.preventDefault();
    openExternal(`https://github.com/${REPO}`);
  });
  $('#reset', v).addEventListener('click', async () => {
    if (!(await confirmBox('Clear all progress?', 'This removes every painting you have started or finished. It cannot be undone.', 'Clear everything'))) return;
    Object.keys(getSummaries()).forEach(resetProgress);
    toast('All progress cleared');
  });
}

// ---------- play ----------
let board: Board | null = null;
let saveTimer = 0;

async function renderPlay(id: string) {
  const meta = getMeta(id);
  if (!meta) return go('');
  const puzzle = await loadPuzzle(id);
  const filled = loadFilled(id, puzzle.cells.length);
  const settings = getSettings();
  const shell = el(`
    <div class="play">
      <header class="play-top">
        <button class="icon-btn" id="back" aria-label="Back">${icons.back}</button>
        <div class="play-title"><b>${esc(meta.title)}</b><span class="progress-text" id="pt"></span></div>
        <button class="icon-btn" id="hint" aria-label="Hint">${icons.bulb}</button>
        <button class="icon-btn" id="more" aria-label="More">${icons.more}</button>
      </header>
      <div class="play-progress"><i id="pbar"></i></div>
      <div class="board-host" id="host">
        <div class="zoom-btns">
          <button class="icon-btn" id="zin" aria-label="Zoom in">${icons.plus}</button>
          <button class="icon-btn" id="zout" aria-label="Zoom out">${icons.minus}</button>
          <button class="icon-btn" id="zfit" aria-label="Fit picture">${icons.fit}</button>
        </div>
      </div>
      <nav class="palette" id="pal"></nav>
    </div>`);
  document.body.appendChild(shell);
  document.body.classList.add('playing');

  const host = $('#host', shell);
  const pal = $('#pal', shell);
  let finished = false;
  const swatches: HTMLButtonElement[] = [];

  const save = (now = false) => {
    clearTimeout(saveTimer);
    const write = () => b && saveFilled(id, filled, b.filledCount, puzzle.total);
    if (now) write();
    else saveTimer = window.setTimeout(write, 600);
  };

  const updateProgress = () => {
    const pct = (b.filledCount / puzzle.total) * 100;
    $('#pt', shell).textContent = `${Math.floor(pct)}% · ${fmt(puzzle.total - b.filledCount)} left`;
    $('#pbar', shell).style.width = pct + '%';
  };

  const updateSwatch = (c: number) => {
    const s = swatches[c];
    if (!s) return;
    const pct = puzzle.counts[c] ? b.doneByColour[c] / puzzle.counts[c] : 1;
    s.style.setProperty('--p', String(pct * 360));
    s.classList.toggle('complete', pct >= 1);
  };

  const select = (c: number) => {
    b.select(c);
    swatches.forEach((s, i) => s.classList.toggle('on', i === c));
    swatches[c]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  };

  const nextColour = (from: number) => {
    const n = puzzle.palette.length;
    for (let k = 1; k <= n; k++) {
      const c = (from + k) % n;
      if (b.doneByColour[c] < puzzle.counts[c]) return c;
    }
    return -1;
  };

  const b = new Board(host, puzzle, filled, {
    onFill: () => {
      pop();
      updateProgress();
      updateSwatch(b.selected);
      save();
    },
    onColourDone: c => {
      updateSwatch(c);
      if (b.filledCount >= puzzle.total) return;
      chime();
      const n = nextColour(c);
      if (n >= 0 && getSettings().autoNext) select(n);
    },
    onComplete: () => {
      save(true);
      if (finished) return;
      finished = true;
      setTimeout(() => celebrate(meta, b), 350);
    },
    onWrong: () => {
      buzz();
      const sw = swatches[b.selected];
      sw?.classList.remove('nudge');
      void sw?.offsetWidth;
      sw?.classList.add('nudge');
    },
    onPick: c => {
      if (getSettings().vibrate) buzz();
      select(c);
      toast(`Colour ${c + 1} selected`);
    },
  });
  board = b;
  b.showGrid = settings.showGrid;

  puzzle.palette.forEach((hex, c) => {
    if (!puzzle.counts[c]) return;
    const light = parseInt(hex.slice(1, 3), 16) * 0.299 + parseInt(hex.slice(3, 5), 16) * 0.587 + parseInt(hex.slice(5, 7), 16) * 0.114 > 150;
    const s = el(`<button class="swatch ${light ? 'light' : ''}" style="--c:${hex}" aria-label="Colour ${c + 1}"><span>${c + 1}</span><em>${icons.check}</em></button>`) as HTMLButtonElement;
    s.addEventListener('click', () => select(c));
    swatches[c] = s;
    pal.appendChild(s);
    updateSwatch(c);
  });
  updateProgress();
  finished = b.filledCount >= puzzle.total;
  const first = nextColour(-1);
  select(first >= 0 ? first : 0);

  $('#back', shell).addEventListener('click', () => history.back());
  $('#zin', shell).addEventListener('click', () => b.zoomBy(1.5));
  $('#zout', shell).addEventListener('click', () => b.zoomBy(1 / 1.5));
  $('#zfit', shell).addEventListener('click', () => b.fit());
  $('#hint', shell).addEventListener('click', () => {
    if (b.doneByColour[b.selected] >= puzzle.counts[b.selected]) {
      const n = nextColour(b.selected);
      if (n < 0) return;
      select(n);
    }
    b.hint();
  });
  $('#more', shell).addEventListener('click', () => {
    const fav = getFavourites().includes(id);
    modal(
      `<h2>${esc(meta.title)}</h2>
       <p class="muted small">${esc(meta.artist)}${meta.date ? ', ' + esc(meta.date) : ''}<br/>${LEVELS[meta.level]} · ${meta.w}×${meta.h} · ${puzzle.counts.filter(Boolean).length} colours · ${fmt(puzzle.total)} squares<br/>${esc(meta.licence)}</p>
       <div class="menu">
         <button data-a="fav">${icons.heart} ${fav ? 'Remove from favourites' : 'Add to favourites'}</button>
         <button data-a="share">${icons.share} Share picture</button>
         <button data-a="source">${icons.info} View original source</button>
         <button data-a="reset" class="danger">${icons.refresh} Start again</button>
       </div>
       <div class="modal-actions"><button class="btn ghost" data-close>Close</button></div>`,
      (m, close) => {
        m.querySelectorAll<HTMLButtonElement>('[data-a]').forEach(btn =>
          btn.addEventListener('click', async () => {
            const a = btn.dataset.a;
            close();
            if (a === 'fav') toast(toggleFavourite(id) ? 'Added to favourites' : 'Removed from favourites');
            if (a === 'share') sharePicture(meta, b, b.filledCount >= puzzle.total);
            if (a === 'source') openExternal(meta.source);
            if (a === 'reset' && (await confirmBox('Start again?', 'Your progress on this picture will be cleared.', 'Start again'))) {
              resetProgress(id);
              go('play/' + id, true);
            }
          }),
        );
      },
    );
  });
}

function closePlay() {
  if (board) {
    clearTimeout(saveTimer);
    saveFilled(board.puzzle.id, board.filled, board.filledCount, board.puzzle.total);
    board.destroy();
    board = null;
  }
  document.querySelectorAll('.play, .modal-backdrop').forEach(n => n.remove());
  document.body.classList.remove('playing');
}

function celebrate(meta: PuzzleMeta, b: Board) {
  fanfare();
  confetti();
  const snap = b.snapshot(Math.max(4, Math.floor(480 / Math.max(meta.w, meta.h))), true);
  modal(
    `<div class="celebrate">
       <span class="eyebrow">Masterpiece complete</span>
       <div class="final"></div>
       <h2>${esc(meta.title)}</h2>
       <p class="muted small">${esc(meta.artist)}</p>
     </div>
     <div class="modal-actions stack">
       <button class="btn" data-a="next">${icons.shuffle} Paint another</button>
       <button class="btn ghost" data-a="share">${icons.share} Share</button>
       <button class="btn ghost" data-a="lib">Back to library</button>
     </div>`,
    (m, close) => {
      $('.final', m).appendChild(snap);
      $('[data-a="share"]', m).addEventListener('click', () => sharePicture(meta, b, true));
      $('[data-a="lib"]', m).addEventListener('click', () => {
        close();
        history.back();
      });
      $('[data-a="next"]', m).addEventListener('click', () => {
        close();
        const pool = getCategories().find(c => c.id === meta.category)!.puzzles.filter(p => !getSummary(p.id)?.completed && p.id !== meta.id);
        const pick = (pool.length ? pool : allPuzzles())[Math.floor(Math.random() * (pool.length || allPuzzles().length))];
        go('play/' + pick.id, true);
      });
    },
  );
}

function confetti() {
  const c = document.createElement('canvas');
  c.className = 'confetti';
  c.width = innerWidth;
  c.height = innerHeight;
  document.body.appendChild(c);
  const ctx = c.getContext('2d')!;
  const colours = ['#ff7a59', '#ffd166', '#06d6a0', '#118ab2', '#ef476f', '#9b8cff'];
  const bits = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4,
    s: 5 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: colours[(Math.random() * colours.length) | 0],
  }));
  const start = performance.now();
  const tick = (t: number) => {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of bits) {
      p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx *= 0.99;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    }
    if (t - start < 3200) requestAnimationFrame(tick);
    else c.remove();
  };
  requestAnimationFrame(tick);
}

async function sharePicture(meta: PuzzleMeta, b: Board, complete: boolean) {
  const canvas = b.snapshot(Math.max(6, Math.floor(1080 / Math.max(meta.w, meta.h))), complete);
  const dataUrl = canvas.toDataURL('image/png');
  const name = 'paint-pixels-' + meta.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '.png';
  try {
    if (Capacitor.isNativePlatform()) {
      const file = await Filesystem.writeFile({ path: name, data: dataUrl.split(',')[1], directory: Directory.Cache });
      await Share.share({ title: meta.title, text: `I painted "${meta.title}" in Paint Pixels`, files: [file.uri] });
    } else {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = name;
      a.click();
    }
  } catch {
    /* user cancelled the share sheet */
  }
}

function openExternal(url: string) {
  if (Capacitor.isNativePlatform()) Browser.open({ url }).catch(() => window.open(url, '_blank'));
  else window.open(url, '_blank', 'noopener');
}

// ---------- updates ----------
function showUpdate(u: UpdateInfo, manual = false) {
  // Release notes are markdown: show them as plain text.
  const plain = u.notes
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]{1,2}/g, '')
    .replace(/^#+\s*/gm, '')
    .trim();
  const notes = esc(plain).replace(/\r?\n/g, '<br/>').slice(0, 1200);
  modal(
    `<div class="update">
       <span class="badge">${icons.download}</span>
       <h2>Version ${esc(u.version)} is ready</h2>
       <p class="muted small">You have ${APP_VERSION}. Download the update, then open it to install. Your paintings are kept.</p>
       ${notes ? `<div class="notes">${notes}</div>` : ''}
     </div>
     <div class="modal-actions stack">
       <button class="btn" data-a="get">${icons.download} Download update</button>
       ${manual ? '' : '<button class="btn ghost" data-a="skip">Skip this version</button>'}
       <button class="btn ghost" data-close>Later</button>
     </div>`,
    (m, close) => {
      $('[data-a="get"]', m).addEventListener('click', () => {
        openExternal(u.apkUrl);
        close();
      });
      $('[data-a="skip"]', m)?.addEventListener('click', () => {
        setSettings({ skipVersion: u.version });
        close();
      });
    },
  );
}

async function autoUpdateCheck() {
  try {
    const u = await checkForUpdate();
    if (u && getSettings().skipVersion !== u.version) showUpdate(u);
  } catch {
    /* offline: try again next launch */
  }
}

// ---------- routing ----------
function go(route: string, replace = false) {
  const hash = '#/' + route;
  if (replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  render();
}

function render() {
  const route = location.hash.replace(/^#\/?/, '');
  closePlay();
  if (route.startsWith('play/')) {
    renderPlay(decodeURIComponent(route.slice(5)));
    return;
  }
  const tab = route === 'mine' ? 'mine' : route === 'settings' ? 'settings' : 'library';
  document.querySelectorAll<HTMLElement>('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const v = view();
  const scrollKey = 'scroll:' + tab;
  if (tab === 'library') renderLibrary();
  else if (tab === 'mine') renderMine();
  else renderSettings();
  v.scrollTop = Number(sessionStorage.getItem(scrollKey) || 0);
  v.onscroll = () => sessionStorage.setItem(scrollKey, String(v.scrollTop));
}

async function boot() {
  applyTheme();
  document.querySelector('#app')!.innerHTML = `
    <main id="view" class="view"></main>
    <nav class="tabbar">
      <button data-tab="library">${icons.library}<span>Library</span></button>
      <button data-tab="mine">${icons.brush}<span>My Art</span></button>
      <button data-tab="settings">${icons.settings}<span>Settings</span></button>
    </nav>`;
  document.querySelectorAll<HTMLElement>('.tabbar button').forEach(b =>
    b.addEventListener('click', () => {
      const r = b.dataset.tab === 'library' ? '' : b.dataset.tab!;
      sessionStorage.removeItem('scroll:' + b.dataset.tab);
      go(r, true);
    }),
  );
  view().innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  await loadLibrary();
  window.addEventListener('popstate', render);
  render();
  SplashScreen.hide().catch(() => {});

  if (Capacitor.isNativePlatform()) {
    CapApp.addListener('backButton', () => {
      const open = document.querySelector('.modal-backdrop.show');
      if (open) return open.dispatchEvent(new MouseEvent('click'));
      const route = location.hash.replace(/^#\/?/, '');
      if (route) history.back();
      else CapApp.exitApp();
    });
    CapApp.addListener('pause', () => {
      if (board) saveFilled(board.puzzle.id, board.filled, board.filledCount, board.puzzle.total);
    });
    CapApp.addListener('resume', autoUpdateCheck);
  }
  setTimeout(autoUpdateCheck, 1500);
}

boot();
