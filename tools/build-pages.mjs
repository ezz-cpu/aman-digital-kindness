import { readFile, writeFile, mkdir, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'release', 'pages');
// Publish the browser assets only. Account databases and server settings never enter this directory.
const files = [
  'index.html', 'about.html', 'resources.html', 'interactive.html', 'login.html',
  'signup.html', 'dashboard.html', 'privacy.html', 'tobi.html', 'tobi-studio.html',
  'styles.css', 'aman-experience.css', 'script.js', 'aman-scene.bundle.js',
  'tobi.css', 'tobi-refresh.css', 'tobi.bundle.js', 'favicon.svg',
  '1.png', '9.png', 'save-world-preview.png',
  'tobi-assets/tobi.svg', 'tobi-assets/tobi-blink.svg', 'tobi-assets/tobi-jump.svg',
  'tobi-assets/original-background.jpg', 'vendor/three/LICENSE.txt',
];

async function checkOutput(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (!prefix && name === '.git' && entry.isDirectory()) continue;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected link in Pages output: ${name}`);
    if (entry.isDirectory()) await checkOutput(path.join(directory, entry.name), name + '/');
    else if (!files.includes(name) && name !== '.nojekyll') throw new Error(`Unexpected file in Pages output: ${name}`);
  }
}

await mkdir(output, { recursive: true });
await checkOutput(output);
const tobiSource = await lstat(path.join(root, 'tobi.js'));
const tobiBundle = await lstat(path.join(root, 'tobi.bundle.js'));
if (tobiSource.mtimeMs > tobiBundle.mtimeMs) throw new Error('Rebuild the browser bundles before publishing Pages.');
for (const name of files) {
  const source = path.join(root, name);
  const stat = await lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular public asset: ${name}`);
  let content = await readFile(source);
  if (/\.(html|js|css|svg|txt)$/.test(name) && /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/.test(content.toString('utf8'))) {
    throw new Error(`Possible credential in public asset: ${name}`);
  }
  if (name.endsWith('.html')) {
    const html = content.toString('utf8');
    if (!html.includes('<head>')) throw new Error(`Missing HTML head: ${name}`);
    content = Buffer.from(html.replace('<head>', '<head>\n<meta name="aman-static-site" content="true">'));
  }
  const target = path.join(output, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}
await writeFile(path.join(output, '.nojekyll'), '');
console.log(`Built ${files.length} browser assets in ${output}`);
