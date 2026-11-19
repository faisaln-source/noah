# ClipForge AI

A local gaming video clipping and editing application. React + TypeScript + Vite frontend, Express backend, Python AI workers, FFmpeg rendering, and Faster-Whisper speech recognition. No paid AI API is required.

## Open the software

Double-click **Start ClipForge.cmd** in this folder. It builds the frontend when starting the server and opens http://127.0.0.1:3000. Logs are in `data/server.log` and `data/server-error.log`.

For terminal use, run `npm.cmd run build` followed by `npm.cmd start`. Node.js 22.17 or newer is required. A fresh clone requires the tools and AI setup described below.

## New in 1.9: Snap-Ninja comparison

The implementation comparison is in [FEATURE_COMPARISON.md](../FEATURE_COMPARISON.md).
Open **Canvas** in Video Editor for blurred fill or face/speaker/body framing;
use **Render exact preview** to inspect tracking before export. **Audio** contains
music ducking and generated lo-fi. **Captions** contains word grouping, casing
and progressive word reveal. Reviewed ranges offer nudges, ratings, transcript
boundaries and dual portrait/landscape exports.

**Import Video** now supports absolute local file/folder import and batch
captioning. **Settings** remembers an export folder and configures speech and
optional semantic models. Finished export copies retain the same bytes as the
library file. Leaving the preferred folder blank keeps the normal Save As flow.

For live automation, paste a live link, confirm media rights, enable rewind and
clipping, then expand **Automatic live highlights**. Choose chat reactions or
continuous overlapping parts. Keep the player open; its navigation/close action
stops the session. Chat-based timestamps depend on stream/chat delay and need
review. The source stream is copied separately from the viewing proxy.

For an app-style window, launch **ClipForge Desktop.cmd** (Microsoft Edge required;
otherwise it opens the browser). Unsaved editor drafts survive browser reload.
The original launcher continues to work. CLI usage: `node cli.mjs`.

### Optional models and publishing

Local semantic review requires a separately installed/running Ollama model.
Refresh installed models in Settings, select a text model, and enable review.
Only enable sampled images with a vision-capable model. No Ollama model is
silently downloaded. Speech models download when you request transcription;
large models need substantially more memory. CPU/base remains the default.

Paid Claude review is optional: set `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` in
the server environment before starting it, select Claude in Settings, and
explicitly authorize cloud processing there. `ANTHROPIC_VERSION` can override
the configured API version. Transcript context, feedback and enabled sampled
frames are then sent to that provider when analysis runs. No cloud service is
required for local editing, captions or exports.

YouTube publishing requires your own Google OAuth **Desktop app** client JSON,
YouTube Data API v3 enabled, and Google consent. See **Settings ? YouTube account**.
An API key alone is insufficient. Review the connected channel, finished video,
metadata, audience and privacy in **Exports ? Publish a reviewed export to YouTube**,
then explicitly authorize that upload. Windows DPAPI protects cached account tokens.
Connecting alone never uploads. Google project verification, consent and quota can
restrict publishing. Real account publishing has not been exercised in this workspace;
OAuth/upload contracts are covered with mocked Google responses.

## Install on another Windows computer

1. Install Node.js 22.17 or newer.
2. Run `npm.cmd ci` from this folder.
3. Run `powershell -ExecutionPolicy Bypass -File setup-tools.ps1` to download FFmpeg, FFprobe, and yt-dlp.
4. Run `powershell -ExecutionPolicy Bypass -File setup-ai.ps1` to install a project-local Python 3.12 runtime, locked AI dependencies, and the Whisper base model.
5. Double-click `Start ClipForge.cmd`.

Initial installation and uncached model downloads require internet access. Cached speech models, uploaded media, analysis, and exports can run locally. Fonts use system fallbacks when Google Fonts is unavailable. Update yt-dlp through its official release when platform extractors change.

## Manage local files

Recordings in Dashboard/Import Video and completed videos in Exports include **Show in folder**, **Save as?**, and **Delete video**.

**Show in folder** opens the app's library file in Windows Explorer. **Save as?** opens the browser's native file chooser when supported, so you can select a folder and filename. It streams a byte-for-byte copy and preserves the video quality and original file extension. Cancelling the chooser leaves the file unchanged. If a browser does not support the native chooser, the action falls back to a browser download; enable that browser's "Ask where to save each file" preference to choose the destination. Copies saved outside the app are independent of its library. The app cannot discover their full paths through the browser's save-picker API.

