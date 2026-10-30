import { lstat, readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Never recurse over the workspace: personal data and credentials are not deliverables.
const allowedFiles = [
  'server.js', 'database.js', 'server-secrets.js', 'request-limits.js', 'public-files.js', 'tobi-service.js', 'tobi-ai.js', 'tobi-public.js', 'tobi-content.js',
  'index.html', 'about.html', 'resources.html', 'interactive.html', 'login.html',
  'signup.html', 'dashboard.html', 'privacy.html', 'tobi.html', 'tobi-studio.html',
  'styles.css', 'script.js', 'favicon.svg', '1.png', '9.png', 'save-world-preview.png',
  'aman-experience.css', 'aman-scene.js', 'aman-scene.bundle.js',
  'tobi.js', 'tobi.bundle.js', 'tobi.css', 'tobi-refresh.css',
  'tobi-assets/tobi.svg', 'tobi-assets/tobi-blink.svg', 'tobi-assets/tobi-jump.svg',
  'tobi-assets/original-background.jpg', 'vendor/three/three.module.min.js',
  'vendor/three/LICENSE.txt', 'Dockerfile', '.dockerignore', 'render.yaml', '.env.example', 'DEPLOYMENT.md',
  'README.md', 'TOBI-SETUP.md', 'Open Aman.cmd', 'tools/start-aman.ps1',
];
const textFile = /\.(?:js|html|css|svg|md|txt|cmd|ps1|json|ya?ml)$/i;
const keyPattern = /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|\bpostgres(?:ql)?:\/\/[^\s/@]+:[^\s/@]+@|\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/;

function insideRoot(filename) {
  const relative = path.relative(root, filename);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function loadPublicFile(name) {
  const filename = path.join(root, ...name.split('/'));
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || !insideRoot(await realpath(filename))) {
    throw new Error(`Refusing a link or non-file in the deployment allowlist: ${name}`);
  }
  const content = await readFile(filename);
  if ((textFile.test(name) || ['Dockerfile', '.dockerignore', '.env.example'].includes(name)) && keyPattern.test(content.toString('utf8'))) {
    throw new Error(`Possible API credential found in ${name}. Remove it before packaging; its value was not printed.`);
  }
  return { name, content, modified: stat.mtimeMs };
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[n] = value >>> 0;
}
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ZIP STORE is enough for this small prebuilt website and needs no npm dependency.
function makeZip(files) {
  const records = [], directory = [];
  let offset = 0;
  for (const { name, content } of files) {
    const filename = Buffer.from(name, 'utf8'), crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); // UTF-8 filenames
    local.writeUInt16LE(33, 12); // 1980-01-01, reproducible archive date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(filename.length, 26);
    records.push(local, filename, content);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, filename);
    offset += local.length + filename.length + content.length;
  }
  const directorySize = directory.reduce((total, chunk) => total + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...records, ...directory, end]);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--check', '--list'].includes(arg))) throw new Error('Usage: node tools/package-website.mjs [--check] [--list]');
  const files = await Promise.all(allowedFiles.map(loadPublicFile));
  for (const [bundle, sources] of [
    ['aman-scene.bundle.js', ['aman-scene.js', 'vendor/three/three.module.min.js']],
    ['tobi.bundle.js', ['tobi.js', 'tobi-content.js']],
  ]) {
    const built = files.find(file => file.name === bundle);
    if (!built.content.length || sources.some(source => files.find(file => file.name === source).modified > built.modified)) {
      throw new Error(`${bundle} needs rebuilding. Run npm.cmd run build:browser before packaging.`);
    }
  }
  const project = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  // Generate a matching runtime manifest and lockfile without development packages.
  const manifest = {
    name: 'aman-digital-kindness', version: project.version, private: true,
    type: 'module', engines: { node: '>=24' }, scripts: { start: 'node server.js' },
    dependencies: project.dependencies,
  };
  files.push({ name: 'package.json', content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) });
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  lock.packages = Object.fromEntries(Object.entries(lock.packages).filter(([name, entry]) => name && !entry.dev));
  lock.packages[''] = { name: manifest.name, version: manifest.version, engines: manifest.engines, dependencies: manifest.dependencies };
  files.push({ name: 'package-lock.json', content: Buffer.from(`${JSON.stringify(lock, null, 2)}\n`) });
  if (args.includes('--list')) console.log(files.map(file => file.name).sort().join('\n'));
  const total = files.reduce((size, file) => size + file.content.length, 0);
  if (args.includes('--check') || args.includes('--list')) {
    console.log(`Checked ${files.length} allowlisted files (${total} bytes). No archive written; private data files were not read.`);
    return;
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const output = path.join(root, 'release', `aman-website-${stamp}.zip`);
  const outputParent = path.dirname(output);
  await mkdir(outputParent, { recursive: true });
  if (!insideRoot(await realpath(outputParent))) throw new Error('The release directory must stay inside this project.');
  await writeFile(output, makeZip(files), { flag: 'wx' });
  console.log(`Created ${output}\n${files.length} allowlisted files. Private data, credentials, dependencies, tests, and original game projects were excluded.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
