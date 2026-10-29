// Original cartoon animals drawn as SVG (bold outlines, flat colours) for the cartoon categories.
// Each animal is rendered once in a scene and once as a plain sticker, saved into the image cache,
// and added to tools/cache/candidates.json so build-puzzles.mjs converts them like any other image.
// Usage: node tools/cartoons.mjs [--sheet]   (--sheet also writes a preview sheet)
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const RAW = path.resolve('tools/cache/raw');
const CANDIDATES = path.resolve('tools/cache/candidates.json');
const O = '#3b2f2f'; // outline colour
const SW = 9; // outline width

// ---------- drawing helpers ----------
// Extra attributes may override the default outline (e.g. stroke="none").
const st = (fill, extra = '') =>
  `fill="${fill}" ${/\bstroke="/.test(extra) ? '' : `stroke="${O}"`} ${/stroke-width=/.test(extra) ? '' : `stroke-width="${SW}"`} stroke-linejoin="round" stroke-linecap="round" ${extra}`;
const circle = (cx, cy, r, fill, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" ${st(fill, extra)}/>`;
const ell = (cx, cy, rx, ry, fill, extra = '') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${st(fill, extra)}/>`;
const p = (d, fill, extra = '') => `<path d="${d}" ${st(fill, extra)}/>`;
const flat = (shape) => shape.replace(/stroke="[^"]*"/, 'stroke="none"');
const eye = (x, y, r = 15) =>
  `<ellipse cx="${x}" cy="${y}" rx="${r * 0.78}" ry="${r}" fill="${O}"/><circle cx="${x + r * 0.28}" cy="${y - r * 0.38}" r="${r * 0.32}" fill="#fff"/>`;
const eyes = (x1, x2, y, r) => eye(x1, y, r) + eye(x2, y, r);
const cheek = (x, y, r = 14) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.65}" fill="#ff8fa3" opacity="0.85"/>`;
const smile = (x, y, w = 22, d = 14) => `<path d="M${x - w},${y} Q${x},${y + d} ${x + w},${y}" fill="none" stroke="${O}" stroke-width="${SW * 0.8}" stroke-linecap="round"/>`;
const line = (x1, y1, x2, y2, w = SW * 0.7) => `<path d="M${x1},${y1} L${x2},${y2}" stroke="${O}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
const tri = (a, b, c, fill) => p(`M${a} L${b} L${c} Z`, fill);

// ---------- scenes (full 400x400 backgrounds) ----------
const cloud = (x, y, s = 1) =>
  `<g transform="translate(${x},${y}) scale(${s})" fill="#fff"><circle cx="0" cy="0" r="22"/><circle cx="24" cy="-10" r="28"/><circle cx="52" cy="0" r="22"/><rect x="0" y="0" width="52" height="22"/></g>`;
const sun = (x, y) => `<circle cx="${x}" cy="${y}" r="34" fill="#ffd54f"/>`;
const scenes = {
  meadow: `<rect width="400" height="400" fill="#bfe6ff"/>${sun(340, 60)}${cloud(40, 70)}${cloud(220, 40, 0.8)}<path d="M0,300 Q100,260 200,290 T400,280 V400 H0 Z" fill="#8fd16f"/><circle cx="60" cy="350" r="7" fill="#ff7aa2"/><circle cx="340" cy="345" r="7" fill="#fff176"/><circle cx="300" cy="380" r="7" fill="#ff7aa2"/>`,
  pond: `<rect width="400" height="400" fill="#c6ecff"/>${cloud(250, 60)}${sun(70, 70)}<rect y="250" width="400" height="150" fill="#5ec2e8"/><path d="M0,250 Q50,240 100,250 T200,250 T300,250 T400,250" fill="none" stroke="#9fe0f7" stroke-width="6"/><ellipse cx="60" cy="370" rx="40" ry="14" fill="#6cc04a"/><ellipse cx="350" cy="300" rx="34" ry="12" fill="#6cc04a"/><circle cx="350" cy="292" r="8" fill="#ff8fc8"/>`,
  jungle: `<rect width="400" height="400" fill="#d6f5c9"/><path d="M0,0 Q60,90 0,170 Z" fill="#4caf50"/><path d="M400,0 Q330,100 400,190 Z" fill="#43a047"/><path d="M0,400 Q40,300 140,330 Q110,380 0,400 Z" fill="#66bb6a"/><path d="M400,400 Q360,290 260,330 Q300,380 400,400 Z" fill="#388e3c"/><path d="M120,0 Q170,50 230,0 Z" fill="#81c784"/>`,
  farm: `<rect width="400" height="400" fill="#ffe9c7"/>${sun(330, 70)}${cloud(50, 60)}<path d="M0,290 H400 V400 H0 Z" fill="#9ccc65"/><g fill="#d7a26a">${[20, 90, 160, 230, 300, 370].map(x => `<rect x="${x}" y="245" width="14" height="70"/>`).join('')}<rect x="0" y="260" width="400" height="12"/><rect x="0" y="290" width="400" height="12"/></g>`,
  sea: `<rect width="400" height="400" fill="#4fb3e8"/><rect y="340" width="400" height="60" fill="#f5dfa8"/><g fill="#b3e5fc">${[[50, 80, 10], [70, 120, 6], [340, 150, 12], [320, 100, 7], [360, 60, 5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g><path d="M40,345 Q30,300 50,270 Q60,310 55,345 Z" fill="#ef6f8a"/><path d="M350,345 Q345,290 370,260 Q375,310 365,345 Z" fill="#8e6fd8"/>`,
  snow: `<rect width="400" height="400" fill="#d9f1ff"/>${cloud(240, 50)}<path d="M0,300 Q120,270 220,300 T400,290 V400 H0 Z" fill="#ffffff"/><path d="M280,300 L330,200 L380,300 Z" fill="#bfe3f7"/><g fill="#fff">${[[60, 60], [150, 110], [40, 180], [340, 140], [200, 40]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5"/>`).join('')}</g>`,
  night: `<rect width="400" height="400" fill="#2f3d7a"/><circle cx="320" cy="80" r="40" fill="#fff3b0"/><circle cx="335" cy="70" r="36" fill="#2f3d7a"/><g fill="#fff8c4">${[[60, 60], [120, 120], [40, 220], [200, 40], [260, 160], [360, 220]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4"/>`).join('')}</g><path d="M0,320 Q100,290 200,320 T400,310 V400 H0 Z" fill="#3e6b4e"/>`,
  garden: `<rect width="400" height="400" fill="#fff0f5"/><path d="M0,310 H400 V400 H0 Z" fill="#a5d66f"/>${[[40, 300, '#ff7aa2'], [100, 320, '#ffd54f'], [330, 305, '#b39ddb'], [370, 325, '#ff8a65']].map(([x, y, c]) => `<path d="M${x},${y + 40} V${y}" stroke="#4caf50" stroke-width="6"/><circle cx="${x}" cy="${y}" r="14" fill="${c}"/><circle cx="${x}" cy="${y}" r="5" fill="#fff59d"/>`).join('')}${sun(60, 70)}`,
};

// ---------- animals (drawn on a 400x400 canvas, standing on y ~ 370) ----------
const animals = {
  duck: { name: 'Happy Duck', scene: 'pond', cat: 'pond', draw: () =>
    p('M80,250 L40,215 L95,225 Z', '#ffd84d') +
    ell(190, 275, 120, 82, '#ffd84d') +
    ell(170, 275, 62, 38, '#ffc21a', 'transform="rotate(-12 170 275)"') +
    ell(165, 355, 26, 12, '#ff9b3d') + ell(225, 357, 26, 12, '#ff9b3d') +
    circle(235, 160, 72, '#ffd84d') +
    ell(305, 178, 42, 18, '#ff9b3d') + eye(255, 145, 16) + cheek(262, 190) },
  ducklings: { name: 'Duck Family', scene: 'pond', cat: 'pond', draw: () => {
    const d = (x, y, s, c) => `<g transform="translate(${x},${y}) scale(${s})">${ell(0, 40, 60, 42, c)}${circle(28, -15, 38, c)}${ell(64, -5, 22, 10, '#ff9b3d')}${eye(38, -24, 9)}${cheek(44, 2, 8)}</g>`;
    return d(150, 190, 1.6, '#ffffff') + d(270, 290, 0.9, '#ffe066') + d(90, 310, 0.85, '#ffe066') + d(330, 200, 0.75, '#ffe066');
  } },
  turtle: { name: 'Little Turtle', scene: 'meadow', cat: 'pond', draw: () =>
    ell(110, 312, 22, 32, '#9ccc65') + ell(165, 320, 22, 32, '#9ccc65') + ell(235, 320, 22, 32, '#9ccc65') + ell(285, 312, 22, 32, '#9ccc65') +
    p('M60,250 L35,262 L62,272 Z', '#9ccc65') +
    circle(320, 222, 54, '#9ccc65') + eye(338, 205, 15) + cheek(350, 240, 12) + smile(330, 245, 18, 10) +
    p('M65,285 A135,140 0 0 1 335,285 Z', '#4caf50') +
    p('M150,200 L200,170 L250,200 L250,250 L200,275 L150,250 Z', '#7bc96f') +
    circle(105, 250, 22, '#7bc96f') + circle(295, 250, 22, '#7bc96f') +
    `<rect x="55" y="276" width="290" height="26" rx="13" ${st('#8bc34a')}/>` },
  seaturtle: { name: 'Sea Turtle', scene: 'sea', cat: 'pond', draw: () =>
    ell(110, 210, 55, 22, '#80cbc4', 'transform="rotate(-30 110 210)"') + ell(290, 210, 55, 22, '#80cbc4', 'transform="rotate(30 290 210)"') +
    ell(130, 320, 40, 18, '#80cbc4', 'transform="rotate(30 130 320)"') + ell(270, 320, 40, 18, '#80cbc4', 'transform="rotate(-30 270 320)"') +
    circle(200, 120, 46, '#80cbc4') + eyes(182, 218, 112, 12) + smile(200, 138, 14, 8) +
    ell(200, 255, 95, 105, '#26a69a') + p('M200,170 L240,215 L225,285 L175,285 L160,215 Z', '#4db6ac') },
  frog: { name: 'Jolly Frog', scene: 'pond', cat: 'pond', draw: () =>
    ell(120, 345, 50, 22, '#6abf3f') + ell(280, 345, 50, 22, '#6abf3f') +
    ell(200, 270, 135, 95, '#7cc242') + ell(200, 300, 82, 52, '#c5e1a5') +
    circle(135, 170, 50, '#7cc242') + circle(265, 170, 50, '#7cc242') +
    circle(135, 168, 30, '#fff') + circle(265, 168, 30, '#fff') + eye(140, 170, 15) + eye(270, 170, 15) +
    `<path d="M120,235 Q200,290 280,235" fill="#e57373" stroke="${O}" stroke-width="${SW}" stroke-linejoin="round"/>` + cheek(100, 230) + cheek(300, 230) },
  fish: { name: 'Clownfish', scene: 'sea', cat: 'pond', draw: () =>
    p('M85,200 L30,140 L40,200 L30,260 Z', '#ff8a3d') +
    ell(200, 200, 125, 85, '#ff8a3d') +
    p('M150,118 Q150,200 150,282 L120,272 Q118,200 120,128 Z', '#fff') + p('M235,120 Q245,200 235,280 L205,284 Q212,200 205,116 Z', '#fff') +
    p('M170,120 Q200,70 240,118 Z', '#ff8a3d') + ell(220, 270, 30, 14, '#ff8a3d', 'transform="rotate(25 220 270)"') +
    eye(280, 180, 15) + smile(285, 225, 16, 10) },
  whale: { name: 'Blue Whale', scene: 'sea', cat: 'pond', draw: () =>
    p('M60,250 Q20,200 30,160 Q60,195 80,210 Q90,170 120,160 Q110,210 100,250 Z', '#4a90d9') +
    p('M70,250 Q80,130 220,120 Q350,120 350,240 Q350,320 220,320 Q100,320 70,250 Z', '#5aa0e6') +
    p('M120,270 Q220,330 330,265 Q320,310 220,316 Q130,315 120,270 Z', '#cfe8ff') +
    eye(285, 210, 15) + cheek(300, 245) + smile(300, 262, 18, 10) +
    `<path d="M230,115 Q220,70 200,55 M230,115 Q240,70 265,55 M230,115 V60" stroke="#e3f6ff" stroke-width="10" stroke-linecap="round" fill="none"/>` },
  octopus: { name: 'Friendly Octopus', scene: 'sea', cat: 'pond', draw: () =>
    [80, 125, 170, 230, 275, 320].map((x, i) => p(`M${x},230 Q${x + (i % 2 ? 25 : -25)},300 ${x},350 Q${x + 18},355 ${x + 22},340 Q${x + 40 * (i % 2 ? 1 : -0.2)},290 ${x + 30},230 Z`, '#b07cd8')).join('') +
    p('M70,240 Q70,70 200,70 Q330,70 330,240 Z', '#c08ee6') + eyes(160, 240, 170, 17) + cheek(130, 210) + cheek(270, 210) + smile(200, 205, 22, 14) +
    circle(150, 110, 10, '#d9b3f5', 'stroke="none"') + circle(250, 100, 14, '#d9b3f5', 'stroke="none"') },
  crab: { name: 'Little Crab', scene: 'sea', cat: 'pond', draw: () =>
    [0, 1, 2].map(i => line(110 - i * 5, 270 + i * 25, 60 - i * 5, 300 + i * 25, SW * 1.4) + line(290 + i * 5, 270 + i * 25, 340 + i * 5, 300 + i * 25, SW * 1.4)).join('') +
    line(120, 230, 80, 170, SW * 1.4) + line(280, 230, 320, 170, SW * 1.4) +
    p('M40,150 Q60,100 100,120 L80,150 L110,160 Q90,200 50,190 Z', '#f05b4f') + p('M360,150 Q340,100 300,120 L320,150 L290,160 Q310,200 350,190 Z', '#f05b4f') +
    ell(200, 270, 110, 72, '#f05b4f') + line(170, 210, 165, 160) + line(230, 210, 235, 160) + circle(165, 150, 18, '#fff') + circle(235, 150, 18, '#fff') + eye(167, 152, 9) + eye(237, 152, 9) + smile(200, 275, 25, 15) + cheek(140, 275) + cheek(260, 275) },
  monkey: { name: 'Cheeky Monkey', scene: 'jungle', cat: 'jungle', draw: () =>
    p('M270,330 Q370,330 350,250 Q340,215 315,230', 'none', 'stroke-width="14"') +
    ell(200, 315, 78, 62, '#8d5524') + ell(200, 322, 48, 40, '#f1c27d') +
    circle(105, 165, 40, '#8d5524') + circle(295, 165, 40, '#8d5524') + circle(105, 165, 22, '#f1c27d', 'stroke="none"') + circle(295, 165, 22, '#f1c27d', 'stroke="none"') +
    circle(200, 165, 95, '#8d5524') +
    `<g>${circle(168, 155, 44, '#f1c27d')}${circle(232, 155, 44, '#f1c27d')}${ell(200, 205, 74, 52, '#f1c27d')}${flat(circle(168, 155, 44, '#f1c27d'))}${flat(circle(232, 155, 44, '#f1c27d'))}${flat(ell(200, 205, 74, 52, '#f1c27d'))}</g>` +
    eyes(170, 230, 152, 14) + ell(192, 190, 4, 3, O) + ell(208, 190, 4, 3, O) + smile(200, 215, 30, 20) + cheek(150, 200) + cheek(250, 200) },
  monkeybanana: { name: 'Monkey Snack Time', scene: 'jungle', cat: 'jungle', draw: () =>
    animals.monkey.draw() +
    p('M300,250 Q360,235 362,160 Q380,165 378,190 Q372,265 302,276 Z', '#ffe066') + line(362, 160, 366, 145, SW * 1.2) +
    ell(298, 262, 22, 17, '#8d5524') },
  tiger: { name: 'Tiger Cub', scene: 'jungle', cat: 'jungle', draw: () =>
    circle(115, 115, 34, '#ff9a3c') + circle(285, 115, 34, '#ff9a3c') + circle(115, 115, 16, '#fff', 'stroke="none"') + circle(285, 115, 16, '#fff', 'stroke="none"') +
    circle(200, 200, 110, '#ff9a3c') +
    `<g fill="${O}">${[[200, 95, 12, 30], [170, 102, 9, 22], [230, 102, 9, 22]].map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/>`).join('')}<path d="M92,180 L135,192 L92,204 Z"/><path d="M308,180 L265,192 L308,204 Z"/><path d="M100,225 L135,230 L104,245 Z"/><path d="M300,225 L265,230 L296,245 Z"/></g>` +
    ell(200, 245, 62, 45, '#fff') + ell(200, 225, 18, 12, '#ff7aa2') + smile(200, 255, 20, 12) + eyes(160, 240, 185, 15) },
  hippo: { name: 'Happy Hippo', scene: 'pond', cat: 'jungle', draw: () =>
    circle(130, 110, 26, '#b39ddb') + circle(270, 110, 26, '#b39ddb') +
    ell(200, 165, 95, 75, '#b39ddb') + ell(200, 265, 130, 85, '#c5b3e6') +
    ell(155, 245, 12, 9, O) + ell(245, 245, 12, 9, O) + smile(200, 300, 50, 22) + eyes(160, 240, 155, 15) + cheek(120, 285) + cheek(280, 285) },
  fox: { name: 'Little Fox', scene: 'meadow', cat: 'pets', draw: () =>
    tri('95,170', '85,55', '175,110', '#f57c32') + tri('305,170', '315,55', '225,110', '#f57c32') + tri('110,150', '105,85', '155,115', '#3b2f2f') + tri('290,150', '295,85', '245,115', '#3b2f2f') +
    p('M80,160 Q200,60 320,160 Q330,240 200,320 Q70,240 80,160 Z', '#f57c32') +
    p('M95,200 Q150,230 200,320 Q120,270 95,200 Z', '#fff') + p('M305,200 Q250,230 200,320 Q280,270 305,200 Z', '#fff') +
    ell(200, 300, 16, 12, O) + eyes(155, 245, 195, 15) + cheek(140, 235) + cheek(260, 235) },
  hedgehog: { name: 'Hedgehog', scene: 'garden', cat: 'pets', draw: () =>
    p('M70,320 ' + Array.from({ length: 13 }, (_, i) => { const a = Math.PI + (i / 12) * Math.PI; const r = i % 2 ? 150 : 115; return `L${200 + Math.cos(a) * r},${330 + Math.sin(a) * r * 0.95}`; }).join(' ') + ' L330,320 Z', '#8d6e63') +
    p('M230,330 Q240,220 330,250 Q370,270 375,300 Q360,335 300,340 Z', '#f3d2b3') +
    circle(377, 298, 10, O) + eye(318, 280, 11) + cheek(325, 310, 10) + ell(170, 345, 22, 12, '#f3d2b3') + ell(270, 345, 22, 12, '#f3d2b3') },
  mouse: { name: 'Little Mouse', scene: 'garden', cat: 'pets', draw: () =>
    p('M270,330 Q370,330 360,260', 'none', 'stroke-width="9"') +
    circle(110, 120, 62, '#b0bec5') + circle(290, 120, 62, '#b0bec5') + circle(110, 120, 38, '#f8bbd0', 'stroke="none"') + circle(290, 120, 38, '#f8bbd0', 'stroke="none"') +
    ell(200, 320, 75, 55, '#b0bec5') + circle(200, 210, 88, '#cfd8dc') +
    circle(200, 245, 13, '#ff7aa2') + eyes(165, 235, 200, 14) + cheek(140, 240) + cheek(260, 240) +
    line(140, 255, 95, 250, 5) + line(140, 268, 98, 275, 5) + line(260, 255, 305, 250, 5) + line(260, 268, 302, 275, 5) },
  dino: { name: 'Baby Dinosaur', scene: 'meadow', cat: 'jungle', draw: () =>
    p('M120,290 Q40,300 20,250 Q80,270 130,250 Z', '#7bc96f') +
    [150, 185, 220, 250].map((x, i) => tri(`${x - 15},${215 - i * 18}`, `${x},${180 - i * 18}`, `${x + 15},${212 - i * 22}`, '#ffb74d')).join('') +
    `<rect x="140" y="300" width="34" height="60" rx="12" ${st('#7bc96f')}/><rect x="215" y="300" width="34" height="60" rx="12" ${st('#7bc96f')}/>` +
    ell(195, 280, 90, 65, '#7bc96f') + ell(200, 295, 50, 38, '#c5e8b0') +
    p('M240,250 Q250,150 260,120', 'none', 'stroke-width="62" stroke="#3b2f2f"') + p('M240,250 Q250,150 260,120', 'none', 'stroke-width="44" stroke="#7bc96f"') +
    ell(285, 110, 62, 45, '#7bc96f') + eye(295, 95, 13) + cheek(305, 125, 11) + smile(320, 125, 15, 8) + circle(330, 100, 4, O, 'stroke="none"') },
  lion: { name: 'Little Lion', scene: 'jungle', cat: 'jungle', draw: () =>
    Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * Math.PI * 2; return circle(200 + Math.cos(a) * 100, 190 + Math.sin(a) * 100, 42, '#e67e22'); }).join('') +
    circle(200, 190, 105, '#e67e22', 'stroke="none"') +
    circle(130, 120, 26, '#f5c26b') + circle(270, 120, 26, '#f5c26b') +
    circle(200, 195, 88, '#f5c26b') + ell(180, 232, 30, 24, '#fde8c8') + ell(220, 232, 30, 24, '#fde8c8') +
    p('M186,212 L214,212 L200,228 Z', '#8d4a2b') + eyes(165, 235, 180, 14) + cheek(140, 220) + cheek(260, 220) + smile(200, 250, 14, 8) },
  elephant: { name: 'Baby Elephant', scene: 'jungle', cat: 'jungle', draw: () =>
    ell(200, 335, 95, 45, '#a8b4c8') +
    circle(100, 180, 80, '#a8b4c8') + circle(300, 180, 80, '#a8b4c8') + circle(100, 180, 50, '#f4b6c2', 'stroke="none"') + circle(300, 180, 50, '#f4b6c2', 'stroke="none"') +
    circle(200, 185, 95, '#a8b4c8') +
    p('M178,240 Q170,310 200,345 Q235,370 255,340 L238,330 Q222,345 210,325 Q200,300 222,240 Z', '#a8b4c8') +
    eyes(165, 235, 175, 14) + cheek(145, 220) + cheek(255, 220) },
  giraffe: { name: 'Tall Giraffe', scene: 'meadow', cat: 'jungle', draw: () =>
    `<rect x="200" y="300" width="22" height="75" ${st('#f6c445')}/><rect x="275" y="300" width="22" height="75" ${st('#f6c445')}/>` +
    ell(250, 300, 85, 45, '#f6c445') +
    p('M170,300 L140,120 L190,110 L220,290 Z', '#f6c445') +
    line(130, 70, 125, 40) + line(165, 65, 170, 35) + circle(125, 35, 9, '#c47a2c') + circle(170, 32, 9, '#c47a2c') +
    ell(150, 100, 62, 44, '#f6c445') + ell(120, 118, 34, 24, '#fbe3a0') + eye(160, 90, 12) + cheek(175, 115, 11) +
    [[170, 170, 14], [190, 230, 16], [230, 300, 18], [280, 290, 15], [300, 320, 12], [160, 255, 10]].map(([x, y, r]) => circle(x, y, r, '#c47a2c', 'stroke="none"')).join('') },
  panda: { name: 'Sleepy Panda', scene: 'jungle', cat: 'jungle', draw: () =>
    ell(200, 320, 95, 60, '#fff') + ell(120, 330, 30, 40, '#333') + ell(280, 330, 30, 40, '#333') +
    circle(115, 110, 36, '#333') + circle(285, 110, 36, '#333') + circle(200, 180, 100, '#fff') +
    ell(160, 180, 28, 34, '#333', 'transform="rotate(-25 160 180)"') + ell(240, 180, 28, 34, '#333', 'transform="rotate(25 240 180)"') +
    circle(162, 178, 9, '#fff', 'stroke="none"') + circle(238, 178, 9, '#fff', 'stroke="none"') +
    ell(200, 220, 16, 11, O) + smile(200, 238, 16, 10) + cheek(140, 225) + cheek(260, 225) },
  koala: { name: 'Cuddly Koala', scene: 'jungle', cat: 'jungle', draw: () =>
    ell(200, 330, 85, 55, '#9e9e9e') + circle(95, 140, 55, '#9e9e9e') + circle(305, 140, 55, '#9e9e9e') +
    circle(95, 140, 32, '#f8bbd0', 'stroke="none"') + circle(305, 140, 32, '#f8bbd0', 'stroke="none"') +
    circle(200, 190, 95, '#b0b0b0') + ell(200, 210, 26, 34, '#4e4e4e') + eyes(155, 245, 180, 13) + cheek(140, 225) + cheek(260, 225) + smile(200, 255, 14, 8) },
  kangaroo: { name: 'Bouncy Kangaroo', scene: 'meadow', cat: 'jungle', draw: () =>
    p('M140,330 Q60,350 40,300 Q90,320 140,300 Z', '#d08a4c') + ell(200, 290, 75, 85, '#d08a4c') + ell(205, 305, 45, 55, '#f3c99b') +
    ell(170, 370, 55, 15, '#d08a4c') + ell(250, 370, 50, 15, '#d08a4c') +
    ell(170, 75, 15, 40, '#d08a4c', 'transform="rotate(-15 170 75)"') + ell(232, 75, 15, 40, '#d08a4c', 'transform="rotate(15 232 75)"') +
    ell(200, 150, 62, 55, '#d08a4c') + ell(200, 180, 34, 26, '#f3c99b') + ell(200, 168, 10, 7, O) + eyes(178, 222, 140, 12) + cheek(165, 170, 10) + cheek(235, 170, 10) +
    ell(205, 300, 20, 16, '#f3c99b') + circle(205, 290, 14, '#d08a4c') + eye(210, 287, 4) },
  pig: { name: 'Pink Piglet', scene: 'farm', cat: 'farm', draw: () =>
    tri('100,130', '90,60', '160,95', '#f8a5b8') + tri('300,130', '310,60', '240,95', '#f8a5b8') +
    circle(200, 200, 112, '#f8b4c4') + ell(200, 228, 46, 33, '#f48fa8') + ell(186, 228, 7, 11, O) + ell(214, 228, 7, 11, O) +
    eyes(155, 245, 175, 15) + cheek(130, 225) + cheek(270, 225) + smile(200, 272, 20, 12) },
  cow: { name: 'Daisy the Cow', scene: 'farm', cat: 'farm', draw: () =>
    p('M120,95 Q100,60 115,40 Q130,70 150,85 Z', '#ffe082') + p('M280,95 Q300,60 285,40 Q270,70 250,85 Z', '#ffe082') +
    ell(85, 150, 45, 22, '#f8bbd0', 'transform="rotate(20 85 150)"') + ell(315, 150, 45, 22, '#f8bbd0', 'transform="rotate(-20 315 150)"') +
    ell(200, 195, 105, 115, '#fff') + p('M120,110 Q150,100 160,140 Q135,165 110,150 Z', '#3b2f2f') + p('M260,200 Q300,190 300,230 Q270,250 255,230 Z', '#3b2f2f') +
    ell(200, 275, 82, 48, '#f8bbd0') + ell(175, 275, 8, 12, O) + ell(225, 275, 8, 12, O) + eyes(160, 240, 190, 15) },
  chicken: { name: 'Mother Hen', scene: 'farm', cat: 'farm', draw: () =>
    p('M80,230 Q30,180 60,150 Q80,190 110,200 Z', '#fff') + ell(150, 365, 20, 8, '#ff9b3d') + ell(230, 365, 20, 8, '#ff9b3d') + line(150, 330, 150, 362) + line(230, 330, 230, 362) +
    circle(190, 250, 105, '#ffffff') + ell(170, 260, 52, 35, '#eeeeee', 'transform="rotate(-15 170 260)"') +
    p('M225,155 Q230,115 255,130 Q265,105 285,130 Q300,130 290,160 Z', '#e53935') +
    tri('290,175', '345,190', '290,205', '#ffb300') + p('M285,205 Q300,240 280,245 Q270,225 278,205 Z', '#e53935') + eye(262, 165, 14) + cheek(270, 205, 11) },
  chick: { name: 'Fluffy Chick', scene: 'garden', cat: 'farm', draw: () =>
    ell(170, 365, 20, 8, '#ff9b3d') + ell(230, 365, 20, 8, '#ff9b3d') +
    ell(200, 255, 115, 112, '#ffe14d') + p('M200,145 Q190,110 205,100 Q215,120 210,145 Z', '#ffe14d') +
    ell(110, 265, 28, 50, '#ffd21f', 'transform="rotate(20 110 265)"') + ell(290, 265, 28, 50, '#ffd21f', 'transform="rotate(-20 290 265)"') +
    tri('180,235', '220,235', '200,262', '#ff9b3d') + eyes(160, 240, 210, 15) + cheek(140, 245) + cheek(260, 245) },
  sheep: { name: 'Woolly Sheep', scene: 'farm', cat: 'farm', draw: () =>
    `<rect x="130" y="300" width="22" height="65" ${st('#4e4e4e')}/><rect x="250" y="300" width="22" height="65" ${st('#4e4e4e')}/>` +
    Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return circle(200 + Math.cos(a) * 100, 240 + Math.sin(a) * 65, 40, '#fdf6e3'); }).join('') +
    ell(200, 240, 110, 72, '#fdf6e3', 'stroke="none"') +
    ell(120, 150, 34, 16, '#6d6d6d', 'transform="rotate(25 120 150)"') + ell(280, 150, 34, 16, '#6d6d6d', 'transform="rotate(-25 280 150)"') +
    ell(200, 175, 60, 70, '#6d6d6d') + circle(200, 115, 30, '#fdf6e3') + circle(175, 120, 22, '#fdf6e3') + circle(225, 120, 22, '#fdf6e3') +
    `<circle cx="178" cy="172" r="12" fill="#fff"/><circle cx="222" cy="172" r="12" fill="#fff"/>` + eyes(180, 224, 174, 9) + smile(200, 210, 14, 8) },
  cat: { name: 'Ginger Cat', scene: 'garden', cat: 'pets', draw: () =>
    tri('105,150', '95,55', '175,105', '#ff9f43') + tri('295,150', '305,55', '225,105', '#ff9f43') + tri('115,130', '110,80', '155,108', '#ffb8c6') + tri('285,130', '290,80', '245,108', '#ffb8c6') +
    circle(200, 205, 112, '#ff9f43') + p('M170,98 L180,135 L190,98 M210,98 L220,135 L230,98', 'none', `stroke="${O}"`) +
    eyes(155, 245, 195, 16) + tri('188,232', '212,232', '200,245', '#ff7aa2') + `<path d="M200,245 Q190,262 176,255 M200,245 Q210,262 224,255" fill="none" stroke="${O}" stroke-width="6" stroke-linecap="round"/>` +
    line(100, 235, 150, 240, 5) + line(100, 258, 150, 252, 5) + line(300, 235, 250, 240, 5) + line(300, 258, 250, 252, 5) + cheek(130, 228) + cheek(270, 228) },
  dog: { name: 'Puppy', scene: 'garden', cat: 'pets', draw: () =>
    ell(95, 200, 40, 80, '#8d5a3b', 'transform="rotate(15 95 200)"') + ell(305, 200, 40, 80, '#8d5a3b', 'transform="rotate(-15 305 200)"') +
    circle(200, 190, 105, '#f2d4b0') + ell(240, 160, 38, 40, '#c48a5a', 'stroke="none"') +
    ell(200, 240, 58, 42, '#fff') + ell(200, 220, 22, 15, O) + `<path d="M188,262 Q200,295 212,262 Z" fill="#ff7aa2" stroke="${O}" stroke-width="6"/>` + smile(200, 245, 24, 14) +
    eyes(160, 240, 170, 15) + cheek(135, 215) + cheek(265, 215) },
  bunny: { name: 'Bunny', scene: 'garden', cat: 'pets', draw: () =>
    ell(160, 90, 30, 80, '#fff') + ell(240, 90, 30, 80, '#fff') + ell(160, 95, 14, 58, '#ffb8c6', 'stroke="none"') + ell(240, 95, 14, 58, '#ffb8c6', 'stroke="none"') +
    ell(200, 320, 85, 60, '#fff') + circle(200, 210, 95, '#fff') +
    eyes(165, 235, 200, 15) + ell(200, 232, 10, 7, '#ff7aa2') + `<rect x="190" y="248" width="20" height="18" rx="3" ${st('#fff')}/>` + cheek(140, 240) + cheek(260, 240) },
  owl: { name: 'Night Owl', scene: 'night', cat: 'pets', draw: () =>
    `<rect x="40" y="335" width="320" height="22" rx="11" ${st('#8d6e63')}/>` +
    tri('110,95', '120,40', '160,85', '#8d6e63') + tri('290,95', '280,40', '240,85', '#8d6e63') +
    ell(200, 220, 115, 135, '#8d6e63') + ell(200, 260, 72, 85, '#d7ccc8') +
    ell(95, 240, 30, 70, '#6d4c41', 'transform="rotate(10 95 240)"') + ell(305, 240, 30, 70, '#6d4c41', 'transform="rotate(-10 305 240)"') +
    circle(155, 165, 45, '#fff') + circle(245, 165, 45, '#fff') + eye(158, 168, 20) + eye(248, 168, 20) + tri('188,200', '212,200', '200,225', '#ffb300') +
    [175, 200, 225].map(x => `<path d="M${x - 10},270 L${x},280 L${x + 10},270" fill="none" stroke="#a1887f" stroke-width="5"/>`).join('') },
  penguin: { name: 'Penguin', scene: 'snow', cat: 'pets', draw: () =>
    ell(165, 365, 28, 12, '#ff9b3d') + ell(235, 365, 28, 12, '#ff9b3d') +
    ell(95, 245, 26, 70, '#2c3e50', 'transform="rotate(20 95 245)"') + ell(305, 245, 26, 70, '#2c3e50', 'transform="rotate(-20 305 245)"') +
    ell(200, 225, 112, 145, '#2c3e50') + ell(200, 255, 78, 105, '#fff') +
    ell(170, 160, 34, 40, '#fff', 'stroke="none"') + ell(230, 160, 34, 40, '#fff', 'stroke="none"') +
    eyes(170, 230, 160, 13) + tri('182,185', '218,185', '200,205', '#ff9b3d') + cheek(150, 200) + cheek(250, 200) },
  snail: { name: 'Snail', scene: 'garden', cat: 'pets', draw: () =>
    p('M40,345 Q60,290 120,300 L300,300 Q350,300 350,345 Z', '#ffcc80') +
    line(300, 300, 290, 230) + line(325, 302, 340, 235) + circle(290, 225, 10, '#ffcc80') + circle(340, 230, 10, '#ffcc80') + eye(305, 275, 11) + smile(325, 290, 12, 8) +
    circle(185, 225, 100, '#ef8f5f') + `<path d="M185,225 m0,-70 a70,70 0 1,1 -1,0 m1,30 a40,40 0 1,0 1,0 m-1,22 a18,18 0 1,1 -1,0" fill="none" stroke="${O}" stroke-width="7"/>` },
  bee: { name: 'Busy Bee', scene: 'garden', cat: 'pets', draw: () =>
    ell(150, 120, 55, 75, '#e3f6ff', 'transform="rotate(-25 150 120)"') + ell(250, 120, 55, 75, '#e3f6ff', 'transform="rotate(25 250 120)"') +
    tri('320,230', '370,240', '320,250', '#3b2f2f') +
    ell(220, 240, 115, 85, '#ffd54f') +
    `<clipPath id="bb"><ellipse cx="220" cy="240" rx="111" ry="81"/></clipPath><g clip-path="url(#bb)" fill="${O}"><rect x="190" y="150" width="34" height="200"/><rect x="262" y="150" width="34" height="200"/></g>` +
    ell(220, 240, 115, 85, 'none') + circle(115, 230, 60, '#ffd54f') + line(95, 175, 75, 125) + line(125, 172, 135, 122) + circle(75, 120, 9, O) + circle(135, 118, 9, O) +
    eyes(98, 138, 225, 12) + cheek(90, 255) + smile(118, 255, 14, 8) },
  ladybug: { name: 'Ladybird', scene: 'garden', cat: 'pets', draw: () =>
    [[110, 330], [140, 345], [260, 345], [290, 330]].map(([x, y]) => line(x + (x < 200 ? 30 : -30), y - 40, x, y + 10)).join('') +
    circle(200, 125, 60, O) + circle(180, 115, 10, '#fff', 'stroke="none"') + circle(220, 115, 10, '#fff', 'stroke="none"') +
    ell(200, 245, 130, 115, '#e53935') + line(200, 135, 200, 360) +
    [[140, 210, 24], [260, 210, 24], [130, 290, 20], [270, 290, 20], [170, 330, 14], [230, 330, 14]].map(([x, y, r]) => circle(x, y, r, O, 'stroke="none"')).join('') },
};

