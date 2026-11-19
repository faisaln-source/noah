# Noah

Local video clipping and editing for gaming recordings and live streams. Import footage, review suggested highlights, edit a timeline, generate animated speech captions, and export finished videos without a paid AI API.

Built with React, TypeScript, Vite, Express, SQLite, Python, Faster-Whisper, and FFmpeg. Current version: **1.11.7**.

## Features

- Upload recordings with resumable transfers, import local files/folders, or capture supported video and live-stream URLs.
- Review audiovisual highlight suggestions and choose exact clip ranges before exporting.
- Edit multiple scenes with trimming, titles, transitions, color adjustments, speed changes, and background audio.
- Generate local speech transcripts with word timings, editable SRT/VTT, and animated caption themes.
- Reframe for portrait, landscape, square, and custom canvases; inspect an exact rendered preview.
- Export edited MP4s or copy source streams without re-encoding when compatible. Original-copy cuts follow source keyframes and omit rendered effects.
- Save projects, manage exports, restore deleted library files, and inspect file sizes and metadata.
- Optionally use local Ollama review, paid Claude review with consent, local voice reduction, and reviewed YouTube publishing through your own OAuth client.

## Quick start (Windows)

### Requirements

- Windows with PowerShell and **Node.js 22.17 or newer** (includes npm).
- Internet access for initial dependencies, tools, and model downloads.
- Free disk space for source footage, model caches, previews, and exports. Lossless exports can be large.

Clone this repository and open a terminal in its folder. Run:

```powershell
npm.cmd ci
powershell -ExecutionPolicy Bypass -File setup-tools.ps1
powershell -ExecutionPolicy Bypass -File setup-ai.ps1
npm.cmd run build
npm.cmd start
```

Open **http://127.0.0.1:3000**. Stop the terminal server with **Ctrl+C**.

The setup scripts download FFmpeg, FFprobe, yt-dlp, a project-local Python 3.12 runtime, locked Python dependencies, and the Whisper base model. These downloads are excluded from Git.

After setup, double-click **Start Noah.cmd** to build, start, and open the app. **Noah Desktop.cmd** opens an app-style Edge window when Edge is installed. Launcher logs are saved to `data/server.log` and `data/server-error.log`.

### First video

1. Open **Import Video**, select footage you own or have permission to reuse, and confirm the rights prompt.
2. Use **Auto Editor** or **AI Highlights** to review candidate ranges, or open **Video Editor** to choose your own.
3. Adjust scenes, canvas, audio, and captions. Use **Render exact preview** to check the final effects and soundtrack.
4. Choose **Export video**, then download or save the completed file. Projects can be saved in **My Projects**.

See the [user guide](docs/USER_GUIDE.md) for live history, captions, export quality, voice reduction, recovery, and file management.

## Development

Install the dependencies and local tools above. Run the API and frontend in separate terminals:

```powershell
# Terminal 1: API on port 3000
npm.cmd start

# Terminal 2: Vite development frontend (use the URL printed by Vite)
npm.cmd run dev
```

Vite proxies `/api`, `/media`, and `/thumb` to the local API. Production uses the compiled `dist/` frontend served by Express.

| Command | Purpose |
| --- | --- |
| `npm.cmd run check` | TypeScript checks |
| `npm.cmd run build` | Build the production frontend |
| `npm.cmd test` | Node unit and integration tests, including real media processing |
| `npm.cmd run test:e2e` | Build and run Playwright browser tests |
| `npm.cmd run test:online` | Check public-source capture; requires network access |

Before browser tests, run `npx.cmd playwright install chromium`. Set `$env:E2E_ONLINE = '1'` to include online browser scenarios. Integration tests require the local video tools and AI setup; their first run downloads a public speech fixture. They generate media and can take several minutes. See [TEST_REPORT.md](TEST_REPORT.md) for earlier verification and coverage limits.

## Configuration and data

[.env.example](.env.example) lists environment settings. **The server does not automatically load `.env` files**; set variables in the launching shell or container:

```powershell
$env:PORT = '3000'
$env:HOST = '127.0.0.1'
$env:DATA_DIR = 'D:\NoahData'
npm.cmd start
```

