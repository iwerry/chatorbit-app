# Guia Técnico de Prompts por Modalidade e Ferramenta

## 1. Imagem (Midjourney, DALL-E 3, Flux.1, Stable Diffusion)
- **Estrutura Recomendada:** `[Sujeito Principal] + [Ação/Cenário] + [Estilo Artístico/Fotográfico] + [Iluminação] + [Câmera/Lente] + [Cores/Vibe] + [Parâmetros Finais]`
- **Vocabulário de Iluminação:** Rim lighting, volumetric lighting, golden hour, cinematic lighting, chiaroscuro, studio softbox, neon backlight, natural window light.
- **Vocabulário de Câmera/Lente:** 35mm photograph, 85mm portrait lens, f/1.4 aperture, depth of field, wide-angle shot, macro detail, shot on Hasselblad, grainy film texture.
- **Parâmetros Midjourney:**
  - `--ar 16:9` (Paisagem), `--ar 9:16` (Stories/Vertical), `--ar 1:1` (Quadrado)
  - `--v 6.0` ou `--v 6.1`
  - `--stylize 250` (Valores de 0 a 1000 para intensidade de estilo)
  - `--no blur, distortion, low quality` (Parâmetro negativo)

## 2. Vídeo (Runway Gen-3, Sora, Pika, Kling AI)
- **Estrutura Recomendada:** `[Movimento de Câmera] + [Sujeito e Ação] + [Ambiente/Clima] + [Velocidade/Ritmo] + [Estilo Cinematográfico]`
- **Movimentos de Câmera:** Slow pan right, FPV drone shot, slow zoom in, tracking shot following the subject, static locked shot, orbit shot, tilt down.
- **Ação & Física:** Smooth movement, hyper-realistic physics, 60fps cinematic motion, seamless loop, realistic fluid dynamics.

## 3. Áudio e Música (Suno v3.5, Udio, ElevenLabs)
- **Música (Suno/Udio):**
  - **Tags Principais:** Subgênero exato (ex.: *synthwave, indie folk, lo-fi hip hop, cinematic orchestral*), ritmo/BPM (*slow 70 bpm, energetic 128 bpm*), vocais (*raspy male vocals, ethereal female choir*), instrumentos (*acoustic guitar, 808 bass, brass section*).
- **Voz / Narração (ElevenLabs):**
  - **Tags de Direção:** `[whispering]`, `[sighs]`, `[laughs]`, `[intense tone]`, `[warm conversational voice]`.

## 4. Texto e Código (ChatGPT, Claude, Gemini)
- **Estrutura ROCI:**
  - **R (Role):** Atue como um especialista sênior em [Área].
  - **O (Objective):** Seu objetivo é [Entregável exato].
  - **C (Context & Constraints):** Considere [Contexto] e respeite as restrições [Proibições/Regras].
  - **I (Instructions & Input):** Siga os passos [1, 2, 3] utilizando a entrada fornecida.
