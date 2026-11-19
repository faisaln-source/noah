"""Bounded-memory NumPy STFT inference for the UVR MDX-NET Main vocal model.

Model credit: Ultimate Vocal Remover developers Anjok07 and aufr33 (MIT).
The inference code here is ClipForge's implementation; no PyTorch is required.
"""
from pathlib import Path
import hashlib
import wave
import numpy as np
import onnxruntime as ort

MODEL_SHA256 = '8289784cda38543ff431add4070662813311a8cccfc0112ca82f76d9dba2b4ca'
N_FFT, HOP, BINS, FRAMES = 7680, 1024, 3072, 256
CHUNK = HOP * (FRAMES - 1)
TRIM = N_FFT // 2
STRIDE = CHUNK - TRIM * 2


def spectrum(audio):
    padded = np.pad(audio, ((0, 0), (TRIM, TRIM)), mode='reflect')
    frames = np.lib.stride_tricks.sliding_window_view(padded, N_FFT, axis=1)[:, ::HOP, :]
    window = np.hanning(N_FFT + 1)[:-1].astype(np.float32)
    transformed = np.fft.rfft(frames * window, axis=-1).transpose(0, 2, 1)
    return np.stack((transformed.real, transformed.imag), axis=1).reshape(4, N_FFT // 2 + 1, FRAMES)[:, :BINS].astype(np.float32)


def waveform(values):
    values = values.reshape(2, 2, BINS, FRAMES)
    complex_values = values[:, 0] + 1j * values[:, 1]
    full = np.zeros((2, N_FFT // 2 + 1, FRAMES), dtype=np.complex64)
    full[:, :BINS] = complex_values
    frames = np.fft.irfft(full.transpose(0, 2, 1), n=N_FFT, axis=-1)
    window = np.hanning(N_FFT + 1)[:-1].astype(np.float32)
    result = np.zeros((2, CHUNK + N_FFT), dtype=np.float32)
    weights = np.zeros(CHUNK + N_FFT, dtype=np.float32)
    for i in range(FRAMES):
        start = i * HOP
        result[:, start:start + N_FFT] += frames[:, i] * window
        weights[start:start + N_FFT] += window * window
    result /= np.maximum(weights, 1e-8)
    return result[:, TRIM:-TRIM]


def separate(request, progress):
    model = Path(request['modelFile'])
    if not model.is_file() or hashlib.sha256(model.read_bytes()).hexdigest() != MODEL_SHA256:
        raise ValueError('Voice model is missing or invalid. Install the voice model in the Audio panel.')
    strength = float(request.get('strength', 1))
    if not 0 <= strength <= 1:
        raise ValueError('Voice reduction strength must be between 0 and 1')
    audio = np.memmap(request['pcm'], mode='r', dtype='<f4').reshape(-1, 2)
    if not len(audio):
        raise ValueError('The selected footage has no audio samples')
    options = ort.SessionOptions()
    options.intra_op_num_threads = 3
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model), sess_options=options, providers=['CPUExecutionProvider'])
    with wave.open(request['destination'], 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(3)
        output.setframerate(44100)
        for position in range(0, len(audio), STRIDE):
            valid = min(STRIDE, len(audio) - position)
            start, stop = max(0, position - TRIM), min(len(audio), position - TRIM + CHUNK)
            block = np.zeros((2, CHUNK), dtype=np.float32)
            left = max(0, TRIM - position)
            block[:, left:left + stop - start] = audio[start:stop].T
            inputs = spectrum(block)
            inputs[:, :3] = 0
            # Opposite-polarity averaging reduces model bias/noise without
            # changing timing, sample count or the residual's stereo image.
            forward = session.run(None, {'input': inputs[None]})[0][0]
            inverse = session.run(None, {'input': -inputs[None]})[0][0]
            voice = waveform((forward - inverse) * .5) * 1.043
            reduced = block[:, TRIM:TRIM + valid] - voice[:, TRIM:TRIM + valid] * strength
            reduced = np.nan_to_num(reduced, nan=0, posinf=1, neginf=-1)
            integers = np.ascontiguousarray((np.clip(reduced.T, -1, 1 - 1 / 8388608) * 8388608).astype('<i4'))
            pcm = integers.view(np.uint8).reshape(-1, 4)[:, :3]
            output.writeframesraw(pcm.tobytes())
            progress(min(99, (position + valid) / len(audio) * 100), 'Separating streamer speech from game/background audio')
    return {'samples': len(audio), 'sampleRate': 44100, 'strength': strength, 'engine': 'UVR MDX-NET Main / ONNX CPU'}
