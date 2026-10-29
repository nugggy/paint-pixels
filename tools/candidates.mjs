// Builds tools/cache/candidates.json: curated public-domain colour plates and prints
// from Wikimedia Commons, grouped by category.
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('tools/cache/candidates.json');
const UA = 'PaintPixels/1.0 (https://github.com/nugggy/paint-pixels)';
const PER_CATEGORY = 190;

// Titles we never want in a family-friendly colouring app.
export const BLOCK = /\b(nude|nudes|naked|bath|bather|bathers|bathing|venus|nymph|crucifi\w*|martyr\w*|dead|death|dying|execution|battle|war|massacre|skull|blood|lynch\w*|slave\w*|leda|susanna|lucretia|judith|salome|rape|abduct\w*|satyr|bacchan\w*|odalisque|harem|courtesan|brothel|erotic|shunga|torso|corpse|wounded|hang\w*|devil|hell|demon|gun|rifle|pistol|weapon|soldier|hunt\w*|kill\w*|slaughter\w*|butcher\w*|prisoner|burial|funeral|tomb|grave|ghost|witch|vanitas|logo|flag|emblem|coat of arms|seal|map|diagram|icon|signature|symbol|heraldry|chart|text|font|unifont|emoji|twemoji|trademark|pride|party|election|political|religio\w*|church|cross|bible|christ|madonna|saint|virgin|angel|buddha|god|goddess|temple|mosque|swastika|nazi|confederate|cigar\w*|tobacco|beer|wine|whisk\w*|alcohol|drunk\w*|smok\w*)\b/i;

async function getJson(url, init = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) } });
      if (res.ok) return await res.json();
      console.warn('HTTP', res.status, url.slice(0, 120));
    } catch (e) {
      console.warn('fetch error', e.message);
    }
    await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error('failed ' + url);
}

// Curated public-domain colour plates on Wikimedia Commons. `cats` are read directly;
// `deep` categories are searched with deepcat so sub-categories are included.
const plates = [
  { id: 'aussie-birds', name: 'Australian Birds', cats: ['The Birds of Australia (John Gould)'], limit: 420, pages: 20 },
  { id: 'aussie', name: 'Australian Animals', cats: ['The Mammals of Australia (John Gould)'], limit: 227 },
  { id: 'parrots', name: 'Parrots', cats: ['Illustrations of the Family of Psittacidae, or Parrots (1832) by Edward Lear'], limit: 102 },
  { id: 'birds', name: 'Birds of the World', cats: ['The Birds of Asia (John Gould)', 'The Birds of New Guinea (John Gould)', 'Histoire naturelle des oiseaux de paradis et des rolliers, suivie de celles des toucans et des barbus', 'Coloured figures of the birds of the British Islands - issued by Lord Lilford', 'British birds by Archibald Thorburn'], limit: 420, deep: true },
  { id: 'butterflies', name: 'Butterflies', cats: ['Illustrations of diurnal Lepidoptera - Hewitson', 'Sammlung exotischer Schmetterlinge (Hübner)', 'British and European Butterflies and Moths', 'A manual of North American butterflies'], limit: 420 },
  { id: 'fish', name: 'Fish', cats: ['Illustrations from Ichtyologie, ou histoire naturelle générale et particulière des poissons'], limit: 373 },
  { id: 'roses', name: 'Roses & Lilies', cats: ['Les Roses (Redouté)', 'Choix des plus belles fleurs', 'Les Liliacées par P. J. Redouté - btv1b53243247k', 'Les Liliacées par P. J. RedoutéTome second - btv1b53244699d'], limit: 420 },
  { id: 'orchids', name: 'Orchids', cats: ["Curtis's Botanical Magazine (Orchidaceae)"], limit: 400 },
  { id: 'wildflowers', name: 'Wildflowers & Herbs', cats: ['Thomé, Flora von Deutschland', "Köhler's Medizinal-Pflanzen in naturgetreuen Abbildungen mit kurz erläuterndem Texte (1887)", "Köhler's Medizinal-Pflanzen in naturgetreuen Abbildungen mit kurz erläuterndem Texte (1890)"], limit: 420 },
  { id: 'fruit', name: 'Orchard Fruit', cats: ['USDA Pomological Watercolors'], limit: 300 },
  { id: 'haeckel', name: 'Wonders of Nature', cats: ['Kunstformen der Natur (1899)'], limit: 200 },
  { id: 'potter', name: 'Storybook Animals', cats: ["Illustrations of children's books by Beatrix Potter"], limit: 200, deep: true },
  { id: 'fairytales', name: 'Fairy Tales', cats: ['The Sleeping Beauty (Walter Crane)', 'Princess Belle Etoile (Crane)', 'The Three Bears (Walter Crane)', 'The Frog Prince (Walter Crane)', 'The Yellow Dwarf (Crane)', 'The Hind in the Wood (Crane)', 'The Pied Piper of Hamelin illustrated by Kate Greenaway', 'Japanese Fairy Book', 'Green willow and other Japanese fairy tales (1910)'], limit: 200, deep: true, nocut: true },
  { id: 'ukiyoe', name: 'Hokusai & Hiroshige', cats: ['One Hundred Famous Views of Edo', '36 Views of Mount Fuji'], limit: 260, deep: true, nocut: true },
  { id: 'tokaido', name: 'Road to Edo', cats: ['The Fifty-three Stations of the Tōkaidō (Hoeidō Edition) original prints-variants', 'The Fifty-three Stations of the Tōkaidō (Kyōka Edition)'], limit: 260, deep: true, nocut: true },
  { id: 'bairei', name: 'Birds & Blossoms', cats: ["Bairei's Picture Album of Birds and Flowers", 'Bairei Picture Album of One Hundred Birds (Bairei hyakuchō gafu) MET JIB4'], limit: 60, nocut: true },
];

