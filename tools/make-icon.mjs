// Generates the app icon (public/icon.svg plus PNG sources for Android) from a pixel heart.
import fs from 'node:fs/promises';
import sharp from 'sharp';

const heart = [
  '..XX...XX..',
  '.XXXX.XXXX.',
  'XXXXXXXXXXX',
  'XXXXXXXXXXX',
  'XXXXXXXXXXX',
  '.XXXXXXXXX.',
  '..XXXXXXX..',
  '...XXXXX...',
  '....XXX....',
  '.....X.....',
];
const colours = ['#ff5d73', '#ff7a59', '#ffb347', '#ffd166', '#06d6a0', '#118ab2', '#7b6cf6'];

function pixels(size, cell, ox, oy) {
  let out = '';
  heart.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== 'X') return;
      // Painted from the bottom-left diagonal, unpainted squares stay white with a number feel.
      const painted = x + (heart.length - y) < 12;
      const fill = painted ? colours[(x + y) % colours.length] : '#ffffff';
      out += `<rect x="${ox + x * cell + 1.5}" y="${oy + y * cell + 1.5}" width="${cell - 3}" height="${cell - 3}" rx="${cell * 0.18}" fill="${fill}"${painted ? '' : ' fill-opacity="0.92"'}/>`;
    });
  });
  return out;
}

function svg(size, { rounded = true, bg = true, scale = 1 } = {}) {
  const cell = (size * 0.066) * scale;
  const w = cell * 11, h = cell * 10;
  const ox = (size - w) / 2, oy = (size - h) / 2 + cell * 0.3;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a5c"/><stop offset="1" stop-color="#f2557a"/></linearGradient></defs>
  ${bg ? `<rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="url(#g)"/>` : ''}
  ${pixels(size, cell, ox, oy)}
</svg>`;
}

await fs.mkdir('public', { recursive: true });
await fs.mkdir('assets', { recursive: true });
await fs.writeFile('public/icon.svg', svg(512));
await sharp(Buffer.from(svg(1024, { rounded: false }))).png().toFile('assets/icon-only.png');
await sharp(Buffer.from(svg(1024, { bg: false, scale: 0.72 }))).png().toFile('assets/icon-foreground.png');
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#f7706b' } })
  .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a5c"/><stop offset="1" stop-color="#f2557a"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#g)"/></svg>`) }])
  .png().toFile('assets/icon-background.png');
// Splash: icon centred on the app background colour.
await sharp({ create: { width: 2732, height: 2732, channels: 4, background: '#fbf7f0' } })
  .composite([{ input: await sharp(Buffer.from(svg(640))).png().toBuffer(), gravity: 'center' }])
  .png().toFile('assets/splash.png');
await sharp({ create: { width: 2732, height: 2732, channels: 4, background: '#16151c' } })
  .composite([{ input: await sharp(Buffer.from(svg(640))).png().toBuffer(), gravity: 'center' }])
  .png().toFile('assets/splash-dark.png');
console.log('icons written');