| Variable | Purpose |
| --- | --- |
| `PORT`, `HOST` | Server address; defaults to `3000` and `127.0.0.1` |
| `DATA_DIR` | Library, projects, SQLite database, and generated files; defaults to `data/` |
| `PYTHON_PATH` | Override the local Python executable |
| `MODEL_CACHE` | Override the Whisper model cache |
| `CLIPFORGE_OLLAMA_URL` | Optional local Ollama endpoint |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Optional paid cloud review; also requires consent in Settings |
| `ANTHROPIC_VERSION` | Optional provider API version override |

Back up the entire data directory with the server stopped. Git excludes user media, SQLite databases, model downloads, credentials, dependency directories, and generated verification artifacts.

This is a local, single-user application without public-hosting authentication. Keep it bound to loopback. Cached speech recognition and editing run locally; importing online sources, downloading models, optional cloud review, and YouTube publishing require network access.

### Optional integrations

- **Ollama:** install and run a model separately, then select it in Settings. Sampled images require a vision-capable model.
- **Claude:** configure the environment variables above and explicitly enable cloud consent in Settings. Analysis can send transcript context, feedback, and enabled sampled frames to the provider.
- **Voice reduction:** install the optional model from the Audio panel. Separation is approximate and can affect other voices and game sounds; listen to a preview.
- **YouTube:** supply your own Google OAuth Desktop app client JSON with YouTube Data API v3 enabled. Connect in Settings, review an export and its metadata, and authorize the upload. An API key alone is insufficient. Windows DPAPI protects cached tokens. Real account publishing remains unverified; mocked OAuth/upload tests are included.

## Docker

```sh
docker compose up --build
```

Open **http://127.0.0.1:3000**. The `clipforge-data` volume persists media and models. Initial builds and uncached models require internet access. The supplied Linux configuration has not been runtime-verified in this Windows workspace; GPU passthrough is not configured. Windows Explorer, launchers, and DPAPI integrations are Windows-specific.

## CLI

Start the local server first:

```powershell
node cli.mjs import 'D:\Recordings' --rights
node cli.mjs clip 'https://example.com/video.mp4' --rights --start 30 --duration 60
```

The CLI queues work for review in the app at port 3000.

## Project structure

```text
src/                    React editor and application UI
backend/                Express API, SQLite storage, jobs, capture, rendering
shared/                 Shared range/history utilities
ai/                     Local analysis, transcription, and voice processing
public/fonts/           Bundled caption font and license
scripts/                Fixtures and verification utilities
tests/                  Node unit and integration tests
e2e/                    Playwright browser tests
docs/                   Detailed user guide
tools/                  Downloaded tools and Python (not committed)
data/                   Local library, database, models, exports (not committed)
```

## Troubleshooting

- **Video tools not found:** rerun `setup-tools.ps1`. The app uses local `tools/` binaries or falls back to tools on `PATH`.
- **Transcription fails:** rerun `setup-ai.ps1`, check internet access for uncached models, and try the base model on CPU.
- **The browser cannot connect:** check the server terminal or launcher logs, confirm the configured port, and run the build before production startup.
- **A link stops working:** source permissions, DVR availability, expired URLs, and yt-dlp extractor changes can affect capture. Update yt-dlp or import an authorized local recording.
- **Exports are large:** lossless output prioritizes quality. Select High or Standard encoding for smaller files.
- **Old exports have silent playback:** use **Fix playback audio** to create a compatible copy.

## Scope and licensing

Highlight ranking measures audiovisual activity; it does not guarantee recognition of specific game events. Review generated clips, transcripts, framing, and audio before use. Source permissions, platform restrictions, and available DVR history determine what can be imported.

Use media you own or have permission to reuse. Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), the [Snap-Ninja license](ai/snap_ninja/LICENSE), the [YuNet notice](ai/snap_ninja/models/LICENSE.YuNet), and the [Anton font license](public/fonts/Anton-OFL.txt). No project-wide license has been selected for the original Noah source.

Additional documentation: [user guide](docs/USER_GUIDE.md), [feature comparison](FEATURE_COMPARISON.md), and [test report](TEST_REPORT.md).

### Compatibility after renaming

Noah keeps the existing `clipforge.sqlite` database, browser storage keys, `clipforge-data` Docker volume, and `CLIPFORGE_*` environment names so existing libraries, drafts, and configuration continue to work. These internal names are retained for compatibility.
