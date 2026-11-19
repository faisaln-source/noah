# Snap-Ninja components

Noah includes adapted `clipper/framing.py` `clipper/music.py`, `clipper/chat.py` and `clipper/chat_spikes.py` and the audio chunk helper from `clipper/transcribe.py` from
[Snap-Ninja](https://github.com/Abhinav-murugan1/Snap-Ninja), commit
`beb5433201f70702604f82572a445142d3bceea9`.

Copyright (c) 2026 Abhinav Murugan. MIT license; the complete notice is included in
[ai/snap_ninja/LICENSE](ai/snap_ninja/LICENSE).

Framing was adapted to Noah's selected canvas dimensions and FFmpeg worker,
without the upstream fixed 1080x1920 export limit. Detector fallback is retained.

The bundled YuNet detector has its own MIT notice, copyright (c) 2020 Shiqi Yu,
in [ai/snap_ninja/models/LICENSE.YuNet](ai/snap_ninja/models/LICENSE.YuNet).

The reference checkout under `verification/snap-ninja-reference` is for source
comparison only and is not required to start Noah.

# Ultimate Vocal Remover voice model

The optional/local voice-reduction model is **UVR_MDXNET_Main.onnx**, by Ultimate
Vocal Remover developers **Anjok07 and aufr33**. The upstream project states MIT
licensing and requests developer attribution for third-party use of its models:
https://github.com/Anjok07/ultimatevocalremovergui#license

Model distribution:
https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR_MDXNET_Main.onnx

SHA-256: `8289784cda38543ff431add4070662813311a8cccfc0112ca82f76d9dba2b4ca`.
The model is downloaded to the local model cache; ONNX Runtime performs inference.
Noah's NumPy STFT/overlap-add inference code was written for this integration.
The UVR parameter metadata identifies the model as Vocals, FFT 7680, 3072 bins,
256 frames, compensation 1.043. This model estimates vocals; it does not identify
an individual streamer or guarantee preservation of game dialogue.
