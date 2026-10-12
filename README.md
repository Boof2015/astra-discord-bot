# Astra and Prism Wiki Bots

A shared Discord retrieval backend that turns a natural-language question into the most relevant section of either the [Astra Wiki](https://github.com/Boof2015/astra/wiki) or the [Prism Wiki](https://github.com/Boof2015/prism/wiki). The production Compose setup runs two separately branded Discord applications from the same image.

It is a documentation retriever, not a support-answer generator. The bot quotes an excerpt already written in the Wiki and links directly to its page and heading. It does not use an LLM, request privileged access to unmentioned message content, or store a history of people's questions.

## What people can do

- Run `/wiki question:<their question>`.
- Mention either bot followed by a question, such as `@Astra Bot why is my sample rate weird?`.
- Right-click a Discord message, open **Apps**, and choose **Search Astra Wiki** or **Search Prism Wiki**.
- Open the best matching Wiki section or one of the other likely matches.

The bot reads only explicit interactions and messages that directly mention it. It uses the non-privileged `Guilds` and `GuildMessages` gateway intents. Discord provides content for messages that mention an app, so the bot does not require the privileged Message Content intent and cannot inspect ordinary unmentioned conversation.

## How retrieval works

Each Markdown page is divided into searchable sections at its headings. The index preserves GitHub Wiki page names and heading anchors, so every result can link to the exact section it quotes.

Retrieval stays local and uses two complementary paths:

1. A q8 `EmbeddingGemma 300M` model ranks Wiki sections by the meaning of the question. It is the primary ranking because it handles ordinary user wording substantially better than keyword fusion.
2. A weighted lexical index supplies deterministic exact-title, exact-heading, and documented-alias overrides. It also remains available as a fallback if the semantic model cannot start.

The ONNX model repository and revision are pinned in the source. EmbeddingGemma is provided under the [Gemma terms of use](https://ai.google.dev/gemma/terms).

The Wiki clone is polled on a timer. A changed commit is parsed and indexed before the live index is replaced, so a failed refresh does not discard the working index.

## Requirements

- Node.js 22 or newer
- Git
- A Discord application and bot token
- Docker with Compose for the recommended VPS deployment

The production image uses Debian rather than Alpine because the local ONNX runtime needs a glibc-based Linux environment. It builds natively on Oracle Ampere ARM64.

## Discord setup

1. Create one application for Astra and one for Prism in the [Discord Developer Portal](https://discord.com/developers/applications), then add a bot to each application.
2. Copy the application ID into `DISCORD_CLIENT_ID` and the bot token into `DISCORD_TOKEN`.
3. On the application's **Installation** page, enable the `bot` and `applications.commands` scopes.
4. Give the bot **View Channels**, **Send Messages**, **Embed Links**, and **Read Message History** in the channels where it will be used. Add **Send Messages in Threads** if it should answer mentions inside threads.
5. Install the application in the server.

Keep the Astra token only in `.env` and the Prism token only in `.env.prism`; both files are ignored by Git. If a token is ever committed or shared, reset it in the Developer Portal.

## Admin commands

The guild-only `/astra` and `/prism` commands are hidden from members who do not have Discord's **Manage Server** permission. Each bot checks that permission again when handling its command, and every admin response is ephemeral.

| Command | Purpose |
| --- | --- |
| `/<product> status` | Show whether public searches are active, the configured and active search mode, Wiki commit, section count, last refresh, and uptime |
| `/<product> refresh` | Pull that product's Wiki and rebuild the live index while reusing cached embeddings |
| `/<product> inspect question:` | Show the top retrieval results, confidence, scores, ranks, and winning retrieval path without posting publicly |
| `/<product> pause` | Stop that bot's `/wiki`, message-menu, and mentioned searches until manually resumed |
| `/<product> pause minutes: reason:` | Pause that bot with an optional explanation and automatic resume time |
| `/<product> resume` | Resume that bot's public searches immediately |

Use `astra` or `prism` for `<product>`. Maintenance mode does not disconnect the bot, unload the model, or stop background Wiki polling. The two services store state independently, so pausing one does not affect the other.

## Rotating statuses

Edit [`config/statuses.yml`](config/statuses.yml) to supply `solos.astra`, `solos.prism`, and `pairs`. Each pair has a unique `id` and an `astra` and `prism` line. Statuses appear as custom text, without a forced "Playing" or "Watching" prefix. Each line must be a single line of at most 128 characters. Empty solo lists leave that bot's activity unset.

By default, statuses rotate every 10 minutes and about 15% of time slots select a paired entry. Adjust `rotationMinutes` and `pairChance` in the catalog. A shared seed and clock choose the same pair in both processes, including after a restart. Solo lines avoid immediate repeats when there is more than one choice. Both bots must have solo lines before pairs can be configured.

Compose mounts the small `status-presence` volume into both containers at `/app/presence`. Each bot writes a heartbeat every 10 seconds while the rotation is running, including whether its Discord connection is ready. A pair is shown only when the partner's heartbeat is fresh and agrees on the catalog, time slot, and pair. Updates generally align within one heartbeat interval. After a crash, a heartbeat expires after 35 seconds and the other bot switches to a fallback on its next tick (within roughly 45 seconds of the last heartbeat). Graceful shutdown removes the heartbeat; a detected disconnection marks it offline. This does not require the privileged Presence Intent.

Optional `partnerMissing.astra` and `partnerMissing.prism` lists supply special fallback lines when the other bot disappears. They activate only after this process has seen its partner online, so starting a bot on its own uses normal solo statuses. Missing-partner lines rotate at the usual interval and avoid immediate repeats; empty lists fall back to solos. This works during solo slots too, independently of whether a pair was active.

Optional `partnerReturned.astra` and `partnerReturned.prism` lists contain paired reunions, grouped by **which bot returned**. Each entry has a unique `id` and both `astra` and `prism` lines, just like a normal pair. The bot that observed the disappearance chooses a row when its partner returns and shares the selection and expiry through its heartbeat. Both bots display their matching lines for `reunionMinutes` (default 2, configurable from 1 to 60), with updates generally aligning within one heartbeat interval, then resume normal rotation. Reunions take priority over normal pairs regardless of `pairChance`.

A returning process can join the reunion after a full restart because the surviving bot remembers the absence. Starting both bots for the first time does not trigger a reunion. Events are bound to the current process sessions and expire without being extended by heartbeats; a further disappearance cancels them. Repeated returns avoid repeating the last row for that returning bot when multiple rows are available. Empty return lists resume normal rotation immediately, and reunions work even without missing-partner lines. Both bots need solo lines and matching catalogs for reunion pairs too.

Both bots need the same catalog and shared directory. Different catalogs during a rolling deployment or a shared-volume error cause normal solo fallback rather than disappearance lines. Heartbeats contain coordination metadata only; credentials, Wiki clones, and search caches remain in their existing separate locations. Run one instance of each product against a shared directory. For local runs, set `STATUS_SHARED_DIRECTORY` to the same absolute directory in both processes. For separate hosts, this local-volume arrangement would need a shared coordination service.

Catalog changes are loaded at startup, so rebuild and recreate both bot services after editing the bundled file. This updates statuses across every Discord server each bot belongs to. Existing Astra deployments using the old `bot` service should be migrated before launching the renamed `astra` service, to avoid two instances using the Astra token.

## Local setup

```sh
npm ci
cp .env.example .env
```

For development with an existing local Wiki checkout, set these values in `.env`:

```dotenv
WIKI_DIRECTORY=../astra.wiki
WIKI_SYNC_ENABLED=false
```

Register the commands after setting the Discord credentials:

```sh
npm run commands:register
```

Set `DISCORD_GUILD_ID` while developing to register commands in one server, where updates normally appear immediately. Leave it empty for global commands in production.

Start the bot:

```sh
npm run dev
```

For a compiled production-style run:

```sh
npm run build
npm start
```

## Test retrieval without Discord

Lexical search starts quickly and is useful while editing aliases:

```sh
npm run search -- "why does my network speaker keep disappearing"
```

Add `--semantic` to exercise the complete hybrid engine:

```sh
npm run search -- "the words are ahead of the singer" --semantic
```

On its first semantic run, the bot downloads approximately 330 MB: 309 MB of q8 ONNX weights plus the tokenizer and model metadata. It keeps those files at the pinned revision under `data/model-cache`. Embeddings are cached in `data/embeddings.json`; only changed Wiki sections need to be embedded after a refresh. The model cache lives in the Docker data volume, so container rebuilds do not download it again.

Allow roughly 2 GB of RAM per bot with semantic search enabled. A measured 305-section Astra index used about 1.7 GiB RSS; budget at least 5-6 GiB for both bots plus the VPS operating system and Docker. Each service keeps its own model cache, using approximately 660 MB total before Wiki embeddings. The model makes no network requests after its files have been downloaded, aside from normal Discord and Wiki traffic.

Run all local checks with:

```sh
npm run check
npm test
npm run evaluate
npm run evaluate -- --semantic
```

The grouped evaluation corpora in [`test/queries`](test/queries) and [`test/queries-prism`](test/queries-prism) contain natural query variants and their expected Wiki sections. Add product vocabulary to [`config/aliases.yml`](config/aliases.yml) for Astra or [`config/prism-aliases.yml`](config/prism-aliases.yml) for Prism instead of hard-coding it in the Discord layer. Pass `--verbose` to print every result or `--summary-only` to print per-topic and overall scores.

Prism retrieval can be tested before creating a Discord application. Clone its Wiki into `data/prism-wiki`, then use these environment variables (PowerShell example):

```powershell
git clone --depth=1 https://github.com/Boof2015/prism.wiki.git data/prism-wiki
$env:BOT_PRODUCT_NAME = 'Prism'
$env:WIKI_DIRECTORY = 'data/prism-wiki'
$env:WIKI_BASE_URL = 'https://github.com/Boof2015/prism/wiki'
$env:ALIASES_FILE = 'config/prism-aliases.yml'
$env:EVALUATION_PATH = 'test/queries-prism'
$env:EMBEDDING_CACHE_FILE = 'data/prism-embeddings.json'
npm.cmd run evaluate -- --semantic --summary-only
npm.cmd run search -- "how do I send a DAW track to the desktop rack" --semantic
```

Omit `--semantic` to check the keyword fallback. A semantic evaluation fails if the model cannot initialize, so fallback results cannot be mistaken for a successful semantic benchmark. The first semantic run downloads the model; subsequent runs use the pinned local cache. The Prism suite covers capture, Bridge, analyzers, reference tracks, desktop workflows, the TUI, and unrelated requests. `90-validation.yml` contains fresh paraphrases added after vocabulary tuning. Scores on different products' query sets are useful comparisons, not proof of identical performance on real Discord questions.

## Deploy on an Oracle Ampere VPS

Install Docker Engine and the Compose plugin on the VPS, clone this repository, and create both environment files:

```sh
git clone https://github.com/Boof2015/astra-discord-bot.git
cd astra-discord-bot
cp .env.example .env
cp .env.prism.example .env.prism
```

Fill in each file with the token and application ID for its corresponding Discord application. The templates already point to the correct public Wiki and select the appropriate branding.

Build the ARM64 image and register the commands once:

```sh
docker compose build
docker compose run --rm astra node dist/src/discord/registerCommands.js
docker compose run --rm prism node dist/src/discord/registerCommands.js
```

Then start the service:

```sh
docker compose up -d
docker compose logs -f astra prism
```

No inbound port or reverse proxy is needed; Discord interactions arrive over each bot's outbound gateway connection. The `astra-data` and `prism-data` volumes independently keep each Wiki clone, model, embedding cache, and maintenance state across container replacements.

Operate one bot without disrupting the other by naming its service, for example:

```sh
docker compose logs -f prism
docker compose restart prism
docker compose run --rm prism node dist/src/discord/registerCommands.js
```

To deploy a new revision:

```sh
git pull --ff-only
docker compose up -d --build
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | required | Discord bot token |
| `DISCORD_CLIENT_ID` | required | Discord application ID |
| `DISCORD_GUILD_ID` | empty | Register commands in one development server instead of globally |
| `BOT_PRODUCT_NAME` | `Astra` | Product name used in Discord commands, messages, logs, and search normalization |
| `BOT_ADMIN_COMMAND_NAME` | `astra` | Guild admin slash command; 1-32 lowercase letters, numbers, hyphens, or underscores |
| `BOT_ACCENT_COLOR` | `#8B5CF6` | Result embed color in `#RRGGBB` format; quote it in environment files |
| `WIKI_REMOTE_URL` | Astra Wiki Git URL | Wiki repository cloned and polled by the bot |
| `WIKI_BASE_URL` | Astra Wiki URL | Prefix used to build result links |
| `WIKI_DIRECTORY` | `./data/wiki` | Bot-owned Wiki checkout or local Markdown directory |
| `WIKI_SYNC_ENABLED` | `true` | Clone and fast-forward the Wiki automatically |
| `WIKI_POLL_MINUTES` | `5` | Wiki refresh interval; values below one minute are clamped |
| `ALIASES_FILE` | `./config/aliases.yml` | Product vocabulary and exact support phrases |
| `SEMANTIC_SEARCH_ENABLED` | `true` | Enable local semantic ranking with exact lexical overrides |
| `EMBEDDING_MODEL` | `google/embeddinggemma-300m` | Local embedding model; currently this pinned model is supported |
| `MODEL_CACHE_DIRECTORY` | `./data/model-cache` | Downloaded model files |
| `EMBEDDING_CACHE_FILE` | `./data/embeddings.json` | Per-section embedding cache |
| `BOT_STATE_FILE` | `./data/bot-state.json` | Persistent maintenance-mode state |
| `STATUS_MESSAGES_FILE` | `./config/statuses.yml` | Shared catalog of solo and paired custom statuses |
| `STATUS_SHARED_DIRECTORY` | `./data/status-presence` | Heartbeat directory shared by both bots; Compose sets `/app/presence` |

When sync is enabled, `WIKI_DIRECTORY` must either not exist or already be the bot's Git clone. The bot will not overwrite a normal directory. Updates use `git pull --ff-only`; a rewritten or conflicting checkout fails safely and leaves the previous search index online.

## Project layout

```text
config/aliases.yml       Astra vocabulary and common phrasing
config/prism-aliases.yml Prism vocabulary and common phrasing
src/app/                 Refreshable Wiki service
src/discord/             Commands and Discord response rendering
src/search/              Lexical, semantic, and fused ranking
src/wiki/                Markdown parsing, links, aliases, and Git sync
test/                    Unit and Astra/Prism retrieval regression tests
```
