# Library imports — index

Original skills received from Daniel Rodrigues on 2026-10-28 (Portuguese, v1.0.0), kept for reference.
The updated English versions ship in `electron/skills-bundled/` since Orbi 0.1.28-2.

| Folder | Kind | Language | Files | Status |
| --- | --- | --- | --- | --- |
| `inteligencia-comportamental/` | Skill + agent persona | Portuguese | SKILL.md, references/psicologia-e-decisao.md, assets/matriz-influencia-template.md | Done → `electron/skills-bundled/behavioral-intelligence` (v1.1.0, audit 4.67) |
| `prompt-enhancer/` | Skill + agent persona | Portuguese (prompts in English) | SKILL.md, references/guia-modalidades.md, assets/template-refinamento.md | Done → `electron/skills-bundled/prompt-enhancer` (v1.1.0, audit 4.75) |

## 1. inteligencia-comportamental (v1.0.0)
**What it does:** analyses human behaviour, social-media psychology, emotional intelligence and digital decision-making, and turns them into simple business, authentic-marketing and leadership actions.
**Procedure:** (1) map attention stage, cognitive biases and the emotional bottleneck; (2) design an empathetic, human message with less friction; (3) a 3-action plan — do now, adjust, eliminate.
**Output:** Behavioural diagnosis → Influence strategy → Direct action plan.
**Resources:** 4 core biases + social attention cycle (hook 0–3 s, retention 3–30 s, conversion); strategy report template with a content/conversion matrix.
**Boundaries:** no clinical diagnosis or therapy; no manipulative or social-engineering campaigns.

**Update plan**
- Translate everything to English; proposed name `behavioral-intelligence` (display name "Behavioral & Emotional Intelligence"); answer in the user's language.
- Remove leftover source markers (`[1, 25]`, `[8]`, `[109]`, `[6]`, `[3, 8]`).
- Author: Daniel Rodrigues (not "SKILLSMITH"); add `license: MIT`, version 1.1.0.
- The reference promises "12 biases" but lists 4 — complete it to 12 or change the text.
- Add 2 more examples (B2B LinkedIn, team leadership) and an `evals/tests.yaml` (5 positive, 3 near misses, 3 cases).
- Create the matching agent persona: "Behavioral Strategist" (@behavior).

## 2. prompt-enhancer (v1.0.0)
**What it does:** the "magic wand" — turns short or vague ideas into professional prompts for image, video, audio/music, text and code tools.
**Procedure:** (1) detect the modality and the missing elements; (2) expand with technical vocabulary and platform parameters, plus a negative prompt when supported; (3) deliver a copy-ready English prompt with a short explanation in Portuguese.
**Resources:** per-modality guide (Midjourney, Flux, Stable Diffusion, Sora, Runway, Pika, Kling, Suno, Udio, ElevenLabs, ROCI for text/code); delivery template.

**Update plan**
- Add the local models Orbi runs (Z-Image, FLUX.2/FLUX.3 Klein, Qwen Image, Krea 2, Wan, LTX): natural-language prompts, no `--ar`/`--v` flags, negative prompt as a separate field.
- Use it as the system prompt of the magic wand in Creative Canvas and Workflow (JSON `{prompt, negative}` mode).
- Author: Daniel Rodrigues, `license: MIT`, version 1.1.0; English body, answers in the user's language.
- Add `evals/tests.yaml` and the agent persona "Prompt Director" (@prompt).

## Creative update (done in 0.1.28-2)
Creative update requested on 2026-10-28 — status:
- [x] Full-screen viewer (Lightbox) with previous/next, arrow keys, slideshow, film strip, details; wired into the Media Library.
- [x] Negative prompt saved with each local render.
- [x] Shared prompt tools: `src/lib/promptTools.ts` (magic wand + random), `src/components/PromptTools.tsx`, `src/lib/ideas.ts` (Launchpad ideas, default negatives).
- [x] Creative Canvas: wand/random on prompt and negative, viewer in gallery, listen to "use prompt" events.
- [x] Workflow: Negative prompt node in every template, wand/random on Prompt nodes, negative input on image/video/edit/inpaint.
- [x] Launchpad: ComfyUI-style idea gallery by category (covers come from your own renders).
- [x] New models for sd.cpp (engine build already supports them): FLUX.3 Image Klein, FLUX.2 klein 9B, Krea 2 Turbo, Mage-Flow Turbo / Edit, Qwen Image Edit 2511, LTX-2.3, Qwen3-VL 4B. Not possible with the current engines: Hunyuan3D, ACE-Step, Stable Audio, SAM3, SeedVR2, RIFE, pose/depth tools.
- [x] Translations, build, screenshots, release 0.1.28-2.

## Creator Studio — downloads (requested 2026-10-28)
Let the user download everything created in Creator Studio, not only skills:
- [x] Skills: Export ZIP already exists (SKILL.md + support files + evals/tests.yaml).
- [x] Agents: download as a portable ZIP (AGENT.md with role/instructions/starters + the skills it uses) and as JSON for re-import.
- [x] Multi-agent teams: ZIP with TEAM.md (mode, members, synthesizer) + each member's AGENT.md + skills used.
- [x] Harness: ZIP with HARNESS.md (allowed tools, skills, agents, context budget, compaction, web/memory policy, rules) + harness.json.
- [x] "Download" button in each editor and after "Create with AI" finishes; "Download all" for the whole tab.
- [x] Import of the same files back into Creator Studio (round trip).
