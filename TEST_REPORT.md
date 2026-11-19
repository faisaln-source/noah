# Noah test report

## Noah 1.11.7 - history timestamp validation

Three focused unit tests and two clipping-control browser scenarios passed, together with TypeScript and build checks. Frontend and backend now share history-range validation, explain ordering, duration and snapshot boundaries using HH:MM:SS.mmm, and tolerate sub-millisecond rounding at the end boundary. Start markers constrain stale end markers to the selected duration and available history. Long-form default ranges respect the chosen 20/25/30-minute duration.

## Noah 1.11.6 - Show in folder missing-file handling

The two current library records referenced MP4 files absent from disk. Folder reveal now opens the containing directory and reports the missing file rather than failing with ENOENT. Existing-file and missing-file cases passed the isolated browser test. The native Windows check created a new data File Explorer window; computer-use inspection verified D:/works/vdeomaker/data, and activated the window. This does not restore the missing videos.

## Noah 1.11.5 - file information and folder reveal

TypeScript and build passed. The isolated browser test verified Show info, actual size and metadata, copying the exact path to the clipboard, folder-reveal endpoint path, Close and Escape. Native Explorer opening is bypassed by the test environment; its Windows launch was adjusted to explicitly request a visible window with a quoted path.

## Noah 1.11.4 - export size labels

TypeScript and production build passed. The targeted browser test passed actual file-size labels beside editor downloads, exact previews and export cards, checking the metadata size against the generated file on disk and the exact-byte tooltip. No browser runtime errors were recorded.

## Noah 1.11.3 - interrupted playback recovery

TypeScript and production build passed. Two browser scenarios passed on the final build: real Kick full-history seeking, earlier clipping and return to live; and injected initial connection failures plus an expired playback session, followed by automatic reconnect, actual playback and preserved VOD clip marks. No browser runtime errors were recorded. The exact original screenshot error did not include a diagnostic code, so its specific triggering cause is not established. Recovery now handles fatal media/network errors, expired sessions, stopped capture processes and stalls, with fresh provider metadata and a bounded retry limit.

## Noah 1.11.2 - empty Trash

TypeScript and build passed. The isolated browser scenario passed missing-confirmation rejection, cancelling the dialog, permanent deletion of the confirmed items, preserving a newly trashed item added during confirmation, keeping original input files byte-identical, and disabling the button when Trash is empty. No runtime errors were recorded. No real user Trash items were deleted.

## Noah 1.11.1 - bulk deletion

The isolated Playwright scenario passed Select all, Clear selection, single confirmation, cancellation without changes, partial deletion with saved-project protection and an explicit skipped-file message, byte-identical restore, and deleting two exports together while keeping their source. No browser runtime errors were recorded. The real user library was not deleted during testing.

## Noah 1.11.0 - streamer voice reduction

A real ONNX UVR model was downloaded, checksum-verified and exercised locally.
On the public speech fixture, full-strength reduction lowered RMS speech level by
22.75 dB while preserving sample count. A controlled speech-plus-stereo-background
fixture retained background projection gain near 1.0 and strongly reduced speech.
These are synthetic/controlled checks, not a guarantee for arbitrary gameplay.

The targeted Playwright scenario passed: two source audio tracks appeared in the
Audio panel, the processed listening sample played, AI reduction was applied to
an edited MP4, background tone gain exceeded 0.6 and residual speech projection
was below 0.35. Selecting the separate game-only track without AI produced
sample-identical lossless game audio. Video packet hashes matched across the two
exports. Listening samples stayed out of the normal media library. No browser
runtime errors were recorded.

## Noah 1.10.0 ? provider history before joining

The current Kick live link exposed a matching ongoing replay with several hours
of history. A real online Playwright run passed: full replay loaded, seek to
00:30:00 worked, Go to beginning worked, a 00:00:02?00:00:06 selection downloaded
from the original replay segments, returned to live playback, and produced a playable reviewed clip with
audio at native HD resolution. The test used an isolated library. Provider
headers are forwarded by a local segment proxy; history clip jobs remain
independent of the viewing session. A first run found and corrected FFmpeg's
rejection of HTTP headers on file-based manifests.

