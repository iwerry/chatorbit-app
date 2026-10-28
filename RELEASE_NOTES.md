## Orbi 0.1.28-5

**A message box that teaches itself**
- While the box is empty, an animated placeholder types real examples one character at a time: `Ask anything…`, `/skill-creator "…"`, `@agent init "…"`, `/image …`, `/web …`, `/video …`. Press **Tab** to use the example on screen. The examples come from your own skills and agents.
- Typing `/` or `@` opens the list with a **details panel** for the highlighted item: what it does, how to call it, its commands and its author.
- Once a skill or agent is chosen, a **command guide** appears above the box with its commands and starter prompts as chips. A faint suggestion completes the line (`@designerx init "…"`); press **Tab** to accept it.
- The hint under the box changes with what you are doing (send, new line, generate).
- **Thinking effort** is now a slider: Instant → Fast → Medium → High.

**Microphone and speaker of your choice**
- The arrow next to the mic lists every input and output the system has: the laptop mic, a USB audio interface, a headset… Plug a device in and it shows up right away. Read-aloud plays on the speaker you pick.
- Recording shows a live waveform with **Cancel**, **Stop and edit** and **Stop and send**.

**Make images and videos from the chat**
- New **Chat · Image · Video** switch in the box (also `/image` and `/video`, and the Video and Image chips on the home screen).
- Image and Video have their own controls: model picker with search, aspect ratio, duration, resolution, **Enhance prompt** (magic wand) and how many results (1–4). Attach an image to use it as the start frame.
- The render runs in the Creative queue and lands in the Media Library. The chat shows it live, with progress, then the result. From the result you can open it full screen, **make a video**, **upscale 4×**, use the prompt again or save it.

**Media Library, full page**
- Clicking Media Library in the side bar now opens a full page, like Creative > Gallery. The full-screen viewer is no longer stuck inside the side panel.
- **Search** prompts, names and models (`/` or Ctrl+F). Filter by kind (images, videos, audio, files), by origin (made in chat, made in Creative, imported) and by board.
- The viewer gains **Create from this image**: make a video, upscale 4×, or edit in the Canvas. Creative > Gallery gets the same search and actions.

**Not included yet:** the Audio and MP4/MOV options from your references. Local video is saved as WebM. Audio depends on the model, so it will come when the engine supports it.

## Orbi 0.1.28-4 (previous)

**Orbi now has a written design system**
- **PRODUCT.md** records who Orbi is for (professionals in general), what makes it different (everything in one app) and the brand commitments (Draft Creative Studio · Daniel Rodrigues).
- **DESIGN.md** records the visual language, **Adaptive Soft UI**, with the North Star "The Studio Desk" and three variants:
  - **Orbi Dark** — Premium Dark Soft UI
  - **Orbi Light** — Soft Neumorphic UI
  - **Orbi Terminal** — Cyberpunk Terminal UI
- It covers the tokens (colors per theme, type, radii, spacing, shadows, motion), the components and the rules every new screen follows.

**Creative reorganized**
- **Fixed the cause of the mess:** Creator Studio's styles were leaking into Creative, turning the tabs into big boxes hanging from the top. They are now kept separate.
- Launchpad, Canvas, Workflows and Gallery share one frame:
  - the same top bar;
  - side columns of the same width (300px);
  - the same panel headers and the same section spacing.
- **Bold, bright states:**
  - The active tab, the Image/Video switch, aspect and quality choices, the selected board and the selected image light up in Orbit Lime.
  - A running workflow node glows in its own color.
- **Generate** is the clear main action. When it is unavailable, it stays readable instead of fading out.
- Launchpad quick actions are soft tiles that light up on hover. Idea text no longer spills out of the card.
- In Portuguese, "Templates" no longer says "Modelos", so it is not confused with AI models.

## Orbi 0.1.28-3 (previous)

