"""Local, CPU-compatible media analysis and speech recognition worker.

One JSON request file per invocation. Progress is newline-delimited JSON on stdout.
FastAPI exposes the same functions for independent deployments.
"""
import argparse
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import uuid

import cv2
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
from highlights import rank_moments

MODELS = {}


def progress(value, message):
    print(json.dumps({"progress": value, "message": message}), flush=True)


def transcribe(request):
    from faster_whisper import WhisperModel

    model_name = request.get("model", "base")
    if model_name not in ("tiny", "base", "small", "medium", "large-v3", "turbo"):
        raise ValueError("Unsupported Whisper model")
    device = request.get("device", "cpu")
    key = (model_name, device)
    progress(5, "Loading local speech model")
    if key not in MODELS:
        MODELS[key] = WhisperModel(
            model_name, device=device,
            compute_type="int8" if device == "cpu" else "float16",
            download_root=request.get("modelCache"),
        )
    from snap_ninja.audio_chunks import _audio_chunks
    result = []
    duration = max(float(request.get("duration", 1)), 1)
    language = request.get("language") or None
    import tempfile
    wave_file = Path(request.get("output") or str(Path(tempfile.gettempdir()) / (str(uuid.uuid4()) + ".json"))).with_suffix(".speech.wav")
    try:
        subprocess.run([request["ffmpeg"], "-y", "-v", "error", "-i", request["file"], "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wave_file)], check=True)
        for offset, audio in _audio_chunks(wave_file):
            segments, info = MODELS[key].transcribe(audio, language=language, word_timestamps=True, vad_filter=True, beam_size=5, condition_on_previous_text=False, hallucination_silence_threshold=2)
            language = language or info.language
            for segment in segments:
                if segment.no_speech_prob > 0.65 or segment.avg_logprob < -1:
                    continue
                words = [{"start": w.start + offset, "end": w.end + offset, "text": w.word.strip(),
                          "probability": w.probability} for w in segment.words or []]
                if words:
                    group = []
                    for word in words:
                        if group and (len(group) >= 6 or word["end"] - group[0]["start"] > 3.0 or word["start"] - group[-1]["end"] > .6):
                            result.append({"start": group[0]["start"], "end": group[-1]["end"],
                                           "text": " ".join(w["text"] for w in group), "words": group})
                            group = []
                        group.append(word)
                    if group:
                        result.append({"start": group[0]["start"], "end": group[-1]["end"],
                                       "text": " ".join(w["text"] for w in group), "words": group})
                else:
                    result.append({"start": segment.start + offset, "end": segment.end + offset,
                                   "text": segment.text.strip(), "words": []})
                progress(min(98, 10 + (segment.end + offset) / duration * 88), "Transcribing speech")
    finally:
        wave_file.unlink(missing_ok=True)
    return {"language": language, "segments": result,
            "model": model_name, "engine": "faster-whisper"}


def analyze(request):
    """Rank audiovisual activity, without inventing semantic game events."""
    file = request["file"]
    duration = float(request["duration"])
    clip_length = min(float(request.get("clipDuration", 30)), duration)
    sample_step = {"fast": 2.0, "balanced": 1.0, "quality": 0.5}.get(request.get("mode"), 1.0)
    bins = max(1, math.ceil(duration))
    motion = np.zeros(bins)
    scenes = np.zeros(bins)
    crop_points = []
    progress(2, "Sampling motion and scene changes")
    # FFmpeg decodes sequentially, so long-GOP recordings need no repeated seeks.
    command = [request["ffmpeg"], "-v", "error", "-i", file, "-an", "-vf",
               f"fps=1/{sample_step},scale=160:90,format=gray", "-f", "rawvideo", "pipe:1"]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    previous = None
    frame_index = 0
    try:
        while True:
            frame_data = process.stdout.read(160 * 90)
            if len(frame_data) < 160 * 90:
                break
            frame = np.frombuffer(frame_data, dtype=np.uint8).reshape(90, 160)
            t = frame_index * sample_step
            index = min(bins - 1, int(t))
            if previous is not None:
                delta = cv2.absdiff(frame, previous)
                sample_end = min(bins, max(index + 1, math.ceil(t + sample_step)))
                motion[index:sample_end] = np.maximum(motion[index:sample_end], float(np.mean(delta)) / 255)
                histogram_a = cv2.calcHist([frame], [0], None, [32], [0, 256])
                histogram_b = cv2.calcHist([previous], [0], None, [32], [0, 256])
                scenes[index:sample_end] = np.maximum(scenes[index:sample_end], max(0, 1 - cv2.compareHist(histogram_a, histogram_b, cv2.HISTCMP_CORREL)))
                # Motion centroid is a pan suggestion, not object identification.
                central = delta[9:81, 8:152].astype(float)
                weights = central.sum(axis=0)
                centroid = (8 + float(np.dot(weights, np.arange(144))) / max(1, weights.sum())) / 160
                if frame_index % max(1, int(5 / sample_step)) == 0:
                    crop_points.append({"time": round(t, 2), "x": round(float(np.clip(centroid, .2, .8)), 3)})
            previous = frame
            frame_index += 1
            if frame_index % 20 == 0:
                progress(min(48, 2 + t / max(1, duration) * 46), "Measuring visual activity")
    finally:
        process.stdout.close()
        return_code = process.wait()
    if return_code:
        raise RuntimeError("Video decoding failed during analysis")

    audio = np.zeros(bins)
    if request.get("hasAudio", True):
        progress(50, "Measuring audio energy")
        command = [request["ffmpeg"], "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            for index in range(bins):
                chunk = process.stdout.read(8000 * 4)
                if not chunk:
                    break
                values = np.frombuffer(chunk[:len(chunk) // 4 * 4], dtype=np.float32)
                audio[index] = float(np.sqrt(np.mean(values ** 2))) if values.size else 0
        finally:
            process.stdout.close()
            code = process.wait()
        if code:
            raise RuntimeError("Audio decoding failed during analysis")

    transcript = request.get("transcript", {}).get("segments", [])
    ranked = rank_moments(motion, scenes, audio, transcript, duration,
                          clip_length, int(request.get("maxClips", 200)))
    progress(95, "Ranking prominent, non-overlapping activity peaks")
    return {**ranked, "cropPoints": crop_points,
            "signals": {"audio": bool(np.any(audio)), "motion": bool(np.any(motion)),
                        "sceneChanges": bool(np.any(scenes)), "speech": bool(transcript)},
            "mode": request.get("mode", "balanced"),
            "limitations": "Measured audiovisual peaks require human review. Game-specific events and semantic understanding are not inferred.",
            "sampleStep": sample_step}


def execute(request):
    if request["operation"] == "remove-voice":
        from voice_separation import separate
        result = separate(request, progress)
    elif request["operation"] == "music":
        from snap_ninja.music import generate_lofi
        generate_lofi(Path(request["destination"]), seconds=32)
        result = {"generated": True}
    elif request["operation"] == "framing":
        from snap_ninja import framing
        from dataclasses import asdict
        framing.OUT_W, framing.OUT_H = int(request["width"]), int(request["height"])
        framing.FFMPEG = request["ffmpeg"]
        result = asdict(framing.plan(request["file"], request["start"], request["end"], request["sourceWidth"], request["sourceHeight"], request.get("mode", "auto"), request.get("speech")))
    else:
        result = transcribe(request) if request["operation"] == "transcribe" else analyze(request)
    if request.get("output"):
        destination = Path(request["output"])
        temporary = destination.with_suffix(".tmp")
        temporary.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        temporary.replace(destination)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("request")
    args = parser.parse_args()
    try:
        execute(json.loads(Path(args.request).read_text(encoding="utf-8")))
        progress(100, "Complete")
    except Exception as error:
        print(json.dumps({"error": str(error)}), flush=True)
        sys.exit(1)
else:
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel
    app = FastAPI(title="Noah local AI worker")

    class AnalysisRequest(BaseModel):
        operation: str
        file: str
        duration: float
        ffmpeg: str = "ffmpeg"
        clipDuration: float = 30
        maxClips: int = 8
        mode: str = "balanced"
        model: str = "base"
        language: str | None = None
        modelCache: str | None = None
        hasAudio: bool = True
        transcript: dict = {}

    @app.get("/health")
    def health():
        return {"ready": True, "device": "cpu"}

    @app.post("/process")
    def process(request: AnalysisRequest):
        if not Path(request.file).is_file():
            raise HTTPException(400, "Media file not found")
        return execute(request.model_dump())
