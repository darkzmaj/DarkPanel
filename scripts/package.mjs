// Builds release ZIPs in dist/:
//   darkpanel-<version>.zip      upload to the Chrome Web Store, or unzip and Load unpacked
//   graphite-dark-<version>.zip  the theme
// The development-only "key" field is removed from the packaged manifest
// (the Web Store assigns its own ID).
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

// Minimal ZIP writer (deflate, no zip64) - enough for an extension bundle.
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt32LE(offset, 42);
    local.push(head, nameBuf, packed);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

function build(srcDir, outName, transform = (n, d) => d) {
  const src = join(root, srcDir);
  const entries = files(src).filter((p) => !p.endsWith('Cached Theme.pak')).sort().map((p) => {
    const name = relative(src, p).split(sep).join('/');
    return { name, data: transform(name, readFileSync(p)) };
  });
  const version = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8')).version;
  mkdirSync(join(root, 'dist'), { recursive: true });
  const out = join(root, 'dist', `${outName}-${version}.zip`);
  writeFileSync(out, zip(entries));
  console.log(`${relative(root, out)}  (${entries.length} files)`);
}

build('extensions/dark-panel', 'darkpanel', (name, data) => {
  if (name !== 'manifest.json') return data;
  const m = JSON.parse(data.toString('utf8'));
  delete m.key;
  return Buffer.from(JSON.stringify(m, null, 2) + '\n');
});
build('themes/graphite-dark', 'graphite-dark');
