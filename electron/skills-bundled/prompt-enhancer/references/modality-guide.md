# Prompt guide by modality and tool

## 1. Image
**Structure:** `[Main subject] + [Action/setting] + [Style or medium] + [Lighting] + [Camera/lens] + [Colors/mood] + [Parameters]`
- **Lighting:** rim light, volumetric light, golden hour, cinematic lighting, chiaroscuro, studio softbox, neon backlight, natural window light, overcast soft light.
- **Camera/lens:** 35mm photograph, 85mm portrait lens, f/1.4, shallow depth of field, wide-angle low shot, macro detail, aerial drone view, shot on medium format, film grain.
- **Midjourney:** `--ar 16:9` (landscape), `--ar 9:16` (vertical), `--ar 1:1`; `--v 6.1`; `--stylize 0–1000`; `--no blur, distortion, low quality`.
- **DALL·E / GPT image:** full sentences; describe text to render in quotes; no flags.
- **Local models in Orbi:**
  - FLUX.2 / FLUX.3 Klein, Qwen Image, Krea 2, Mage-Flow, Z-Image: rich natural language; put text to render in quotes; size is chosen in the app, not in the prompt.
  - Negative prompt in its own field: `blurry, low quality, watermark, deformed hands, extra fingers, distorted face, oversaturated` — add items that fit the scene.
  - Editing models (Klein, Qwen Image Edit, Mage-Flow Edit): write the change as an instruction ("make it a snowy evening, keep the person the same").

## 2. Video
**Structure:** `[Camera movement] + [Subject and action] + [Setting/weather] + [Pace] + [Cinematic style]`
- **Camera:** slow dolly-in, tracking shot following the subject, orbit, crane up, static tripod, handheld, FPV drone fly-through, tilt down.
- **Motion and physics:** smooth motion, realistic physics, slow motion, seamless loop, fluid dynamics.
- **Local Wan / LTX in Orbi:** 2–4 sentences describing what happens over time; LTX-2.3 also reads sound cues ("rain on the window, soft piano"). Negative: `blurry, flickering, jitter, morphing, warped faces, static frame, watermark, subtitles`.

## 3. Audio and music
- **Suno / Udio tags:** exact sub-genre (synthwave, indie folk, lo-fi hip hop, cinematic orchestral), tempo (slow 70 BPM, energetic 128 BPM), vocals (raspy male, ethereal female choir), instruments (acoustic guitar, 808 bass, brass section), structure ([Intro] [Verse] [Chorus]).
- **Voice (ElevenLabs and similar):** delivery tags `[whispering]`, `[sighs]`, `[laughs]`, `[excited]`, `[warm conversational tone]`; specify pace and pauses with punctuation.

## 4. Text and code — ROCI
- **R — Role:** "Act as a senior [field] specialist."
- **O — Objective:** "Your goal is [exact deliverable]."
- **C — Context and constraints:** audience, length, tone, what must not happen.
- **I — Instructions and input:** numbered steps, the input, the output format and how quality is judged.