// ---------- render ----------
const svgDoc = (body, bg) => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">${bg || ''}${body}</svg>`;
const CATS = { pond: 'Cartoon Pond & Sea', jungle: 'Cartoon Jungle', farm: 'Cartoon Farm', pets: 'Cartoon Pals' };

await fs.mkdir(RAW, { recursive: true });
const byCat = Object.fromEntries(Object.keys(CATS).map(k => [k, []]));
for (const [id, a] of Object.entries(animals)) {
  const body = a.draw();
  for (const variant of ['scene', 'sticker']) {
    const key = `cartoon-${id}-${variant}`;
    const svg = svgDoc(body, variant === 'scene' ? scenes[a.scene] : '');
    await sharp(Buffer.from(svg)).resize(480, 480).png().toFile(path.join(RAW, key));
    byCat[a.cat].push({
      key, source: 'cartoon', nocut: variant === 'scene',
      title: variant === 'scene' ? a.name : `${a.name} Sticker`,
      artist: 'Paint Pixels', date: '2026', url: 'local', page: 'https://github.com/nugggy/paint-pixels',
      licence: 'CC0 (original artwork)',
    });
  }
}

const cand = JSON.parse(await fs.readFile(CANDIDATES, 'utf8'));
cand.categories = cand.categories.filter(c => !c.id.startsWith('cartoon-'));
cand.categories.unshift(...Object.entries(CATS).map(([k, name]) => ({ id: 'cartoon-' + k, name, items: byCat[k] })));
await fs.writeFile(CANDIDATES, JSON.stringify(cand, null, 1));
console.log('cartoons:', Object.values(byCat).reduce((n, l) => n + l.length, 0));

if (process.argv.includes('--sheet')) {
  const keys = Object.values(byCat).flat().map(i => i.key);
  const T = 200, COLS = 8;
  const comps = await Promise.all(keys.map(async (k, n) => ({
    input: await sharp(path.join(RAW, k)).flatten({ background: '#eee' }).resize(T - 6, T - 6).png().toBuffer(),
    left: (n % COLS) * T + 3, top: Math.floor(n / COLS) * T + 3,
  })));
  await sharp({ create: { width: COLS * T, height: Math.ceil(keys.length / COLS) * T, channels: 3, background: '#fff' } })
    .composite(comps).jpeg({ quality: 85 }).toFile(path.resolve('tools/cache/cartoon-sheet.jpg'));
  console.log('sheet written');
}