function plateItem(p, cat) {
  const ii = p.imageinfo?.[0];
  if (!ii?.thumburl || !/\.(jpe?g|png|tiff?)$/i.test(p.title)) return null;
  const licence = ii.extmetadata?.LicenseShortName?.value || '';
  if (!/public domain|^pd|cc0/i.test(licence)) return null;
  const r = ii.width / ii.height;
  if (r > 1.8 || r < 0.55) return null;
  const title = (ii.extmetadata?.ObjectName?.value || p.title.replace(/^File:/, '').replace(/\.\w+$/, ''))
    .replace(/<[^>]+>/g, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
  if (BLOCK.test(title)) return null;
  const artist = (ii.extmetadata?.Artist?.value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return {
    key: `wc-${p.pageid}`,
    source: 'plate',
    title,
    artist: artist.slice(0, 80) || 'Unknown artist',
    date: '',
    url: ii.thumburl.split('?')[0],
    page: ii.descriptionurl,
    licence: /cc0/i.test(licence) ? 'CC0' : 'Public domain',
  };
}

async function plateCategory(cat) {
  const out = [];
  const seen = new Set();
  const base = { action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: '400', iiextmetadatafilter: 'LicenseShortName|Artist|ObjectName' };
  for (const name of cat.cats) {
    let cont = {};
    for (let page = 0; page < (cat.pages || 6); page++) {
      const params = new URLSearchParams(cat.deep
        ? { ...base, generator: 'search', gsrnamespace: '6', gsrlimit: '50', gsrsearch: `deepcat:"${name}" filetype:bitmap`, ...cont }
        : { ...base, generator: 'categorymembers', gcmtitle: 'Category:' + name, gcmtype: 'file', gcmlimit: '50', ...cont });
      const j = await getJson('https://commons.wikimedia.org/w/api.php?' + params);
      for (const p of Object.values(j.query?.pages || {})) {
        if (seen.has(p.pageid)) continue;
        seen.add(p.pageid);
        const item = plateItem(p, cat);
        if (item) out.push(cat.nocut ? { ...item, nocut: true } : item);
      }
      if (!j.continue) break;
      cont = j.continue;
      await new Promise(r => setTimeout(r, 300));
    }
  }
  // Deterministic shuffle so one sub-collection doesn't dominate.
  out.sort((a, b) => (hash(a.key) % 9973) - (hash(b.key) % 9973));
  return out.slice(0, cat.limit);
}

function hash(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// Pass category ids (e.g. `node tools/candidates.mjs fish parrots`) to refresh just those.
const only = process.argv.slice(2);
const result = only.length
  ? JSON.parse(await fs.readFile(OUT, 'utf8'))
  : { generated: new Date().toISOString(), categories: [] };
for (const cat of plates.filter(p => !only.length || only.includes(p.id))) {
  const items = await plateCategory(cat);
  console.log(cat.id, items.length);
  const entry = { id: cat.id, name: cat.name, items };
  const at = result.categories.findIndex(c => c.id === cat.id);
  if (at >= 0) result.categories[at] = entry;
  else result.categories.push(entry);
}
// Remove duplicates across categories (first category wins).
const used = new Set();
for (const c of result.categories) c.items = c.items.filter(i => !used.has(i.key) && used.add(i.key));
await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(result, null, 1));
console.log('total', result.categories.reduce((n, c) => n + c.items.length, 0));
