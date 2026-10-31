import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicFiles } from '../public-files.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'release', 'vercel');
const inside = filename => filename.startsWith(root + path.sep);
const secretPattern = /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|\bpostgres(?:ql)?:\/\/[^\s/@]+:[^\s/@]+@|\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/;

await mkdir(output, { recursive: true });
if (!inside(await realpath(output))) throw new Error('The Vercel output must remain inside this project.');
async function checkOutput(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected link in Vercel output: ${name}`);
    if (entry.isDirectory()) await checkOutput(path.join(directory, entry.name), name + '/');
    else if (!publicFiles.includes(name)) throw new Error(`Unexpected file in Vercel output: ${name}`);
  }
}
await checkOutput(output);
for (const name of publicFiles) {
  const source = path.join(root, name);
  const stat = await lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink() || !inside(await realpath(source))) throw new Error(`Unsafe browser asset: ${name}`);
  const bytes = await readFile(source);
  if (/\.(html|css|js|svg|txt|xml)$/.test(name) && secretPattern.test(bytes.toString('utf8'))) throw new Error(`Possible secret in browser asset: ${name}`);
  const target = path.join(output, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
console.log(`Built ${publicFiles.length} public assets in ${output}. Accounts use the private API function.`);