Five targeted local browser scenarios also passed: immediate source playback, streamed playback lifecycle, local rewind clipping, original 720p60 preservation, and audible edited downloads/legacy repair.

All 12 backend test groups passed, including HLS sequence, byte-range, encryption
key/map URI and timestamp checks, plus exact-broadcast replay matching that rejects
previous broadcasts. TypeScript and production build passed. Existing 1.9 audio
and rendering regression coverage is retained. Evidence is under
`verification/live-history-regression/`.

Full-start access depends on provider DVR/replay availability. Actual full-history
provider testing covers Kick; other HLS provider windows are not universally
certified. This feature does not reconstruct segments a platform no longer serves.

## Noah 1.9.1 ? edited download audio

Recent user exports contained audible FLAC audio (measured means -17.6/-20.7 dB),
but FLAC was their only/default MP4 audio stream. The fix adds a default 320 kbps
AAC stereo playback track while retaining the lossless FLAC master and copying
video packets unchanged. Both full rendered previews and edited downloads use it.
An existing-export repair action creates a separate compatible copy.

TypeScript/build and all 10 backend test groups passed. A targeted Playwright
scenario also passed: Chromium Web Audio measured a non-silent signal from the
default track, downloaded bytes matched the exported file, AAC was first/default
and FLAC remained second, and repairing an old FLAC-only fixture preserved the
video packet hash and lossless audio packet hash exactly. Originals were retained.
This validates Chromium and the MP4 stream structure; every Windows player was not
tested individually.

## Noah 1.9.0 ? Snap-Ninja feature integration

Validated on this Windows workspace on 18 November 2026:

- **26/26 local Playwright scenarios passed** in one full run (3.8 minutes).
- **1/1 additional targeted browser scenario passed** for quick last-range selection,
  I/O/C keyboard clipping, timestamp nudges, feedback and dual-format export controls.
- **10/10 backend test groups passed**, including real FFmpeg/Faster-Whisper media
  processing, quiet-boundary sample/offset preservation, chat baseline/spike logic,
  mocked Ollama/Claude review and mocked Google OAuth/resumable upload.
- TypeScript checking and production build passed. No browser JavaScript runtime
  errors were recorded in the successful scenarios.

New rendering checks exercised blurred fill, no-face tracking fallback, generated
32-second lo-fi audio, source-triggered music ducking, FLAC audio, progressive neon
captions, native FPS, lossless edited MP4 and dual 9:16/16:9 output. Batch checks
imported two local files without changing their bytes, retained full source duration
and canvas during captioning, and verified that the preferred-folder MP4 copy was
byte-identical to the library export even after the preference changed mid-job.

The Google test uses a local mock for authorization/token/channel/upload responses:
PKCE/state validation, explicit per-upload approval, Windows DPAPI-protected token
storage and an actual two-chunk 8+ MB byte transfer passed. No real account was
connected, no external video was uploaded and no paid Claude request was made.
Model tests validate the request/response contracts; no Ollama model was installed.

Evidence: `verification/snap-ninja-regression/full-local-run.json` records the
observed successful 26-case console result; the original HTML/trace was replaced
by the later targeted run. Its report/trace are in `playwright-report/` and
`test-results/studio-artifacts/`, and its summary is copied to
`verification/snap-ninja-regression/targeted-controls-summary.json`.

Five internet-dependent legacy scenarios were excluded from this local run.
Automatic provider chat connections and real spikes, long continuous live sessions,
real local/vision/Claude inference, GPU speech recognition and real YouTube publishing
were not exercised end to end. Speaker-selection accuracy was not measured; the
new framing render test verifies no-face fallback. Those remain environment-dependent,
rather than being counted as locally verified results. See `FEATURE_COMPARISON.md`
for implementation differences and setup requirements.

