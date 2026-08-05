# Astra Wiki Bot

A Discord bot that turns a natural-language question into the most relevant section of the [Astra Wiki](https://github.com/Boof2015/astra/wiki).

It is a documentation retriever, not a support-answer generator. The bot quotes an excerpt already written in the Wiki and links directly to its page and heading. It does not use an LLM, request privileged access to unmentioned message content, or store a history of people's questions.

## What people can do

- Run `/wiki question:<their question>`.
- Mention the bot followed by a question, such as `@Astra Bot why is my sample rate weird?`.
- Right-click a Discord message, open **Apps**, and choose **Search Astra Wiki**.
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

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications), then add a bot.
2. Copy the application ID into `DISCORD_CLIENT_ID` and the bot token into `DISCORD_TOKEN`.
3. On the application's **Installation** page, enable the `bot` and `applications.commands` scopes.
4. Give the bot **View Channels**, **Send Messages**, **Embed Links**, and **Read Message History** in the channels where it will be used. Add **Send Messages in Threads** if it should answer mentions inside threads.
5. Install the application in the server.

Keep the token only in `.env`; that file is ignored by Git. If a token is ever committed or shared, reset it in the Developer Portal.

## Admin commands

The guild-only `/astra` command is hidden from members who do not have Discord's **Manage Server** permission. The bot checks that permission again when handling the command, and every admin response is ephemeral.

| Command | Purpose |
| --- | --- |
| `/astra status` | Show whether public searches are active, the configured and active search mode, Wiki commit, section count, last refresh, and uptime |
| `/astra refresh` | Pull the Wiki and rebuild the live index while reusing cached embeddings |
| `/astra inspect question:` | Show the top retrieval results, confidence, scores, ranks, and winning retrieval path without posting publicly |
| `/astra pause` | Stop `/wiki`, message-menu, and mentioned searches until manually resumed |
| `/astra pause minutes: reason:` | Pause public searches with an optional explanation and automatic resume time |
| `/astra resume` | Resume public searches immediately |

Maintenance mode does not disconnect the bot, unload the model, or stop background Wiki polling. Admin commands remain available, searches already in progress may finish, and new public requests receive a short maintenance response without running retrieval. Pause details are stored in `data/bot-state.json`, so manual and timed pauses survive container restarts.

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

Allow roughly 2 GB of RAM for the bot with semantic search enabled. A measured 305-section Astra index used about 1.7 GiB RSS; the exact number varies by platform and ONNX Runtime version. The model makes no network requests after its files have been downloaded, aside from the bot's normal Discord and Wiki traffic.

Run all local checks with:

```sh
npm run check
npm test
npm run evaluate
npm run evaluate -- --semantic
```

The grouped evaluation corpus in [`test/queries`](test/queries) contains natural query variants and their expected Wiki sections. Add a variant whenever a real question exposes an ambiguous ranking, or add a new intent when an area of the Wiki has no coverage. Add user vocabulary or product-specific synonyms to [`config/aliases.yml`](config/aliases.yml) instead of hard-coding query behavior in the Discord layer. Pass `--verbose` to print every result or `--summary-only` to print per-topic and overall scores.

## Deploy on an Oracle Ampere VPS

Install Docker Engine and the Compose plugin on the VPS, clone this repository, and create the environment file:

```sh
git clone https://github.com/Boof2015/astra-discord-bot.git
cd astra-discord-bot
cp .env.example .env
```

Fill in `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`. The defaults already point to the public Astra Wiki and are suitable for production.

Build the ARM64 image and register the commands once:

```sh
docker compose build
docker compose run --rm bot node dist/src/discord/registerCommands.js
```

Then start the service:

```sh
docker compose up -d
docker compose logs -f bot
```

No inbound port or reverse proxy is needed; Discord interactions arrive over the bot's outbound gateway connection. The named `bot-data` volume keeps the Wiki clone, model, and embedding cache across container replacements.

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

When sync is enabled, `WIKI_DIRECTORY` must either not exist or already be the bot's Git clone. The bot will not overwrite a normal directory. Updates use `git pull --ff-only`; a rewritten or conflicting checkout fails safely and leaves the previous search index online.

## Project layout

```text
config/aliases.yml       Product vocabulary and common phrasing
src/app/                 Refreshable Wiki service
src/discord/             Commands and Discord response rendering
src/search/              Lexical, semantic, and fused ranking
src/wiki/                Markdown parsing, links, aliases, and Git sync
test/                    Unit and retrieval regression tests
```
