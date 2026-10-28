## Orbi 0.1.28-1

**Creator Studio: skills, agents, multi-agent teams and harnesses in one place**
- The Agent Builder and Skills menus are now one page, **Creator Studio**, with four tabs: Skills, Agents, Multi-agents and Harness.
- **Create with AI:** describe what you need and the SKILLSMITH brain builds it in seven phases (discover, design, build, test, audit, package, iterate). Choose "Ask me questions first" for up to seven questions, or "Create now".
- **Also from the chat:** type `/skill-creator`, `/agents`, `/multi-agents` or `/harness`. Text after the command starts the build right away.
- **Skills follow the Agent Skills format:** SKILL.md, support files (references/, scripts/, assets/), trigger tests and a 12-point quality audit with evidence. Export a portable ZIP for Claude, ChatGPT, Gemini and other hosts, or import a .zip or SKILL.md.
- **Skills use less context:** for models that use tools, the chat only keeps each skill's name and description and loads the full skill when it is needed.
- **Multi-agent teams:** sequential, parallel, router or debate, with a synthesizer that writes the final answer. Call a team in any chat with @its-name.
- **Harness:** choose which tools the model may use (hidden tools cannot be called), which skills and agents are on, a context budget, cutting of long tool outputs, web and memory settings, and rules for every answer.

**MCP servers work without installing Node.js**
- Filesystem, Knowledge Graph Memory, Sequential Thinking and Playwright now come with Orbi and are on by default.
- Tools that change files or act in the browser ask before running.

**More realistic Hugging Face voices (Python engine)**
- Orbi can now install a private copy of Python and PyTorch for these voices. One click; it can take 10–30 minutes.
  - **Chatterbox Multilingual** (MIT, about 5.5 GB): 23 languages including Portuguese, emotion and voice cloning.
  - **XTTS v2** (about 5 GB): 17 languages, 14 studio voices and cloning. Personal, non-commercial use only; Orbi asks you to accept the license first.
  - **Bark small** (MIT, about 4.5 GB): very expressive, with laughs and sighs.
  - **Parler-TTS Mini Multilingual** (Apache-2.0, about 5.5 GB): voices described in words.
- An NVIDIA GPU makes them much faster. Without one they still run on the processor, but slower.
- Fish Speech, ChatTTS, CosyVoice, MetaVoice, OpenVoice and MeloTTS are listed with the reason they are not installed yet.

**Translations:** Creator Studio and the new voice screens are translated into Portuguese, Spanish and French.

## Orbi 0.1.27-12 (previous)

**Voices on every operating system**
- **System voices are now read natively** on each system, so they also work in Workflows and on Linux:
  - Windows: SAPI and OneCore voices, including the ones you add in Settings → Time & language → Speech.
  - macOS: every voice of the system, including downloaded Enhanced and Premium voices.
  - Linux: eSpeak NG (130+ languages) and SVOX Pico. Orbi tells you what to install when none is present.
- **Natural AI voices** (Kokoro, Supertonic, Kitten, Pocket and Piper) run on Windows, macOS and Linux.
- Each voice shows its license. System voices use your operating system's license.

**Voice input on every operating system**
- **New: Parakeet TDT 0.6B v3** (NVIDIA, CC-BY-4.0). Fast and very accurate in 25 European languages, including Portuguese, Spanish and French, with punctuation. Works on Windows, macOS and Linux.
- **Local dictation now works on macOS and Linux**, with Whisper Tiny, Base and Large v3 Turbo.
- Each model shows its license.

## Orbi 0.1.27-11 (previous)

**Voices: choose, listen, install and remove them anywhere**
- One voice library everywhere a voice is used: Settings → Voice, Local models, the arrow next to the speaker button under each answer, and the Voice node in Workflows. In each place you can listen to every voice, choose it, install it or uninstall it.
- **New natural voices that run on your PC:**
  - **Kokoro 82M:** 41 voices in Portuguese (BR), English, Spanish, French, Italian and Hindi.
  - **Supertonic 3:** 10 voices that speak 31 languages, very fast.
  - **Kitten TTS:** tiny English voices, 27 MB.
  - **Pocket TTS:** clone a voice from a 5–10 second recording. English only, for personal non-commercial use.
