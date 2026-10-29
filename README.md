# Aman · أمان

A complete Arabic / English cyberbullying awareness website with an animated interface, real accounts, a resource library, a learning challenge, and personal progress.

## Public website

Share **https://ezz-cpu.github.io/aman-digital-kindness/** to explore the guides, games, and Tobi's free notebook. The GitHub Pages version does not offer account sign-in or AI chat; those features work when the Node.js server is hosted. The public build identifies this clearly and never requests passwords or server APIs.

Run `npm run build:browser` followed by `npm run build:pages` to generate the public assets in `release/pages/`. Publish that directory to the `codex/pages` branch. The build copies an explicit browser-file allowlist and marks its HTML for public play without a server.

## Run locally

On this Windows computer, double-click **Open Aman.cmd** to start the website and open it in your browser. The launcher reuses an already running Aman server. Directly opening index.html also displays the 3D scene, but accounts and AI need the server.

Install **Node.js 22.13 or newer** (Node 24 recommended), then run:

```sh
npm install
npm start
```

Open **http://127.0.0.1:3000**. The website needs this server for accounts and saved progress; opening the HTML directly or using a static-only server cannot provide authentication. The server has no runtime npm dependencies. The 3D library is served from the local `vendor/three/` folder; `npm install` installs development and browser-testing tools.

## Included

- A real interactive 3D world on the homepage: a lavender shield, heart, and chat bubble, with pointer tilt, rotate/reset controls, and a motion toggle. Three.js is bundled locally under its MIT license in `vendor/three/LICENSE.txt`; all scene geometry is authored in `aman-scene.js`.
- The scene respects reduced-motion preferences, pauses when offscreen or the tab is hidden, and shows an HTML/CSS illustration when WebGL is unavailable. Core navigation and support work independently of 3D.
- Refined cream-and-purple styling in `aman-experience.css`, tactile learning cards, clearer homepage routes, and a bilingual kindness postcard with a button to read another thought. The postcard stores no personal data.

- **Tobi's Safe Space** runs directly at `tobi.html`: the original bear character and glasses with the site's cream-and-purple theme, bilingual notebook chat, Safety Quest, Word Lab and Movie Riddles. No PictoBlox or API key is required for the free mode.
- **Save the World** links to the [improved Arabic Godot game on itch.io](https://ezz-king33.itch.io/save-the-world-with-godot). It follows three stories about cyberbullying: collect supportive words to reach 1,000 points and avoid hurtful words. The website card shows a screenshot from this edition. The itch.io build runs independently of Tobi and needs no API key.
- **Tobi Studio** at `tobi-studio.html#ai` lets the owner add, replace, test, and disconnect an OpenAI API key from the website. Keys are encrypted on the server; saving does not enable AI. The owner can share AI with all visitors or signed-in members and set persistent site, visitor/account, and network request limits. Visitors never receive the key; the owner pays for API usage. Tobi has automatic notebook-first replies and an optional full AI conversation mode. See [Tobi setup](TOBI-SETUP.md).

- Arabic by default, with persistent English switching and responsive RTL/LTR layouts.
- Shared design across home, about, resources, interactive tools, login, signup, dashboard, and privacy pages.
- Original CSS illustrations, floating elements, scroll reveals, hover feedback, and reduced-motion support.
- Sign-up with confirmation and password visibility controls; login, persistent sessions, and logout.
- Server-side scrypt password hashing with individual salts. Plaintext passwords are not saved in the browser or database.
- HttpOnly session cookies, same-origin checks, JSON-only writes, authentication rate limits, and an explicit public-file allowlist.
- Searchable resources with audience filters, bookmarks, a four-step safety checklist, and a five-question challenge with explanations.
- Guest access to all educational content. A guest quiz result can be saved after login in the same browser tab.
- Original game artwork and links preserved. The original `.exe` and `.sb3` files remain on disk but are not served publicly.

## Data and deployment

Account and progress data live in `.data/aman.sqlite`. Keep `.data/` private and persistent, and include it in your backup plan. The old browser-only login was replaced; previous localStorage credentials are cleared, and users should create a new account.

Preserve the entire data directory, including `.data/tobi-keyring.bin` and `.data/tobi-visitor-secret.bin`, with the database so encrypted credentials and visitor limits can be restored. Chat text is not saved by the app. Public AI uses a signed essential visitor cookie and HMAC network counters.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listening port |
| `HOST` | `127.0.0.1` | Listening interface; use `0.0.0.0` in a hosted container if needed |
| `DATA_DIR` | `.data` in this project | Persistent database directory |
| `NODE_ENV` | unset | Set to `production` behind HTTPS to enable Secure cookies |
| `APP_ORIGIN` | inferred from the Host header | Exact public origin, such as `https://aman.example`, when behind a proxy |
| `TRUST_PROXY_HOPS` | `0` | Number of actual trusted proxy hops, from 0 to 10; leave 0 unless the deployment topology is verified |

For public deployment, follow the Arabic [deployment guide](DEPLOYMENT.md). Use HTTPS, set `NODE_ENV=production` and `APP_ORIGIN`, and preserve the data directory. The Dockerfile runs Node 24 as a nonroot user with persistent `/data`; it requires prebuilt browser bundles and no npm runtime dependencies. `GET /api/health` reports readiness. Run one server instance only.

Daily AI quotas are persisted in SQLite. Short request-rate limits and the concurrency cap live in the server process. Configure `TRUST_PROXY_HOPS` only for the actual trusted topology and block direct access to the backend; otherwise forwarded client headers must not be trusted. A reverse proxy should also enforce client rate limits.

To create a clean deployment ZIP after rebuilding, run `node tools/package-website.mjs --check` and then `node tools/package-website.mjs`. The archive contains only an explicit runtime allowlist and a minimal package manifest. It excludes `.env`, `.data`, development dependencies, tests, and original game projects. The archive does not contain your owner account or API key; set those up privately on the hosted server. Packaging does not publish the site.

Email verification, password recovery, social login, and email delivery are not configured. The support panel provides educational guidance; it is not a live reporting or emergency service. No analytics or advertising are included. Google Fonts requires an internet connection; system fonts are used if unavailable.

## Checks

```sh
npm test
npm run test:ui
npm run test:a11y
npm run test:scene
npm run test:tobi
npm run test:tobi-ai
npm run test:tobi-public
npm run test:local
```

The UI test uses installed Chrome on Windows. Set `CHROME_PATH` for a different executable, or run `npx playwright install chromium` to use Playwright's browser. Account and UI tests create temporary databases and remove only their own data afterward. UI screenshots are written to `test-results/`. Run `npm start` before `npm run test:a11y`; the read-only accessibility check audits public pages in both languages on port 3000. API connection tests use simulated provider replies, never real API keys.

After editing `aman-scene.js`, `tobi.js`, or `tobi-content.js`, run `npm run build:browser` to regenerate the classic browser bundles used by both direct-file and HTTP opening. Stylesheets do not need rebuilding.