## Previous 1.8 validation

Verified on 18 November 2026 using Playwright Chromium on Windows and Node.js 22.17.0.

Noah 1.8.0 passed **23 of 23 local browser scenarios**, plus a final legacy-project migration check (1 of 1), with no skipped cases or recorded JavaScript runtime errors, The full backend suite passed **5 of 5 test groups**, including the new word-timing and neon animation checks. TypeScript checking and the production build passed. The current HTML report and scenario summary show the final targeted legacy-project check. The full 23-case summary and 57-second MP4 evidence are preserved in `verification/editor-regression/`.

The editing scenario verified immediate paused-frame color changes, zoom/shake controls, visible text and watermark updates, playback speed, canvas ratio, speech-based automatic title/caption generation, editable generated SRT, manual changes after automatic editing, selected-scene rendered preview playback, and automatic rendered-preview refresh. Preview files stayed out of the media library. A duplicate fixture name caused an earlier test-selector failure; the editing test now uses its own uniquely named fixture.

The five internet-dependent scenarios were excluded from this editor regression. Earlier runs verified YouTube video/live imports, live viewing and rewind, early recording finish, and playback fallback. A prior long browser run observed one online fallback stall; isolated reruns passed. Platform/network availability remains a limitation.

Original-quality verification compared decoded video frame hashes and encoded AAC packet hashes against the source. Native 1280 x 720 resolution and 60 FPS were retained through the separate original buffer, reviewed download button, and MP4 export. The viewing proxy remained 960 pixels wide at 30 FPS. Queue tests verified live and interactive clipping during background processing.

