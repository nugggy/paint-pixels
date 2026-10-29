// Adds images to tools/rejects.txt by contact-sheet position after manual review.
// Usage: node tools/reject.mjs birds-0:2,3,17 potter-0:5
import fs from 'node:fs/promises';
import path from 'node:path';

const sheets = JSON.parse(await fs.readFile(path.resolve('tools/cache/sheets/index.json'), 'utf8'));
const file = path.resolve('tools/rejects.txt');
const existing = await fs.readFile(file, 'utf8').catch(() => '');
const lines = [];
for (const arg of process.argv.slice(2)) {
  const [sheet, list] = arg.split(':');
  const entries = sheets[sheet];
  if (!entries) throw new Error('Unknown sheet ' + sheet);
  for (const n of list.split(',').map(Number)) {
    if (!entries[n]) throw new Error(`${sheet} has no index ${n}`);
    lines.push(entries[n]);
  }
}
await fs.writeFile(file, existing + lines.map(l => l + '\n').join(''));
console.log(`rejected ${lines.length} images`);
