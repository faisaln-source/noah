"""Deterministic audiovisual peak selection with explicit prominence gates."""
import uuid
import numpy as np


def rank_moments(motion, scenes, audio, transcript, duration, maximum_length=60, limit=200):
    count = len(motion)
    if not count:
        return {"highlights": [], "activity": [], "threshold": 0}

    def normalize(values, floor):
        return np.clip(values / max(floor, float(np.percentile(values, 95))), 0, 1)

    visual = normalize(motion, .035)
    cuts = normalize(scenes, .35)
    energy = normalize(audio, .04)
    speech = np.zeros(count)
    for segment in transcript:
        start = max(0, min(count - 1, int(segment["start"])))
        end = max(start + 1, min(count, int(np.ceil(segment["end"]))))
        rate = len(segment.get("words", [])) / max(1, segment["end"] - segment["start"])
        speech[start:end] = np.maximum(speech[start:end], min(1, rate / 4))
    scores = .46 * visual + .18 * cuts + .22 * energy * np.maximum(visual, speech) + .14 * speech
    window = min(3, count)
    smoothed = np.convolve(np.pad(scores, (window // 2, window - 1 - window // 2), mode="edge"), np.ones(window) / window, mode="valid")
    baseline = float(np.median(smoothed))
    spread = float(np.median(np.abs(smoothed - baseline)))
    threshold = max(.20, baseline + max(.09, spread * 1.5))
    peaks = []
    for index in range(count):
        left = smoothed[max(0, index - 2):index]
        right = smoothed[index + 1:min(count, index + 3)]
        if smoothed[index] < threshold or (left.size and np.max(left) > smoothed[index]) or (right.size and np.max(right) > smoothed[index]):
            continue
        local = smoothed[max(0, index - 45):min(count, index + 46)]
        prominence = float(smoothed[index] - np.percentile(local, 35))
        if prominence < .09:
            continue
        # Tiny changes and isolated loud audio cannot create a candidate.
        if max(motion[max(0, index - 1):min(count, index + 2)]) < .008 and max(scenes[max(0, index - 1):min(count, index + 2)]) < .12 and speech[index] < .65:
            continue
        peaks.append((index, prominence))

    candidates = []
    maximum_length = min(float(maximum_length), duration)
    for index, prominence in sorted(peaks, key=lambda item: smoothed[item[0]], reverse=True):
        event_start = index
        event_end = index + 1
        event_threshold = baseline + (float(smoothed[index]) - baseline) * .40
        while event_start > 0 and smoothed[event_start - 1] >= event_threshold:
            event_start -= 1
        while event_end < count and smoothed[event_end] >= event_threshold:
            event_end += 1
        start = max(0, float(event_start) - 3)
        end = min(duration, float(event_end) + 5)
        if end - start > maximum_length:
            start = max(0, min(duration - maximum_length, index - maximum_length * .4))
            end = start + maximum_length
        minimum_length = min(10, maximum_length)
        if end - start < minimum_length:
            start = max(0, min(start, duration - minimum_length))
            end = min(duration, start + minimum_length)
        if any(start < candidate["end"] and end > candidate["start"] for candidate in candidates):
            continue
        a, b = int(start), max(int(start) + 1, int(np.ceil(end)))
        moving = float(np.max(visual[a:b]))
        changing = float(np.max(cuts[a:b]))
        speaking = float(np.max(speech[a:b]))
        evidence = []
        if moving > .3:
            evidence.append("motion peak")
        if changing > .3:
            evidence.append("scene-change peak")
        if float(np.max(energy[a:b])) > .4:
            evidence.append("audio activity")
        if speaking > .2:
            evidence.append("spoken commentary")
        category = "Conversation" if speaking > .7 and moving < .4 else "High activity" if moving > .5 else "Scene change"
        text = " ".join(segment["text"] for segment in transcript if segment["start"] < end and segment["end"] > start)
        candidates.append({"id": str(uuid.uuid4()), "start": round(start, 3), "end": round(end, 3),
                           "eventTime": float(index), "eventStart": float(event_start), "eventEnd": min(duration, float(event_end)),
                           "category": category, "score": round(min(99, (float(smoothed[index]) * .6 + prominence * .8) * 100)),
                           "confidence": round(min(.95, .4 + prominence), 2),
                           "prominence": round(prominence, 3), "baseline": round(baseline, 3),
                           "reason": f'{", ".join(evidence)}; activity rises {prominence:.2f} above surrounding footage',
                           "title": text[:80].strip() or f"{category} at {index // 60:02}:{index % 60:02}"})
        if len(candidates) >= limit:
            break
    stride = max(1, int(np.ceil(count / 1500)))
    activity = [{"time": index, "score": round(float(smoothed[index]) * 100, 1)} for index in range(0, count, stride)]
    return {"highlights": candidates, "activity": activity, "threshold": round(threshold * 100, 1),
            "rankingVersion": 2, "baseline": round(baseline * 100, 1)}
