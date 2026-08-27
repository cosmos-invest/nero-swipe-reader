import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const root = process.cwd();
const packedDir = path.join(root, 'packed');
const targets = [
  'extension/background.js',
  'extension/note-bridge.js',
  'extension/reader-bridge.js',
  'src/worker.js'
];
const partChars = 10000;
const manifestPath = path.join(packedDir, 'manifest.json');
const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const manifest = {};

fs.mkdirSync(packedDir, { recursive: true });
for (const target of targets) {
  const sourcePath = path.join(root, target);
  const raw = fs.readFileSync(sourcePath);
  const encoded = zlib.gzipSync(raw, { level: 9 }).toString('base64');
  const prefix = target.replaceAll('/', '__');
  const chunks = [];
  for (let offset = 0; offset < encoded.length; offset += partChars) chunks.push(encoded.slice(offset, offset + partChars));
  const parts = chunks.map((_, index) => `${prefix}.part${String(index + 1).padStart(2, '0')}.b64`);
  for (const stale of previous[target]?.parts || []) {
    if (!parts.includes(stale)) fs.rmSync(path.join(packedDir, stale), { force: true });
  }
  chunks.forEach((chunk, index) => fs.writeFileSync(path.join(packedDir, parts[index]), `${chunk}\n`));
  manifest[target] = {
    sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    parts,
    bytes: raw.length
  };
  console.log(`packed ${target} (${raw.length} bytes, ${parts.length} parts)`);
}

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
