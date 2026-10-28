## Orbi 0.1.27-11

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