| Area | Verified result |
| --- | --- |
| Local file management | Save-as streamed byte-identical data through a test file handle. Download fallback worked. The reveal endpoint resolved the actual library path. Saved-project and active-job references blocked deletion. Saved project deletion kept the source file. Trashing, byte-identical restore, and confirmed permanent deletion passed; the uploaded original remained intact. |
| Animated speech subtitles | Real local speech transcription generated word timestamps for selected footage at 1.25x speed. GTA VI-inspired word-pop and spoken-word highlight modes followed those times in the live preview. Bundled Anton loaded, exact preview played, and the edited 720 x 960 MP4 retained the theme. Decoded captioned frames differed from the same render with subtitles disabled. Automatic editing preserved the theme and structured word timings. |
| Complete editor download workflow | A 57-second dashboard link flowed into Video Editor, AI editing, native 1280 x 720 at 60 FPS preview, edited download and source-quality download. All retained the complete duration; frame hashes at 50 seconds matched the source when visual effects were disabled. Inline job progress and ready links worked, and source-copy results persisted after navigation/reload. The older saved-project check upgraded 360p/30 FPS/NVENC defaults to native 720p60 lossless CPU output. |
| Expanded controls | Brightness, contrast, saturation, sharpening, rotation, mirror and vignette changed live state and rendered correctly; reset worked. AI options separate intro, heading, caption, motion, color, pace, normalization and silence removal. Intro is off by default and AI preserves footage. |
| Navigation and layout | All nine workspace pages loaded. Empty and populated layouts passed horizontal-overflow checks at 390 px. |
| Local imports | Video and music uploaded through browser file controls. Rights validation and choosing the same file again worked. |
| Upload recovery | A multi-chunk upload paused, resumed from its saved offset after reload, and completed. A second incomplete upload was cancelled. |
| Immediate playback and clipping | Pasted local sources played before import; the selected range preview stopped at its boundary and prepared the exact interval. Streamed HLS played and released its session on navigation. YouTube live playback and finishing a 120-second recording early passed. |
| Rewind and mark while watching | Back 5/10 seconds, forward 5 seconds, start/end markers, and bounded preview passed. A selected buffered interval produced a five-second H.264 MP4 after the viewing session closed. Real live rewind clipping passed. Rights and out-of-buffer validation rejected invalid requests. |
| Playback recovery | Blocked YouTube controls switched automatically to streamed video, which played the existing recording URL. The deployed server on port 3000 served a playable HLS manifest for its saved source. |
| Original-quality preservation | A 1280 x 720, 60 FPS fixture used a 960-pixel/30 FPS viewing proxy while its buffered source retained native resolution and frame rate. Original buffered video decoded to pixel-identical source frames; encoded AAC packet hashes matched the source. Original MP4 export passed the same comparisons. |
| Link detection | Browser workflows passed for a public YouTube video and NASA's live YouTube stream. Each imported a timed section and stopped for review. |
| Manual timestamps | Three independently entered ranges retained their times and selection after reload. Every range played, stopped at its boundary, and exported at the requested duration. |
| Highlight analysis | Real motion, scene, audio, and speech analysis produced reviewable candidates. All candidates had video players. Uniform activity and loud audio alone produced no fabricated peaks in deterministic tests. |
| Short formats | Browser-selected 3:4 output downloaded and decoded as 1080 × 1440 H.264/AAC MP4. 9:16 output was verified at 1080 × 1920 in the backend suite. Both formats rejected reviewed ranges exceeding two minutes. |
| Other canvases | Real exports passed for 16:9, 1:1, 4:5, and custom 5:4. The custom-ratio field accepted and saved a value through the browser. |
| Export settings | Actual renders passed at 720p, 1080p, 1440p, and 2160p, plus 30/60 FPS and explicit bitrate settings. Test-source upscaling was used for higher resolutions. |
| Automatic editing and live preview | Local speech recognition generated titles, headings, and SRT for selected footage. Manual visual changes appeared while paused. Rendered previews now retain the complete selected timeline at its selected/native canvas and frame rate, with lossless H.264/FLAC output. No automatic 360p or 30-second cap remains. |
| Editing | Trim, split, drag-to-reorder, undo, redo, title cards, overlays, watermark, slow/fast playback, shake, crossfades, music selection, and project reopening passed. |
| Presets | All five presets rendered. Decoded frame hashes differed across presets. |
| Speech and captions | Faster-Whisper base produced real speech text and word timings. Transcript editing, SRT import, SRT/VTT downloads, and burned-in caption rendering passed. |
| Audio | AAC tracks, start-time alignment, normalization, music mixing, and synchronized silence cuts passed. |
| Long recordings | A 30-minute synthetic source completed analysis. An explicitly selected 20-minute range rendered as a playable 16:9 MP4 at 640 × 360. |
| Compilations | Browser-selected highlights compiled, played, and downloaded. Available footage was used up to the requested target. |
| Downloads | Local and public-source browser flows downloaded actual MP4 files. FFprobe verified dimensions, codecs, and duration. Byte-range delivery passed backend tests. |
| Job recovery | A failed preview job succeeded on retry. Queued and running jobs cancelled through browser controls. Projects and media remained accessible after restarting the test server. |
| Encoding | CPU H.264 and NVIDIA NVENC both rendered successfully on this machine. |

The browser tests used an isolated SQLite database and generated fixtures. They did not operate on the user's recording library.

## Fixes made during testing

- Removed the 1080p capture limit, changed live capture to stream copy, separated original rewind storage from the preview, and added original-quality review/editor downloads.
- Raised edited export quality and added edited resolution selection to the link workflow.
- Activated the updated backend; the open server had still been running version 1.2.1. The deployed server now reports 1.8.0.
- Added automatic streamed fallback when YouTube controls fail or remain unready.
- Added a rolling live buffer, marker controls, and independent queued snapshots for reviewed clipping.

- Added the missing 3:4 option to the main link form and verified its downloaded dimensions.
- Reset the file picker after a rights-validation rejection so choosing the same file again starts an upload.
- Persisted workflow preferences, including the selected short-form ratio, through reloads.
- Persisted the reviewed export job identifier so completed review exports can be recovered after reload.
- Kept manual timestamp entry open while adding multiple ranges.
- Corrected the custom-canvas selector so it opens an editable custom-ratio field.
- Updated preview boundary handling when a range's start time or browser proxy changes.
- Disabled exporting while an edited timestamp is invalid, and restored exporting after correction.

