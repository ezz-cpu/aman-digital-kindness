# Aman · أمان

A complete Arabic / English cyberbullying awareness website with an animated interface, real accounts, a resource library, a learning challenge, and personal progress.

## Public website

The full website is live at **[aman-digital-kindness.vercel.app](https://aman-digital-kindness.vercel.app/)**. Share this link for sign-up, login, saved progress, and Tobi's free notebook and games.

It runs on **Vercel Hobby with a Neon Free PostgreSQL database**, without a payment card. Both providers have free usage limits. Paid AI is disabled; connecting OpenAI is optional and has separate usage charges. [Deployment and recovery instructions](DEPLOYMENT.md).

Render Free is also supported by `render.yaml`, but Render required card verification for this account even with its $0/month service selected. Use Vercel when a card is not an option.

The existing **[GitHub Pages edition](https://ezz-cpu.github.io/aman-digital-kindness/)** offers the guides, games, and Tobi's free notebook. Use the Vercel link above for accounts and saved progress. GitHub Pages cannot run the account server; its public build identifies this clearly and never requests passwords or server APIs.

Run `npm run build:browser` followed by `npm run build:pages` to generate the public assets in `release/pages/`. Publish that directory to the `codex/pages` branch. The build copies an explicit browser-file allowlist and marks its HTML for public play without a server.

Vercel instead runs `npm run build:vercel`: it builds the browser bundles and copies only the public allowlist to `release/vercel/`, retaining the real login pages. `/api/*` is routed to one private Node.js function. Deployment settings and server modules are never copied to the public directory. Configure production database credentials and secrets in Vercel, and select its Hobby plan.

## Google Search (free)

The public pages include individual Arabic titles and descriptions, canonical URLs, readable initial HTML, and sharing previews. The homepage identifies the site as **أمان / Aman Digital Kindness** using WebSite structured data. The English switch remains available in the browser; separate English URLs are not advertised.

`robots.txt` points to `https://aman-digital-kindness.vercel.app/sitemap.xml`, which contains the six public educational and privacy pages. Login, signup, dashboard, and Tobi Studio have `noindex` metadata; API responses are also marked `noindex`. Keep those pages crawlable so search engines can read the directive. These indexing directives do not replace authentication.

Use a **URL-prefix property** for `https://aman-digital-kindness.vercel.app/` in Google Search Console. The homepage includes the owner's public HTML verification tag; preserve it when editing the page. Once ownership is verified, submit `sitemap.xml` and use URL Inspection to request indexing of the homepage. Search Console, sitemap submission, and organic search inclusion have no Google fee. The existing free hosting URL is sufficient; a custom domain or advertising is optional. Submission does not guarantee indexing, timing, or rankings.

Run `npm test` and `npm run build:vercel` after changing public metadata or discovery files. Keep the public-file and packaging allowlists in sync when adding assets. Update the initial educational HTML alongside the corresponding JavaScript-rendered copy when changing page content.

## Run locally

On this Windows computer, double-click **Open Aman.cmd** to start the website and open it in your browser. The launcher reuses an already running Aman server. Directly opening index.html also displays the 3D scene, but accounts and AI need the server.

Install **Node.js 22.13 or newer** (Node 24 recommended), then run:

```sh
npm install
npm start
```

Open **http://127.0.0.1:3000**. The website needs this server for accounts and saved progress; opening the HTML directly or using a static-only server cannot provide authentication. Local SQLite uses Node's built-in database; PostgreSQL uses the `pg` runtime dependency. The 3D library is served from the local `vendor/three/` folder. `npm install` also installs development and browser-testing tools.

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

With no `DATABASE_URL`, account and progress data live in `.data/aman.sqlite`. Keep `.data/` private and persistent. With `DATABASE_URL`, all account, session, progress, owner, Tobi configuration, encrypted credential, and daily quota tables live in PostgreSQL. This mode survives replacement of the web server's entire local filesystem. Local accounts are not automatically copied into a new hosted database.

For local SQLite, preserve the entire data directory, including `.data/tobi-keyring.bin` and `.data/tobi-visitor-secret.bin`. PostgreSQL deployments instead require a stable private `APP_SECRET` in the hosting environment; it derives separate encryption and visitor-signing keys and must be backed up alongside database backups. `TOBI_OWNER_CODE` allows the first owner to claim the studio once. The live Vercel deployment stores credentials as Production secrets; these cannot be revealed after saving. A private recovery copy is kept on the setup computer in `.env.vercel.production.local`, excluded from Git and public builds. Preserve it securely and keep the same values on redeployment. Chat text is not saved by the app. Public AI uses a signed essential visitor cookie and HMAC network counters.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listening port |
| `HOST` | `127.0.0.1` | Listening interface; use `0.0.0.0` in a hosted container if needed |
| `DATA_DIR` | `.data` in this project | Local SQLite database and private files; not account storage in PostgreSQL mode |
| `DATABASE_URL` | unset | Private PostgreSQL connection string; Neon Free supports the free hosting setup |
| `APP_SECRET` | unset | Required with PostgreSQL; stable private value of at least 32 characters |
| `TOBI_OWNER_CODE` | unset | Required with PostgreSQL; private one-time studio setup code, 32–100 characters |
| `NODE_ENV` | unset | Set to `production` behind HTTPS to enable Secure cookies |
| `APP_ORIGIN` | `RENDER_EXTERNAL_URL`, then `https://VERCEL_PROJECT_PRODUCTION_URL`, then the Host header | Exact public origin, such as `https://aman.example`, when behind a proxy |
| `TRUST_PROXY_HOPS` | `0` | Number of actual trusted proxy hops, from 0 to 10; leave 0 unless the deployment topology is verified |

For public deployment, follow the Arabic [deployment guide](DEPLOYMENT.md). Use HTTPS and `NODE_ENV=production`. Vercel and Render require external PostgreSQL and durable secrets. PostgreSQL startup does not write to the application's filesystem. On other hosts, the Dockerfile runs Node 24 as a nonroot user and installs runtime dependencies; it requires prebuilt browser bundles. Local SQLite needs persistent `/data` and one server instance. `GET /api/health` reports server readiness.

Daily AI quotas and active request leases are reserved transactionally in the database. PostgreSQL instances also share login, owner-claim, chat, and connection-test rate limits using `APP_SECRET` to hash their identifiers. This keeps limits effective across Vercel cold starts and concurrent instances. Expiring leases recover interrupted AI requests; only three provider requests can run at once. Local SQLite's short rate windows reset with the process. Vercel's adapter trusts the single client IP header that Vercel overwrites. For other hosts, configure `TRUST_PROXY_HOPS` only for the actual trusted topology and block direct access to the backend.

To create a clean deployment ZIP after rebuilding, run `node tools/package-website.mjs --check` and then `node tools/package-website.mjs`. The archive contains an explicit runtime allowlist and matching runtime package/lock files. It excludes `.env`, `.data`, installed dependencies, tests, and original game projects. Run `npm ci --omit=dev` in the extracted folder for PostgreSQL hosting; local SQLite can run without it. The archive does not contain your accounts or secrets; set them up privately on the host. Packaging does not publish the site.

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

The UI test uses installed Chrome on Windows. Set `CHROME_PATH` for a different executable, or run `npx playwright install chromium` to use Playwright's browser. Account and UI tests create temporary databases and remove only their own data afterward. PostgreSQL and serverless tests run the production adapter against PGlite's PostgreSQL engine, including concurrent signup/owner claims, encrypted credentials, quota transactions, shared login limits, cross-instance AI concurrency, and startup without a writable application directory; they do not require cloud credentials. UI screenshots are written to `test-results/`. Run `npm start` before `npm run test:a11y`; the read-only accessibility check audits public pages in both languages on port 3000. API connection tests use simulated provider replies, never real API keys.

After editing `aman-scene.js`, `tobi.js`, or `tobi-content.js`, run `npm run build:browser` to regenerate the classic browser bundles used by both direct-file and HTTP opening. Stylesheets do not need rebuilding.
