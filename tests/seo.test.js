import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { listenForTests } from './helpers/http-server.mjs';

const origin = 'https://aman-digital-kindness.vercel.app';

test('search engines can discover and read public pages without JavaScript', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'aman-seo-test-'));
  const server = await createApp({ dataDir, databaseUrl: '', masterSecret: '', ownerCode: '', tobiOptions: { apiKey: '' } });
  try {
    await listenForTests(server);
    const base = `http://127.0.0.1:${server.address().port}`;
    const robots = await fetch(base + '/robots.txt');
    assert.equal(robots.status, 200);
    assert.match(robots.headers.get('content-type'), /^text\/plain/);
    const rules = await robots.text();
    assert.ok(rules.includes(`Sitemap: ${origin}/sitemap.xml`));
    assert.ok(rules.includes('Disallow: /api/'));
    assert.doesNotMatch(rules, /^Disallow:\s*\/$/m);

    const sitemap = await fetch(base + '/sitemap.xml');
    assert.equal(sitemap.status, 200);
    assert.match(sitemap.headers.get('content-type'), /^application\/xml/);
    const xml = await sitemap.text();
    assert.match(xml, /xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9"/);
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    assert.equal(urls.length, 6);
    assert.equal(new Set(urls).size, urls.length);
    const titles = new Set(), descriptions = new Set();
    for (const url of urls) {
      assert.equal(new URL(url).origin, origin);
      const response = await fetch(base + new URL(url).pathname);
      assert.equal(response.status, 200, url);
      const html = await response.text();
      assert.ok(html.includes(`<link rel="canonical" href="${url}">`), url);
      assert.doesNotMatch(html, /name="robots" content="noindex/);
      assert.match(html, /<h1>[^<]{12,}<\/h1>/);
      assert.match(html, /<a href="about.html">/);
      assert.match(html, /<a href="tobi.html">/);
      titles.add(html.match(/<title>([^<]+)<\/title>/)[1]);
      descriptions.add(html.match(/name="description" content="([^"]+)"/)[1]);
    }
    assert.equal(titles.size, urls.length);
    assert.equal(descriptions.size, urls.length);

    for (const page of ['login.html', 'signup.html', 'dashboard.html', 'tobi-studio.html']) {
      const response = await fetch(`${base}/${page}`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /name="robots" content="noindex, follow"/);
      assert.ok(!urls.includes(`${origin}/${page}`));
      assert.ok(!rules.includes(`Disallow: /${page}`), 'Crawlers must be able to read the noindex directive.');
    }
    assert.equal((await fetch(base + '/api/health')).headers.get('x-robots-tag'), 'noindex');
    const home = await (await fetch(base)).text();
    assert.match(home, /name="google-site-verification" content="[\w-]+"/);
    const schema = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(schema['@type'], 'WebSite');
    assert.equal(schema.url, origin + '/');
    const preview = await fetch(base + '/aman-social-preview.png');
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('content-type'), 'image/png');
    const image = Buffer.from(await preview.arrayBuffer());
    assert.equal(image.readUInt32BE(16), 1200);
    assert.equal(image.readUInt32BE(20), 630);
    const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
    assert.ok(vercel.headers.some(rule => rule.source === '/api/:path*' && rule.headers.some(header => header.key === 'X-Robots-Tag' && header.value === 'noindex')));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await server.databaseClosed;
    assert.ok(path.resolve(dataDir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dataDir).startsWith('aman-seo-test-'));
    await rm(dataDir, { recursive: true, force: true });
  }
});
