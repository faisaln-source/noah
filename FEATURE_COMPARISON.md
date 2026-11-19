# Snap-Ninja comparison and Noah 1.9 additions

Reviewed the implementation of [Snap-Ninja](https://github.com/Abhinav-murugan1/Snap-Ninja)
at commit `beb5433201f70702604f82572a445142d3bceea9`, rather than treating every README
claim as a verified released feature. Its MIT notice and the bundled YuNet detector
notice are preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

| Reference capability | Noah result |
| --- | --- |
| URL/file imports, YouTube/Twitch live playback, manual timestamps and DVR clipping | Already present. Kept original streams separately from the viewing proxy. |
| Reviewed highlights, previews for each clip, editor, subtitles, MP4 exports | Already present. Kept the complete timeline and native/lossless export defaults. |
| Portrait and landscape output | Already included 9:16, 3:4 and 16:9, custom canvas sizes, source canvas and source FPS. Added one-job dual 9:16 + 16:9 exports per reviewed short range. |
| Blur fill and intelligent framing (`clipper/framing.py`) | Added blurred backgrounds and the upstream YuNet/face, mouth-motion speaker, group and HOG body framing with no-face fallback. Adapted fixed upstream output dimensions to the chosen canvas. Exact preview computes tracking; the immediate canvas approximates it with a centered crop. Reset rotation/mirror before face tracking. |
| Generated music and mixing (`clipper/music.py`, `render.py`) | Added deterministic generated lo-fi, retained user music selection, and added automatic music ducking during speech/loud source action. |
| Caption grouping and progressive words (`clipper/captions.py`) | Added 1–8 words per caption, optional uppercase, and progressive word reveal alongside existing neon pop/highlight/static modes. Source word timings survive trim/speed operations. |
| Last 30/60/120 seconds and I/O/C controls | Added quick range selection and shortcuts. Typing fields and dialogs ignore these shortcuts. Every selected range remains reviewable. |
| Small boundary adjustments and transcript selection | Added ±1/5-second nudges for each boundary, plus choosing a start/end from transcript phrases. Invalid boundaries are rejected. |
| Local folder/direct-path and finished-clip batch mode | Added file/folder path import (up to 100 files, no recursion), full-length batch caption exports, and a CLI client. External originals stay intact. |
| Output folder setting (`clipper/output.py`) | Added remembered absolute destination, snapshotted when each job is queued. Finished MP4/SRT/VTT copies go in job-specific folders. Preview files are excluded. Save As, Explorer reveal, app trash/restore and deletion already existed. External saved copies survive app-library deletion. |
| Good/bad feedback (`clipper/feedback.py`) | Added persistent Good moment / Weak moment ratings. Optional model review receives taste examples. Ratings do not fabricate audiovisual peaks. |
| Local Ollama text/vision (`clipper/brain.py`) | Added optional installed-model selection, speech-context/payoff review, weak-candidate rejection and sampled-frame input for vision models. This is a bounded second review of measured candidates, not the reference's complete multi-pass event-map pipeline. |
| Optional Claude review | Added optional paid Messages API support through `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`. The UI requires explicit cloud-processing consent. Disabled by default; no paid requests were made during development. |
| Chat-spike mode (`clipper/chat.py`, `chat_spikes.py`) | Added anonymous YouTube/Twitch readers, baseline-relative reaction detection, live rate graph, and capture around spikes using original buffered footage. Captures queue for review. Chat latency can shift the reaction; timestamps need review. |
| Continuous live parts (`clipper/live.py`) | Added 2–60-minute parts, 90-second overlap, analysis while capture continues, and a 0.5–24-hour automation limit. Keep the streamed player open; leaving it stops capture. |
| Long-audio memory handling (`clipper/transcribe.py`) | Added disk-backed 16 kHz audio and roughly ten-minute chunks cut near quiet boundaries, retaining absolute word offsets. Added tiny/base/small/medium/large-v3/turbo model selection and CPU/CUDA preference. |
| YouTube publishing (`clipper/youtube.py`) | Added Desktop OAuth with PKCE/state, Windows DPAPI account storage, visible channel, export preview, editable metadata/privacy/audience, explicit per-upload authorization and resumable byte-preserving transfer. Connecting does not upload. |
| Desktop and CLI entry points | Added `Noah Desktop.cmd` using an Edge app window (browser fallback) and `cli.mjs` for local file/folder import or reviewed URL clipping. Unsaved editor timeline drafts now survive reload. |
| Windows installer tooling | The reference contains installer/build scaffolding, but its README says a verified installer is not published. Noah retains source-based setup and launchers; this update does not claim to deliver a signed standalone installer. |

## Deliberate differences and validation limits

The upstream 1080p caps, fixed frame-rate/lossy render defaults and 180-second
portrait limit were not copied. Noah keeps the user's two-minute portrait
limit, original FPS/source copy option, and lossless edited defaults. Reframing
necessarily changes composition; lossless encoding prevents additional codec loss
but cannot preserve pixels removed by a crop or changed by effects.

External originals are not deleted through the new direct-path importer. Library
trash/delete applies to app-owned copies. The upstream external-original Recycle
Bin action and its entire platform-specific installer were not ported.

Local rendering, uploads, subtitles, folder copies and browser workflows use real
media in automated tests. Ollama and Google integration contracts are tested with
local mocks; no large Ollama models or Google credentials were supplied. Active
provider chat, real model inference/CUDA and real Google publishing remain
environment-dependent and are not certified by these local tests. Face-framing
tests cover the no-face fallback; speaker selection accuracy depends on footage.

Implementation follows the official [Google Desktop OAuth guide](https://developers.google.com/identity/protocols/oauth2/native-app),
[YouTube upload guide](https://developers.google.com/youtube/data/guides/uploading_a_video),
and [Claude Messages API](https://platform.claude.com/docs/en/api/messages/create).
