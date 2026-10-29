# Tobi on your website

## Open the website

Double-click **Open Aman.cmd** in the website folder. It starts the Node.js server quietly if needed and opens http://127.0.0.1:3000. Node.js 22.13 or newer is required; Node 24 is recommended.

- Game: http://127.0.0.1:3000/tobi.html
- AI setup: http://127.0.0.1:3000/tobi-studio.html#ai

Tobi keeps the original bear character and glasses, with the website’s calm cream-and-purple palette. Chat, Safety Quest, Word Lab, and Movie Riddles work without a paid AI service. Notebook replies are authored answers, not generated AI.

Opening index.html directly now also renders the actual 3D scene. Opening tobi.html directly supports free notebook chat and games. Accounts, saved progress, Studio, and AI require the running website; the local-file banner points you to the launcher.

## Make yourself the owner

1. Sign in to your website account or create an account.
2. Open Tobi Studio.
3. For first-time setup, copy the code from the private `.data/tobi-owner-code.txt` file on the computer running the website into the setup form.
4. Your account now owns the Studio. The one-time code expires; only that owner account can edit Tobi or manage AI.

Existing owners keep access. You can edit greetings, animation, enabled activities, notebook answers, and quiz questions in Arabic and English. Save changes, then reopen the game.

## Connect your API key from the website

1. Create a fresh project key on the [OpenAI API keys page](https://platform.openai.com/api-keys). Use a new key if an earlier one was shared in chat.
2. Open **Tobi Studio → AI connection / ربط AI**.
3. Paste it into **OpenAI API key**. Keep the suggested model, or enter another Responses-compatible model available to your account.
4. Click **Save connection / احفظ الربط**. The field clears after saving; the key is not returned to the browser. Saving does not make an AI request or turn AI on.
5. Click **Test connection / اختبر الاتصال** to send one small test request. The result distinguishes invalid keys, unavailable models, exhausted credits, request limits, and timeouts.
6. Choose **All visitors / كل الزوار** or **Members only / المسجلين فقط**, set the daily request limits, and save the access settings.
7. Click **Enable AI for Tobi / فعّل AI لتوبي**, then open Tobi and choose Talk to Tobi.

No server restart is needed for Studio changes. A blank key field keeps the currently saved key when changing the model. **Disconnect AI** removes the Studio credential and turns AI off; it will not silently reactivate an older environment key.

The default is [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), an economical model supporting `reasoning.effort: none`. Other custom models are sent without that model-specific parameter. Access depends on the OpenAI account.

**OpenAI API requests may consume paid API credit.** Saving is local; connection testing and AI conversations make requests. Configure the provider account’s spending controls as well. Development checks use mock responses and never call OpenAI with a real key.

## Choose how Tobi replies

- **Auto / تلقائي:** use free notebook answers first, and AI for unfamiliar questions when enabled.
- **AI chat / محادثة AI:** use AI for every question, with the recent conversation as context. Requires an enabled connection. Public access lets guests use the owner's server-side key; members-only access requires sign-in.
- Without AI, the notebook and games remain available. Responses identify whether they came from the notebook or AI.

The AI button stays clickable when the connection is unavailable: it refreshes the current state and explains whether AI is off, needs setup or sign-in, or requires opening the server version of the website. This also picks up AI enabled in another tab.

Messages are limited to 500 characters. At most six recent messages are sent for context, and AI output is capped at 1,024 tokens. A connection test uses a small fixed message and at most 64 output tokens.

## Let visitors share your AI connection

Choose **All visitors / كل الزوار** in the AI access settings. Visitors do not need an account or their own API key; requests use your server-side key and your API credit. Choose **Members only / المسجلين فقط** to require sign-in instead. The key is never included in the public configuration or chat responses.

The owner can adjust the daily site limit (default 50), visitor/account limit (default 10), and network-address limit (default 100). The first limit reached wins; the site-wide default therefore caps total daily requests at 50. Network limits reduce bypasses from cookie clearing or extra accounts; people at the same school or home may share a network address. There are at most three AI requests in progress across the server.

Limits reset by UTC day and survive restarts. Tests and failed provider attempts count too. These are request limits, not a currency spending cap. Configure the provider's usage and billing controls as well; budget alerts alone may not stop spending. AI can be switched off from Studio at any time.

Home, Stop, and disabling AI cancel pending requests. There are no automatic paid retries. Chat drafts survive switching between activities during the same visit. A new conversation clears the current messages.

## Private data and deployment

Studio credentials are encrypted with AES-256-GCM in the private `.data/aman.sqlite` database. The encryption key is in `.data/tobi-keyring.bin`, and the visitor-signing secret is in `.data/tobi-visitor-secret.bin`. **Back up the entire private data directory together.** These files, and the server implementation, are excluded from public serving. Owner-only APIs return connection status, never saved key text.

Existing `OPENAI_API_KEY` and `OPENAI_MODEL` environment configuration remains supported until replaced or disconnected in the Studio. Environment changes require a server restart. Keep `.env` private.

Settings, owner identity, scores, request counters, and connection-test status are stored on the server. Public AI uses an essential signed HttpOnly visitor cookie and HMAC network counters; raw IP addresses are not stored in Tobi's usage tables. Conversation text stays in the current browser page and is not stored in the app database. When AI is used, recent conversation text is sent to OpenAI. Requests use `store: false`; this does not replace OpenAI’s own data-handling policies.

For public hosting, follow the Arabic [deployment guide](DEPLOYMENT.md) for HTTPS, persistent data, one server instance, and trusted-proxy configuration. It includes Docker and clean ZIP packaging. A fresh deployment starts without local accounts or credentials; claim the owner account using the code from that server's private data directory, then connect your key.

The integration follows [official OpenAI text-generation documentation](https://developers.openai.com/api/docs/guides/text) and [API key storage guidance](https://developers.openai.com/api/docs/guides/production-best-practices).

## Editing and checks

Edit `tobi.js`, `tobi-content.js`, `tobi-refresh.css`, or `aman-scene.js`. After JavaScript changes, rebuild the classic browser bundles:

```sh
npm run build:browser
npm test
npm run test:tobi
npm run test:tobi-ai
npm run test:tobi-public
npm run test:local
```

Use `npm.cmd` in Windows PowerShell if its script policy blocks `npm`. These checks run in the full development project. The checked-in bundles let normal visitors and the launcher work without development dependencies. The clean deployment ZIP contains runtime files, not development tools or tests.