- **Best voices first:** packs list their top-rated voices first and filter by your language. Installing your first natural voice makes it the default in your language.
- **Long answers start playing sooner:** the first sentence plays while the rest is being generated.
- **The most-used Hugging Face voices are listed with their license:** Fish Speech, XTTS v2, Chatterbox, Bark, ChatTTS, CosyVoice, Parler-TTS, MetaVoice, OpenVoice and MeloTTS. They need the optional Python engine, which is not included yet.

**Voice input**
- The arrow next to the microphone opens voice input anywhere: choose the model, test the microphone, install, cancel or uninstall.
- New models: Whisper Medium and Whisper Large v3.

## Orbi 0.1.27-10 (previous)

**Agents and skills, completed**
- **37 agents from GitHub** (Seth Hobson's MIT collection): Kubernetes Architect, Incident Responder, AI Engineer, Prompt Engineer, Data Engineer, Business Analyst, Accessibility Expert, Content Marketer and more. Agents now have **stars, author, license and GitHub link**, and each profession shows its top 10, the same as skills.
- **IT & Infrastructure, Journalism and Education** gained 35 skills from GitHub: incident runbooks, postmortems, connectivity triage, CI/CD, Terraform, SLOs, zero trust and IAM; desk research, interview research, research ethics and avoiding AI-sounding writing; training material and research design.
- **All of Orbi's own skills and agents were rewritten as structured playbooks** (approach, deliverables and what to avoid) and are scored with the same rules as GitHub skills. Orbi is published under Apache-2.0, so they earn the open-license star.
- Skills and agents you already installed are upgraded to the new playbooks automatically, **unless you edited them**.
- **Daniskills now has 5 stars**, since its repository now has a license.

## Orbi 0.1.27-9 (previous)

**Explore, reviewed and completed**
- **131 skills from GitHub**, each checked: the repository exists, it really contains the skill, and its license allows bundling it. Every card shows the author, license, number of reference files and a GitHub link.
- New professions: **Motion & VFX** (Remotion, HyperFrames, Lottie, animation) and **Social Media**, which has platform filters for Instagram, TikTok, YouTube, LinkedIn, Facebook, Threads and X.
- Stronger lists in every profession, including Corey Haines' marketing skills, the jtydhr88 screenwriting set, K-Dense data and research skills, OpenAI's data-visualization skills, the Superpowers developer skills, Owl-Listener's UX skills, Raven design skills and Emil Kowalski's design engineering.
- A **Daniel Rodrigues** filter shows all your own skills, marked **Own creation**. Official skills (Anthropic, OpenAI, Remotion, HeyGen) are marked **Official**.
- **No duplicates:** when two skills share a name, only the better-rated one is listed.
- Projects whose license doesn't allow bundling (OpenMontage, OpenChatCut, Video Talkcraft and others) appear as **GitHub only**, with a link.
- A **Find more on GitHub** section links to the largest skill directories.
- New agents for Motion & VFX and Social Media, and new toolkits.

## Orbi 0.1.27-8 (previous)

**Explore: the best skills per profession**
- New professions: **Data Analysis**, **Filmmaking (Videomaker)** and **Screenwriting**, each with skills, agents and a toolkit.
- Skills published on GitHub, with author and a link to the source: **Daniskills**, **Master Scene Format**, **Investigative Journalism**, **LinkedIn Profile Optimizer**, **DesignerX** and **AI Motion Director** by Daniel Rodrigues, plus Anthropic's Frontend Design and MCP Builder.
- Every skill has **1–5 stars** based on signals anyone can check in its repository: clear purpose, structured method, reference files, scripts or tests, and an open-source license. Each profession shows its top 10, best first.

**Voice**
- **Listen to and choose the default voice.** Download natural offline voices (Piper) in Portuguese, English, Spanish and French, listen to each one and set the default in Settings → Voice. It is used by the speaker button and by the Voice node in Workflows.
- Reading speed control, and a microphone test that shows what was transcribed.

**Models**
- Fixed the FLUX.2 klein download (404): Orbi now finds the right file in the repository instead of guessing its name.
- Deleting a model now also removes unfinished downloads. A new **Free unused files** button in Local models clears leftovers.
- Unfinished downloads show how much was saved and continue where they stopped.

Developed by Daniel Rodrigues · Draft Creative Studio Ltda.
