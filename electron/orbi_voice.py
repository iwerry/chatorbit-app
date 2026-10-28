"""Orbi voice worker: runs Hugging Face text-to-speech models in a private Python environment.

Protocol: one JSON object per line on stdin, one JSON reply per line on stdout.
  {"id": "1", "op": "warmup"}                               -> downloads and loads the model
  {"id": "2", "op": "speak", "text": "...", "voice": "...", "lang": "pt", "ref": "/path.wav",
   "rate": 1.0, "out": "/tmp/x.wav"}                         -> writes a WAV file
Replies: {"id": "1", "ok": true} or {"id": "1", "ok": false, "error": "..."}
Logs go to stderr. Part of Orbi by Daniel Rodrigues (Draft Creative Studio).
"""
import json
import os
import sys
import traceback

FAMILY = sys.argv[1] if len(sys.argv) > 1 else "dummy"
os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")  # older checkpoints (Bark) on torch >= 2.6

_model = None
_device = "cpu"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def device():
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def save_wav(path, audio, sr):
    import numpy as np
    import soundfile as sf

    a = np.asarray(audio, dtype="float32").squeeze()
    sf.write(path, a, int(sr), subtype="PCM_16")


# ---------- families ----------
def load():
    global _model, _device
    if _model is not None:
        return _model
    _device = device()
    log(f"[orbi-voice] loading {FAMILY} on {_device}")
    if FAMILY == "chatterbox":
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        _model = ChatterboxMultilingualTTS.from_pretrained(device=_device)
    elif FAMILY == "xtts":
        os.environ["COQUI_TOS_AGREED"] = "1"  # the user accepted the license in Orbi before install
        from TTS.api import TTS

        _model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(_device)
    elif FAMILY == "bark":
        os.environ.setdefault("SUNO_USE_SMALL_MODELS", "True")
        from bark import preload_models

        preload_models()
        _model = "bark"
    elif FAMILY == "parler":
        from parler_tts import ParlerTTSForConditionalGeneration
        from transformers import AutoTokenizer

        repo = "parler-tts/parler-tts-mini-multilingual-v1.1"
        m = ParlerTTSForConditionalGeneration.from_pretrained(repo).to(_device)
        _model = (m, AutoTokenizer.from_pretrained(repo), AutoTokenizer.from_pretrained(m.config.text_encoder._name_or_path))
    elif FAMILY == "dummy":
        _model = "dummy"
    else:
        raise RuntimeError(f"Unknown voice family: {FAMILY}")
    return _model


XTTS_LANGS = {"pt", "en", "es", "fr", "de", "it", "pl", "tr", "ru", "nl", "cs", "ar", "zh", "ja", "hu", "ko", "hi"}
PARLER_VOICES = {
    "warm-female": "A female speaker with a warm, clear voice speaks at a moderate pace in a quiet studio, very close to the microphone.",
    "calm-male": "A male speaker with a calm, deep voice speaks slowly and clearly in a quiet room, very close to the microphone.",
    "news-female": "A female news anchor speaks confidently with clear articulation at a slightly fast pace, studio quality.",
    "storyteller-male": "A male storyteller speaks expressively with a gentle, engaging tone and natural pauses, studio quality.",
    "energetic-female": "A young female speaker sounds energetic and cheerful, speaking quickly with high expressiveness, clear audio.",
    "radio-male": "A mature male radio host speaks with a warm, rich voice at a moderate pace, studio quality.",
}


def speak(req):
    m = load()
    text = (req.get("text") or "").strip()
    out = req["out"]
    lang = (req.get("lang") or "en")[:2].lower()
    voice = str(req.get("voice") or "")
    ref = req.get("ref") or None
    if not text:
        raise RuntimeError("Nothing to read.")
    if FAMILY == "chatterbox":
        import torchaudio as ta

        kw = {"audio_prompt_path": ref} if ref else {}
        try:
            wav = m.generate(text, language_id=lang, **kw)
        except Exception as e:  # language not supported by this checkpoint: fall back to English
            if "lang" not in str(e).lower():
                raise
            wav = m.generate(text, language_id="en", **kw)
        ta.save(out, wav.cpu(), m.sr)
    elif FAMILY == "xtts":
        kw = {"text": text, "language": lang if lang in XTTS_LANGS else "en", "file_path": out}
        if ref:
            kw["speaker_wav"] = ref
        else:
            kw["speaker"] = voice or "Ana Florence"
        m.tts_to_file(**kw)
    elif FAMILY == "bark":
        from bark import SAMPLE_RATE, generate_audio

        preset = voice or f"v2/{lang}_speaker_0"
        audio = generate_audio(text, history_prompt=preset)
        save_wav(out, audio, SAMPLE_RATE)
    elif FAMILY == "parler":
        model, tok, desc_tok = m
        desc = PARLER_VOICES.get(voice, voice or PARLER_VOICES["warm-female"])
        ids = desc_tok(desc, return_tensors="pt").input_ids.to(_device)
        pids = tok(text, return_tensors="pt").input_ids.to(_device)
        gen = model.generate(input_ids=ids, prompt_input_ids=pids)
        save_wav(out, gen.cpu().numpy(), model.config.sampling_rate)
    elif FAMILY == "dummy":
        import math
        import struct
        import wave

        sr = 16000
        with wave.open(out, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / sr))) for i in range(sr // 4)))


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = {}
        try:
            req = json.loads(line)
            op = req.get("op")
            if op == "warmup":
                load()
            elif op == "speak":
                speak(req)
            elif op == "ping":
                pass
            else:
                raise RuntimeError(f"Unknown op {op}")
            print(json.dumps({"id": req.get("id"), "ok": True, "device": _device}), flush=True)
        except Exception as e:  # report the error to Orbi instead of dying
            log(traceback.format_exc())
            print(json.dumps({"id": req.get("id"), "ok": False, "error": f"{type(e).__name__}: {e}"[:600]}), flush=True)


if __name__ == "__main__":
    main()