## Evidence

- [Latest Playwright HTML report](playwright-report/index.html)
- [Full editor regression summary](verification/editor-regression/summary.json)
- [57-second full-quality preview](verification/editor-regression/57-second-preview.mp4)
- [57-second edited download](verification/editor-regression/57-second-edited.mp4)
- [Scenario summary and runtime errors](test-results/studio-artifacts/summary.json)
- [Browser trace](test-results/studio-artifacts/trace.zip)
- [Dashboard screenshot](test-results/studio-artifacts/dashboard.png)
- [Review screenshot](test-results/studio-artifacts/review.png)
- [Editor screenshot](test-results/studio-artifacts/editor.png)
- [Live editing preview screenshot](verification/editor-regression/live-edit-preview.png)
- [Rendered neon subtitle frame](verification/editor-regression/gta-vi-subtitles.png)
- [Mobile screenshot](test-results/studio-artifacts/mobile.png)

## Reproduce

Run `npm.cmd run check` and `npm.cmd test` for TypeScript, backend, transcription, ranking, and long-duration checks.

Install the test browser with `npx.cmd playwright install chromium`, then run `npm.cmd run test:e2e` for local browser scenarios.

For the complete run used here, set `$env:E2E_ONLINE = '1'` in PowerShell and run `npm.cmd run test:e2e`. Online tests use public YouTube sources and require network access. The HTML report and test artifacts are refreshed on each run.

## Coverage limits

The GTA VI-inspired theme uses the open-licensed Anton font, not an official Rockstar font. Recognized word timings are preserved through source trimming, speed changes, automatic titles, preview, and MP4 burn-in. Imported/edited text without aligned words uses estimated timing. Recognition accuracy in actual gameplay with overlapping speech, loud music, and effects still requires review; the test used a speech fixture. SRT/VTT sidecars retain text and line timing rather than visual animation. See the included Anton OFL license and the README theme notes.

The native operating-system save chooser and Explorer window were not driven by Playwright. Save-as tests supplied a file-handle adapter and verified byte equality; the Explorer launcher was disabled only in the isolated test server while its resolved path was checked. The normal running app enables Explorer. Save chooser availability varies by browser; the fallback uses normal browser download settings. See [MDN save picker documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker). No existing user-library file was deleted during verification.

Live browser effects are approximations. Rendered previews default to the complete timeline at selected/native resolution and frame rate, with lossless video/audio encoding. Selecting a single scene intentionally previews only that scene. Lossless H.264/FLAC MP4 playback and audio decoding were verified in Chromium; other player compatibility, HDR/10-bit and variable-frame-rate workflows were not comprehensively exercised. High/Standard H.264/AAC modes remain explicit compatibility choices. Automatic editing uses local speech recognition and the selected editing preset, with a source-title fallback; it does not perform semantic game-event recognition or generative story construction.

Original-quality checks used H.264/AAC at 720p60. Source copying supports additional codecs when their MP4 remux is supported; 4K/HDR, AV1, VP9, and HEVC original-copy preservation were not separately exercised. The native encoded streams are copied, with no silent compressed fallback on muxing failure. Original-copy cuts align to keyframes. File-container overhead and clip duration can change file size. Edited output remains a re-render: effects, scaling, color conversion, motion and timing changes intentionally alter it. Lossless encoding avoids additional quantization loss of the rendered output. The no-effect 57-second native-resolution case retained pixel-identical decoded video frames. Previously compressed imports require re-importing their source to recover available native quality.

The ranking tests verify audiovisual peak selection. Semantic game-event accuracy still needs annotated gameplay evaluation. The real long-duration test used synthetic footage. The speech model tested was Whisper base.

Twitch/Kick imports and Docker startup were not exercised in this run. Platform access, extractor support, and additional model downloads can vary by source and environment.