**Delete video** asks for confirmation and moves the app's library file, thumbnail, preview proxy, and subtitle sidecars to app trash. It does not delete the original file selected during upload or copies saved elsewhere. Open **Settings ? Deleted videos** to restore a video or permanently delete it. App trash still consumes disk space until permanent deletion, which requires an additional confirmation.

Videos referenced by saved projects or active processing jobs cannot be deleted. Remove those scenes from saved projects or use **Delete project** in My Projects; deleting a saved project keeps its videos and exports. Wait for or cancel active jobs before deleting their source. Deleting a video also removes references to it from the current unsaved timeline after confirmation. Independent completed exports remain available after their source is deleted.

## GTA VI-inspired animated speech subtitles

In the link/Auto Editor workflow choose **Subtitle theme ? GTA VI neon - word-by-word**, keep speech transcription enabled, then review/export your clips. In Video Editor open **Captions ? Generate GTA VI subtitles**. This transcribes the selected timeline footage, including game dialogue and commentary that is audible in the source, without adding a title or changing your video effects. Speech is recognized locally by Faster-Whisper, with individual word start/end times. Recognition quality depends on intelligible audio; overlapping voices, game sound effects, and music may require manual corrections.

The inspired theme uses the bundled open-licensed **Anton** font, uppercase lettering, pink/purple glow and peach highlights. It is an inspired subtitle design, not Rockstar's official font or an official game asset. Choose **Word-by-word pop**, **Highlight spoken word**, or **Static phrase**, and adjust font, color, highlight color, size, or position. Animation appears in the live editor preview, rendered preview, and burned-in MP4. Automatic editing preserves the selected theme and real word timings across titles, trims, and speed changes. Generated SRT remains editable. Word timing for imported/edited lines without aligned words uses evenly spaced estimates; regenerate from speech for actual word timing.

SRT/VTT downloads contain text and line timings; their formats do not retain neon styling or animations. Use edited MP4 export to retain animated captions. Original-quality stream-copy exports keep the original encoded streams and exclude burned-in subtitles.