**Design pass with Impeccable (anti-slop)**
- The whole app was checked with Impeccable's design detector on the real screens, in light and dark: chat, temporary chat, Creative (Launchpad, Canvas, Workflows, Gallery), Creator Studio, Explore and Media Library. Every screen now passes.
- **Readable text everywhere:** labels and buttons are at least 11px, sentences at least 12px (73 styles were smaller, some as small as 7px).
- **Contrast fixed:** placeholders and secondary text meet WCAG AA in light, dark and terminal themes. Accent-colored text uses a darker ink on light backgrounds.
- **Fixed a style clash:** image and video nodes in Workflows had colored text on a colored tint. Nodes now keep their color in a tinted header instead of a 3px stripe.
- **Fewer generic patterns:**
  - The logo above the greeting no longer sits in an icon tile.
  - The decorative grid behind the welcome is gone.
  - Launchpad covers use a clean two-tone gradient.
  - Quotes and lists use 1px guides.

**Temporary chat has a ghost**
- The spy-hat icon is now a little ghost, drawn in the same stroke as the other icons. It floats gently while temporary chat is on.

**The message box ring is back and pulses**
- The rainbow ring circles the message box again, a bit faster, and pulses softly while it waits for you, to draw attention.
- When you click in to type, it holds steady. With "reduce motion" turned on in your system, it stays still.

## Orbi 0.1.28-2

**Media Library: full-screen viewer**
- Click any image or video to open it full screen. Move with ← → or the arrows, jump with the film strip, start a slideshow with Space, zoom to actual size with a click, close with Esc.
- The side panel shows the prompt, the negative prompt, model, size, steps, seed and date, with **Use prompt** and **Copy prompt**. Download, open in another app, show in folder and delete are in the top bar.
- Works in the Media Library and in Creative → Gallery and boards.

**Magic wand and Random**
- **Canvas:** under the prompt, **Improve** rewrites your prompt and writes a matching negative prompt with your chat model (local or cloud); with an empty prompt it invents one. **Random** gives an instant idea offline. **Undo** brings back the previous text.
- The negative prompt has its own wand and random buttons.
- **Workflow:** every Prompt and Negative prompt node has the same wand and random buttons.

**Negative prompt node**
- New **Negative prompt** node, ComfyUI style. Image, video, edit and inpaint nodes have a Negative input.
- Every template now comes with a Negative prompt node already connected.
- Negative texts in imported ComfyUI workflows become Negative prompt nodes.
- The negative prompt is saved with each render.

**New Launchpad**
- Ideas by category, like ComfyUI's template browser: Popular, Product & ads, Character & fashion, Brand & design, Image tools, Video and Audio, with search.
- Click an idea to open it in the Canvas with prompt, negative prompt and size, or as a ready workflow. The first image you make from an idea becomes its cover.

**New models** (each PC can use what its hardware allows)
- Image: **FLUX.3 Image Klein**, **FLUX.2 klein 9B** (non-commercial), **Krea 2 Turbo**, **Mage-Flow Turbo**.
- Image editing: **Mage-Flow Edit Turbo**, **Qwen Image Edit 2511**.
- Video: **LTX-2.3**, video with synchronized sound (needs a strong GPU).
- Text: **Qwen3.5 4B** and **Gemma 4 E4B**, both see images.
- New models carry a "New" badge in Models.

**Creator Studio: download everything you create**
- Agents, multi-agent teams and harnesses download as a ZIP. The ZIP includes the agents and skills they use, readable AGENT.md / TEAM.md / HARNESS.md files and an orbi-bundle.json.
- Download one item from the list or the editor, or **Download all** from a tab.
- **Import** brings a bundle back into Orbi.

**Two new skills and agents by Daniel Rodrigues** (in the library and the Design and Marketing kits)
- **behavioral-intelligence** + **@behavior (Behavioral Strategist)**: audience psychology, emotional intelligence and a 3-step ethical action plan.
- **prompt-enhancer** + **@prompt (Prompt Director)**: the magic wand for image, video, music, voice, text and code prompts.
- Both are full Agent Skills with references, templates and trigger tests.

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

## Orbi 0.1.27-12

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
