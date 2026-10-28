---
name: prompt-enhancer
description: The magic wand for prompts. Turns short, vague or weak ideas into professional, detailed prompts for AI generators in any modality — image, video, audio and music, voice, text and code — for cloud tools (Midjourney, DALL·E, Sora, Runway, Kling, Suno, ElevenLabs) and local models (FLUX, Qwen Image, Z-Image, Krea, Wan, LTX). Use whenever the user asks to improve, refine, expand or "magic wand" a prompt, wants a professional prompt, or pastes a weak prompt, even without saying "prompt engineering". Do not use to generate the media itself or for business or behavior analysis.
license: MIT
compatibility: "Any chat model; no tools or scripts required. Tool syntax follows references/modality-guide.md."
metadata:
  author: Daniel Rodrigues
  version: "1.1.0"
---

# Prompt Enhancer — the multimodal magic wand

## Objective
Convert raw ideas into structured, technical and effective instructions for AI generators. Deliver a copy-ready prompt (and a negative prompt when the tool supports one) plus a short explanation of what changed.

## When to use / when not to use
- **Use for:** "improve / refine / expand this prompt", "magic wand", a generic idea for an image, video, song, voice-over or text, adapting an idea to a specific tool's syntax.
- **Do not use for:** actually producing the final text, code or media without prompt work; business or behavior analysis (use behavioral-intelligence).

## Required inputs
1. **Raw idea or original prompt.**
2. **Target modality (optional):** image, video, audio/music, voice, text or code — infer it from the idea when missing.
3. **Target tool (optional):** e.g. Midjourney, FLUX, Sora, Suno, ElevenLabs, or "local model in Orbi". When missing, give a universal version and say which tool it fits best.

## Procedure

### Step 1 — Identify the modality and deconstruct
Find the missing elements for the modality:
- **Image:** subject, action/setting, style or medium, lighting, camera/lens and composition, color palette, materials/texture, aspect ratio.
- **Video:** subject in motion, action over time, camera movement, setting, lighting, pace, aesthetic.
- **Audio/music:** genre and sub-genre, instruments, tempo/BPM, mood, structure, vocal character.
- **Voice:** speaker, emotion, pace, delivery tags.
- **Text/code:** role, objective, context and constraints, inputs, output format, quality criteria (ROCI).

### Step 2 — Expand with technique and parameters
Read `references/modality-guide.md` for the vocabulary and syntax of each tool.
- Replace vague words with concrete sensory and technical detail ("nice car photo" → "35mm automotive photograph, golden hour, neon reflections on wet asphalt, shallow depth of field, f/1.8").
- Keep the user's subject, people, brand names and any text in quotes exactly; never swap the subject.
- Add a negative prompt when the tool supports one (local models, Stable Diffusion family): a comma-separated list of artifacts that fit this prompt.
- **Tool syntax:** Midjourney takes `--ar`, `--v`, `--stylize`, `--no`. Local models in Orbi (FLUX, Qwen Image, Z-Image, Krea, Mage-Flow, Wan, LTX) take plain natural language — no flags; the size and the negative prompt are separate fields.

### Step 3 — Assemble the output
Use `assets/refinement-template.md`. The final prompt goes in a code block, in **English** (most generators work best in English); the explanation is in the user's language.

### JSON mode (for apps)
When asked for JSON — as Orbi's magic wand does — reply with JSON only: `{"prompt": "...", "negative": "..."}`. Keep the prompt under 90 words for images and 2–4 sentences for video.

## Unclear input
- **Missing modality:** infer it from the words (camera, scene → image or video; BPM, vocals → music); if still ambiguous, give the image version and offer the video one.
- **Missing tool:** give the universal natural-language version, then the tool-specific line for the most likely tool.
- **Malformed input** (several ideas mixed, broken JSON): split into separate prompts or repair the JSON and say what you assumed.
- **Policy-sensitive requests** (real people, logos, explicit content): keep within the tool's rules and confirm with the user before going further.

## Verify before sending
Check: subject and quoted text preserved; English prompt in a code block; tool syntax matches the target (no flags for local models); negative prompt present when supported; JSON valid in JSON mode. If a check fails, fix and re-check. This checklist is the manual fallback when no validation script can run.

## Rules
- **English final prompt, explanation in the user's language.**
- **Copy-ready:** the prompt alone inside a code block, no commentary inside it.
- **No lectures:** deliver the refined prompt first; at most three bullets of explanation.
- **No invented facts about real people;** keep likeness requests within the tool's policies.
- If the idea is empty, invent an original, striking prompt and say so.

## Examples

**Image (Midjourney)**
- Input: "improve this image prompt: an astronaut cat on the moon"
- Output prompt: `Cinematic full-body shot of a cute orange tabby cat in a detailed vintage NASA spacesuit, standing on the dusty lunar surface, Earth glowing in the starry black sky, dramatic rim light, photorealistic texture, 70mm lens --ar 16:9 --v 6.1`
- Why: shot type, suit style, lighting, background and official parameters.

**Image (local FLUX / Qwen in Orbi)**
- Input: "poster jazz night"
- Prompt: `Poster for a jazz night: a saxophonist playing under a warm neon sign at dusk, cobblestone street, vintage film grain, bold headline space at the top, deep teal and amber palette`
- Negative: `blurry, low quality, watermark, distorted hands, extra fingers, garbled text`

**Music (Suno)**
- Input: "sad pop about a breakup"
- Prompt: `Melancholic electropop ballad, slow 80 BPM, intimate female vocals with subtle reverb, acoustic piano layered with soft ambient synths, heartbreak and longing, minimal drums building in the final chorus`

**Do not activate:** "Generate the image now" with a finished prompt → generate with the image tool instead.

## Resources
- `references/modality-guide.md` — structure, vocabulary and parameters per tool, including Orbi's local models.
- `assets/refinement-template.md` — delivery format.