Font: [Anton](https://github.com/google/fonts/tree/main/ofl/anton), licensed under the SIL Open Font License; the bundled license is `public/fonts/Anton-OFL.txt`. Visual reference: [Rockstar's official GTA VI artwork](https://www.rockstargames.com/VI/media/artwork-wallpapers).

## Download quality

Imports now request the best available video and audio without a 1080p cap. Live recordings copy the original encoded streams. The streamed player uses a smaller 30 FPS preview for responsive viewing and stores a separate copy of the native video and audio for clipping. Buffer snapshots preserve those original streams.

Select ranges in review and click **Download original-quality clips**. This copies video and audio into MP4 without re-encoding, retaining their native resolution, frame timing, and encoded content. The original canvas is retained; effects, resizing, music mixing, and burned-in subtitles are excluded. The start snaps to a preceding keyframe and the actual start appears with the result. Each selected range creates a separate file. The editor Export tab offers the same original-copy option for a single source range.

For precise cuts, 9:16/3:4 reframing, effects, or burned-in captions, use edited export. These operations require re-encoding. Edited export defaults to lossless H.264 (CRF 0), a compatible AAC default playback track, and a retained FLAC lossless audio master in the same MP4. This preserves the rendered frames/audio without an additional lossy encode; effects, color conversion, speed changes and reframing still intentionally change the result. Original-quality copying remains the option that keeps the source encoded streams unchanged. High/Standard H.264/AAC options remain available explicitly for smaller files and wider player compatibility. Choose the original/largest-source canvas and Match source FPS to retain source dimensions and the highest source frame rate. You can alternatively choose an explicit edited canvas up to 4K. Lossless files are substantially larger and can take longer to render; the lossless master audio track requires a player that supports FLAC, while the default AAC track provides normal playback. Increasing resolution cannot restore missing source detail. Higher-quality modes and native-resolution buffers use more disk space.

Existing compressed clips cannot regain lost detail. Import or record the source again to use the new capture path. Original-copy MP4 support depends on the source codec; incompatible streams produce an explicit error rather than silently switching to compressed output. Container file size may change even when copied video/audio content is unchanged.

See [FFmpeg stream copy and seeking](https://ffmpeg.org/ffmpeg.html) and [yt-dlp format selection](https://github.com/yt-dlp/yt-dlp#format-selection).

## Find and review moments

Pasting a link opens a player immediately. YouTube uses its embedded player; direct video files play natively. **Use streamed player** opens an FFmpeg-backed HLS player for compatible sources. Playback starts muted when the browser permits autoplay. Provider access and embedding restrictions still apply.

For a recorded video, use **Back 10 seconds**, **Back 5 seconds**, and **Forward 5 seconds** while watching. Click **Mark clip start** at the beginning of the moment and **Mark clip end** at its end. You can also enter timestamps directly. Click **Preview selected range**, then **Prepare selected clip**. For a live feed, choose your duration and click **Record next ?**. **Finish recording now** saves an early ending for review. Live capture begins when its recording connection opens. To clip a moment already watched, click **Enable rewind & clipping**. The streamed player buffers up to 30 minutes from when it opens. Rewind, mark start/end, preview, and prepare the range. The buffer remains available while that player stays open; earlier footage requires a published recording or provider DVR access. **Record from now instead** switches back to timed recording. Confirm media rights to enable clipping. Review each prepared range, edit effects and subtitles, then export MP4. Choose 9:16, 3:4, or 16:9 using the format controls.

1. Paste a supported video or live-stream URL on the Dashboard or Import Video page. The app detects the source title and live status.
2. Choose automatic audiovisual peak detection or manual timestamps. Published recordings default to analyzing the full video. For live sources, set the recording duration before starting.
3. Choose 9:16 short clips with a maximum length of 30, 60, 90, or 120 seconds, or 16:9 long form with a 20, 25, or 30 minute target.
4. Click **Detect moments for preview**, or **Open timestamp review** for manual mode. Processing stops at review. Automatic candidates require prominent activity changes above the surrounding footage. Their boundaries include event context and can be shorter than the selected maximum. A chosen clip count is no longer used to fill the results with ordinary footage.
5. Every candidate has its own source-range player, editable start/end timestamps, a title, measured evidence, a selection checkbox, and an Edit this range button. Type seconds or HH:MM:SS, or use the full source player's playhead to set manual in/out points. All detected and manually added ranges can be previewed. Players load on demand.
6. Select ranges and export them, or open any range in the editor first. Short ranges become separate MP4s. Long-form mode combines reviewed footage up to the chosen target and skips overlapping source ranges. Insufficient footage yields a shorter result, with the selected footage duration shown before export.
7. Preview every finished export before downloading its MP4. SRT and VTT downloads are also available in Exports.

9:16 exports are capped at two minutes in both the review API and timeline renderer. Use 16:9 for longer material. Preview cards display the original source range; the finished export player shows the rendered effects and canvas conversion. Manual timestamp edits and selection drafts are saved in browser storage for each review. Full-video timestamps start at zero. Captured sections show the original video's timestamp offset. Live recordings use elapsed time from the captured recording.

Auto Editor applies the same review workflow to imported files. AI Highlights exposes every detected range with the same manual range and preview controls. Compilations and Exports also have video players for each item.

Sources are imported locally so they can be analyzed and played. Edited output files are generated after selection. If the analysis finds no prominent peaks, the review stays empty and manual timestamp ranges are available. Specific semantic game events still require additional trained models and human review.

Long uploads use 8 MB resumable chunks. Pause, then select the same file to resume, including after a browser restart. Background processing, live capture, and interactive edits use separate durable queue lanes with progress updates. Interrupted and failed jobs have a Retry action. Live retries start a new recording from the current stream position.

## Edit videos

Open a recording or highlight in **Video Editor**. Add source clips, trim in/out points, split at the preview playhead, drag scenes to reorder, and add title cards. The video, caption, and audio lanes expose the timeline settings. Save projects and reopen them in **My Projects**. Undo and redo cover timeline changes. Source recordings remain intact.

Additional manual controls include brightness, contrast, saturation, sharpening, 90/180/270-degree rotation, horizontal mirroring, vignette and a fine-adjustment reset. Live color/transform feedback is immediate and approximate; rendered previews use the actual export filters. Available rendered controls include center or manual-position crop, fit/letterbox, optional motion-centroid crop suggestions, five editing presets, color correction, motion zoom, shake, fade in/out, constant slow/fast motion, synchronized silence cuts, crossfade transitions, title cards, text overlays, an optional text watermark, volume, audio normalization, and user-provided background audio.

Import music or sound effects in **Import Video** as MP3, WAV, M4A, OGG, or FLAC, then choose the file in the editor's Audio tab. The chosen audio loops as a background track. Independent sound-effect placement and multiple freely positioned audio tracks are not implemented.

Choose **Manual edit** to adjust the existing controls. The live canvas updates immediately for color, zoom/shake, fade, speed, framing, heading, watermark, and caption styling. Visual approximations remain responsive while paused. The native source volume follows the volume control up to the browser's volume limit; normalization, gain above 100%, background mixing, transitions, and silence cuts are checked in the rendered preview.

Choose **AI automatic edit**, then **Apply AI automatic edit** to apply the selected editing style, create a title card and heading, transcribe speech in the selected footage, add captions, and normalize audio. Local Faster-Whisper provides speech recognition; titles use the first recognized speech or the source title when speech is unavailable. This is automated local speech-and-preset editing, not semantic recognition of game kills or a generative storytelling model. Existing cached transcripts are reused; otherwise only the selected ranges are transcribed. Automatic title cards are off by default and can be enabled explicitly; they respect the two-minute short limit and never replace footage. AI options separately control color direction, gentle/punchy motion, playback pace, headings, captions, audio normalization, and silence removal. After applying AI edits the live player selects footage, while the rendered preview shows the complete timeline. Generated SRT is editable in Captions. All resulting edits can be changed manually and undone.

Rendered previews now default to the **Complete timeline**, without a 30-second or 360p limit. They retain the selected canvas, match source FPS unless an explicit rate is selected, and use lossless edited video/audio. **Selected scene** remains available when intentionally checking a single scene. **Download full-quality preview MP4** downloads exactly the rendered file being watched. Automatic refresh is optional; enable **Auto-refresh rendered preview** to refresh after a pause in editing. The live canvas continues to update immediately. Browser proxies are regenerated at full resolution with lossless encoding; older reduced proxies are ignored by the editor until regenerated.

The **Download your complete video** panel shows total duration, preparation progress, cancellation/retry, completed files and explicit download/Save as buttons. **Export video**, **Render timeline**, and the editor's original-quality button feed this same visible panel. Completed download jobs survive navigation/reload. Full edited downloads contain all scenes; source-quality downloads copy each footage range without effects or title cards. Exports use a separate queue lane so background transcription does not block downloads.

Caption generation uses actual Faster-Whisper output with VAD filtering and word timestamps. Correct transcript text and times in the Captions tab, or import source-relative SRT captions, then Save transcript. Styles include classic, pop-in, and karaoke highlighting. Font, size, color, and position are configurable. Exports retime captions for trims, speed changes, silence removal, and compilation offsets. Editing a caption clears its old word timing, so that caption falls back to whole-caption styling until retranscribed. Review recognition for accuracy.

The canvas supports 9:16, 16:9, 1:1, 4:5, and custom ratios. Resolution controls the shorter canvas edge. Export settings include 720p, 1080p, 1440p, and 2160p, 30/60 FPS, bitrate, CPU H.264, and optional NVIDIA NVENC. NVENC requires compatible hardware and drivers. Higher export resolutions can upscale lower-quality sources. If NVENC fails, select CPU and retry. Crossfades require scenes longer than 0.6 seconds, otherwise the renderer uses direct cuts.

## Compilations

Select highlights in AI Highlights or Compilations, choose a category and target duration, then create a compilation. It arranges clips by recording and timestamp, skips overlapping ranges, and trims to available footage up to the requested duration. It never adds fabricated footage to meet a target. The editor can add intro/outro title cards or rearrange the scenes of a saved timeline.

## What the analysis measures

All modes use the same deterministic audiovisual peak-ranking method. Fast samples video every 2 seconds, Balanced every second, and Detailed every half-second. FFmpeg decodes low-resolution grayscale frames sequentially. OpenCV measures frame differences and histogram changes. A separate streaming PCM pass measures audio energy. Available speech timestamps contribute commentary activity. Loudness scores are gated by motion or speech evidence.

Candidates must exceed a robust recording baseline and local prominence threshold. Uniform activity and loud audio alone do not create highlights. Event boundaries expand across the active burst with context, then respect the selected duration cap. Scores and confidence describe measured audiovisual activity. Categories are High activity, Scene change, or Conversation. This version does not identify specific kills, police chases, missions, bosses, laughter, HUD events, game identities, or semantic visual events. The crop suggestion uses a motion centroid averaged over a clip. It does not follow identified people or vehicles. Optional face/speaker/body framing and chat-triggered live highlights are available as described above. Trained game-specific event recognition remains outside the default activity detector. The full advanced roadmap in the supplied prompt is broader than this implementation.

## Architecture and stored data

- `src/` contains the React/TypeScript editor, Zustand undo/redo state, TanStack Query data fetching, and responsive dark styling using Tailwind's Vite integration plus component CSS.
- `backend/server.ts` is the Express API. `backend/uploads.mjs` handles resumable imports.
- `backend/jobs.mjs` runs the durable serial worker queue and server-sent progress events.
- `backend/media.mjs` handles metadata, thumbnails, URL capture, AI requests, and transcripts.
- `backend/render.mjs` renders actual FFmpeg effects, assembly, audio, captions, and exports.
- `backend/subtitles.mjs` maps source timestamps into output SRT, VTT, and animated ASS.
- `backend/store.mjs` owns the SQLite schema and migrates the original media library automatically.
- `ai/worker.py` performs OpenCV/NumPy analysis and Faster-Whisper transcription. It also exposes a FastAPI app for local service deployments.

The Windows single-user installation uses SQLite and a durable queue with separate processing, live-capture, and interactive-clipping lanes instead of requiring PostgreSQL, Redis, and BullMQ. Progress uses server-sent events. This keeps startup local and avoids external services. Database rows store structured media, projects, uploads, highlights, and job records. Speech models are cached on disk. There is no multi-user account system or distributed worker deployment.

`data/clipforge.sqlite` contains projects, job history, and media metadata. Original files, exports, thumbnails, proxies, and subtitles live in `data/`. Temporary render directories are deleted after success or failure. Incomplete URL imports and interrupted uploads remain for recovery. Media storage and available disk space appear on the Dashboard and Settings pages. Back up `data/` with the server stopped. Individual library files can be moved to app trash, restored, or permanently deleted through the file controls. No automatic retention policy is applied to user media.

Optional environment variables are documented in `.env.example`. Set them in your shell, or pass them through Docker. The app does not automatically read `.env` files. Default access is local loopback. Keep it local, because this version has no public hosting authentication.

## Docker

`docker compose up --build` builds a Linux image with FFmpeg and Python dependencies and exposes the app at http://127.0.0.1:3000. Media and models persist in the `clipforge-data` volume. The first transcription downloads its model. Docker configuration is provided and has not been executed in this Windows environment. GPU passthrough is not configured.

To run the standalone AI service with a system Python environment, install `ai/requirements.txt` and run `python -m uvicorn ai.worker:app --host 127.0.0.1 --port 8001`. Keep this service local. The default app uses cancellable Python subprocesses directly.

## Verification

Run `npm.cmd run check`, `npm.cmd run build`, and `npm.cmd test`. For browser tests, install Chromium using `npx.cmd playwright install chromium`, then run `npm.cmd run test:e2e`. Set `$env:E2E_ONLINE = '1'` in PowerShell before that command to include public YouTube video and live-stream tests. Open `playwright-report/index.html` for the report. See `TEST_REPORT.md` for the complete verified coverage.

The integration suite creates an isolated SQLite workspace and tests resumable upload, rights confirmation, real local speech transcription with word times, non-overlapping candidates, saved project data, 1080x1920 MP4 output, decoding, audio presence, download byte ranges, separate captions, title cards, slow motion, music mixing, crossfades, square and 4:5 canvases, silent footage, batch export, silence cuts, review-gated analysis, exact manual-range exports, two-minute portrait validation, a real 20-minute landscape render, compilations, and a 30-minute synthetic recording. The first test run downloads the public JFK speech sample from the whisper.cpp repository. This checks a synthetic audiovisual fixture and public speech, not a 30-minute GTA gameplay recording. The supplied GTA acceptance test still needs a real authorized gameplay source. Playwright browser verification passed for the implemented workflows. See TEST_REPORT.md for results, fixes, artifacts, and remaining coverage limits. Docker execution remains unverified.

## Source access and rights

Only import media you own or have permission to reuse. Supported platform imports depend on yt-dlp extractor compatibility, network access, and source permissions. Login-restricted and DRM-protected sources are unsupported by this UI. A local file upload is available for authorized recordings. Optional reviewed YouTube publishing is available through your own OAuth client as described above; unattended channel uploads are not enabled by connecting an account.

Relevant upstream projects include [yt-dlp](https://github.com/yt-dlp/yt-dlp), [FFmpeg](https://ffmpeg.org/ffmpeg-filters.html), [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper), and [OpenCV](https://opencv.org/). Respect their licenses when redistributing bundled binaries or models.

Online capture was also verified with the public W3Schools Big Buck Bunny sample and the public YouTube Big Buck Bunny video aqz-KE-bpKQ. Both produced a playable three-second import. The link-to-export pipeline has also passed a timed recording and edited MP4 test against NASA's public live YouTube stream. Run npm.cmd run test:online for the public sample check.


Shorts also support 3:4 at 1080 x 1440 through the link workflow, review cards, and editor canvas. Both short formats support 30, 60, 90, and 120 second duration caps. A real 3:4 H.264 MP4 export was verified.


## Audio compatibility fix in 1.9.1

Older edited MP4s used FLAC as their only audio track. Some players displayed the video but could not play that audio. New lossless edited exports and rendered previews now include AAC as the default playback track, plus the unchanged lossless FLAC master. The final compatibility step copies the video without re-encoding. For an existing edited file, use **Fix playback audio** beside its file actions, then **Download repaired MP4**. A new copy is created; the original remains intact.

## Full live history in 1.10.0

After pasting a live link, choose **View full live history**. The app checks the
provider's available DVR history; for Kick it finds the ongoing replay matching
that exact broadcast. The player shows the available history range, with **Go to
beginning**, **Seek in broadcast history**, normal seeking and clip start/end
markers. **Prepare selected clip** fetches only the selected original replay
segments, so you can edit footage from before you opened the app. **Go live**
returns to the current stream. **Refresh full history** renews the snapshot and
provider links while retaining the playhead where possible.

History is separate from the app's rolling local buffer. Availability depends on
the platform: if DVR is disabled or early segments/replays are unavailable, the
app shows the available window or an error rather than promising unavailable
footage. Native source quality is retained for captured history segments. Full
history was tested against the current Kick broadcast, including 30-minute seek,
return to the beginning and preparing a 2?6-second clip from before joining.

## Game audio / streamer voice in 1.11.0

In **Video Editor > Audio**, select **Source audio track** if the recording has a
separate game-only track. That removes a separately recorded microphone exactly,
without AI. Most platform streams mix the voice into the game audio instead.

For a mixed track, enable **Reduce streamer voice with local AI**, set the strength,
and click **Preview voice reduction (up to 10 seconds)** to listen before export.
Use **Render exact preview** for the whole edited timeline, then **Export video**
to apply the processing. The immediate canvas still plays original source sound;
source-quality copying also retains original audio. Existing captions are not
removed automatically when you remove voices from the soundtrack.

The optional 67 MB UVR model is downloaded separately. Use
**Install local voice model** in the Audio panel. Processing runs locally on CPU
with ONNX Runtime, with no paid API. Long clips take longer. Video is copied
unchanged during the audio-processing pass, and edited downloads retain compatible
AAC playback audio plus the lossless processed audio master.

AI separation is approximate: it can leave voice remnants and alter game sounds,
music or NPC dialogue. It cannot distinguish the streamer from all other voices
in a single mixed track. Review the listening sample; reduce strength or use a
separate game-only source track when available.

## Bulk deletion in 1.11.1

Use **Select all** above the media library in Import Video or above the Exports grid. You can also select individual cards or clear the selection. **Delete selected** asks for one confirmation and moves eligible app-owned files to trash. Protected files used by saved projects or active jobs are skipped and reported. Original files and external saved copies remain intact. Restore deleted files from Settings.

## Empty Trash in 1.11.2

In **Settings > Deleted videos**, choose **Delete all permanently** and confirm the displayed item count. This cannot be undone. Only items included when the confirmation opened are removed; newly trashed files are preserved. Original files and saved copies outside the app remain intact.

## Playback recovery in 1.11.3

The player now attempts media recovery and network loading recovery before rebuilding a failed connection, with bounded retries and backoff. Reconnecting renews provider metadata instead of reusing cached signed URLs. Video playback resumes near its previous time and retains clip marks. Full-history recovery retains its broadcast playhead; a restarted live local buffer clears its old markers and shows a notice so old buffer timestamps cannot silently point to new footage. Expired sessions, stopped capture processes and prolonged playback stalls trigger recovery. Persistent provider restrictions still show an error after the retry limit, with manual reload and history options.

## Export sizes in 1.11.4

Finished editor downloads, exact rendered previews, reviewed clip exports, repaired downloads and export cards show the actual file size in KB, MB or GB. Hover over the size for the exact byte count. Sizes become available when rendering completes.

## File information in 1.11.5

**Show info** beside a video opens its actual file size, dimensions, duration, codecs, quality, disk availability, library path and project/job references. Copy the path or use Show in folder from the dialog. Windows folder reveal now explicitly requests a visible Explorer window from the hidden server and passes the file path as data to its helper.

