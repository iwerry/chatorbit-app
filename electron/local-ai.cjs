// Orbi Local model hub.
// - Detects the hardware and rates every model as ok / slow / too-heavy for this PC.
// - Downloads engines (llama.cpp, stable-diffusion.cpp, whisper.cpp) and model files only when asked.
// - Runs text through llama-server, images/videos through sd-cli and speech-to-text through whisper-cli.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const hardware = require('./hardware.cjs')

const HF = 'https://huggingface.co'
const GB = 1e9

// ---------- engines ----------
const ENGINES = {
  llama: {
    name: 'llama.cpp',
    tag: 'b11800',
    exe: { server: 'llama-server' },
    asset(gpu) {
      const t = this.tag
      const map = {
        'win32-x64': gpu ? `llama-${t}-bin-win-vulkan-x64.zip` : `llama-${t}-bin-win-cpu-x64.zip`,
        'linux-x64': gpu ? `llama-${t}-bin-ubuntu-vulkan-x64.tar.gz` : `llama-${t}-bin-ubuntu-x64.tar.gz`,
        'darwin-arm64': `llama-${t}-bin-macos-arm64.tar.gz`,
        'darwin-x64': `llama-${t}-bin-macos-x64.tar.gz`,
      }
      const a = map[`${process.platform}-${process.arch}`]
      return a && `https://github.com/ggml-org/llama.cpp/releases/download/${t}/${a}`
    },
  },
  sd: {
    name: 'stable-diffusion.cpp',
    tag: 'master-1015-e41fbcf',
    exe: { cli: 'sd-cli' },
    asset(gpu) {
      const h = 'e41fbcf'
      const map = {
        'win32-x64': gpu ? `sd-master-${h}-bin-win-vulkan-x64.zip` : `sd-master-${h}-bin-win-cpu-x64.zip`,
        'linux-x64': gpu ? `sd-master-${h}-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip` : `sd-master-${h}-bin-Linux-Ubuntu-24.04-x86_64.zip`,
      }
      const a = map[`${process.platform}-${process.arch}`]
      return a && `https://github.com/leejet/stable-diffusion.cpp/releases/download/${this.tag}/${a}`
    },
  },
  piper: {
    name: 'Piper voices',
    tag: '2023.11.14-2',
    exe: { cli: 'piper' },
    asset() {
      const a = { 'win32-x64': 'piper_windows_amd64.zip', 'linux-x64': 'piper_linux_x86_64.tar.gz', 'darwin-arm64': 'piper_macos_aarch64.tar.gz', 'darwin-x64': 'piper_macos_x64.tar.gz' }[`${process.platform}-${process.arch}`]
      return a && `https://github.com/rhasspy/piper/releases/download/${this.tag}/${a}`
    },
  },
  // sherpa-onnx: one native engine for the most natural open voices (Kokoro, Supertonic, Kitten,
  // Pocket TTS voice cloning). Shared builds are small; the Windows one has a static C runtime.
  sherpa: {
    name: 'sherpa-onnx voices',
    tag: 'v1.13.8',
    exe: { tts: 'sherpa-onnx-offline-tts', asr: 'sherpa-onnx-offline' },
    asset() {
      const t = this.tag
      const a = { 'win32-x64': 'win-x64-shared-MT-Release', 'linux-x64': 'linux-x64-shared', 'darwin-arm64': 'osx-arm64-shared', 'darwin-x64': 'osx-x64-shared' }[`${process.platform}-${process.arch}`]
      return a && `https://github.com/k2-fsa/sherpa-onnx/releases/download/${t}/sherpa-onnx-${t}-${a}.tar.bz2`
    },
  },
  // uv: installs a private Python and per-model environments for Hugging Face voices (no system Python needed).
  python: {
    name: 'Python voices (uv)',
    tag: '0.13.6',
    exe: { uv: 'uv' },
    asset() {
      const a = { 'win32-x64': 'uv-x86_64-pc-windows-msvc.zip', 'linux-x64': 'uv-x86_64-unknown-linux-gnu.tar.gz', 'darwin-arm64': 'uv-aarch64-apple-darwin.tar.gz', 'darwin-x64': 'uv-x86_64-apple-darwin.tar.gz' }[`${process.platform}-${process.arch}`]
      return a && `https://github.com/astral-sh/uv/releases/download/${this.tag}/${a}`
    },
  },
  whisper: {
    name: 'whisper.cpp',
    tag: 'v1.9.2',
    exe: { cli: 'whisper-cli' },
    asset() {
      const a = { 'win32-x64': 'whisper-bin-x64.zip' }[`${process.platform}-${process.arch}`]
      return a && `https://github.com/ggml-org/whisper.cpp/releases/download/${this.tag}/${a}`
    },
  },
}

// ---------- catalog ----------
// req: ram = GB of system memory needed; vram = GB of dedicated video memory for good speed (0 = CPU is fine).
// files: repo + file, or repo + pattern (resolved with the Hugging Face API on first download).
const CATALOG = [
  // TEXT (llama.cpp) — ordered from lightest to strongest inside each tier; the strongest one that fits is recommended.
  { id: 'smollm2-135m', kind: 'text', tier: 'light', name: 'SmolLM2 135M', license: 'Apache-2.0', size: 0.105, req: { ram: 1, vram: 0 },
    description: 'Tiny and instant. Runs on any PC — great for testing and short answers.', files: [{ role: 'model', repo: 'bartowski/SmolLM2-135M-Instruct-GGUF', file: 'SmolLM2-135M-Instruct-Q4_K_M.gguf' }] },
  { id: 'smollm2-360m', kind: 'text', tier: 'light', name: 'SmolLM2 360M', license: 'Apache-2.0', size: 0.386, req: { ram: 1.5, vram: 0 },
    description: 'Still very light, a bit smarter than 135M.', files: [{ role: 'model', repo: 'bartowski/SmolLM2-360M-Instruct-GGUF', file: 'SmolLM2-360M-Instruct-Q8_0.gguf' }] },
  { id: 'qwen2.5-0.5b', kind: 'text', tier: 'light', name: 'Qwen2.5 0.5B', license: 'Apache-2.0', size: 0.398, req: { ram: 2, vram: 0 },
    description: 'Best of the tiny models. Multilingual, decent Portuguese.', files: [{ role: 'model', repo: 'bartowski/Qwen2.5-0.5B-Instruct-GGUF', file: 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf' }] },
  { id: 'gemma3-1b', kind: 'text', tier: 'light', name: 'Gemma 3 1B', license: 'Gemma', size: 0.81, req: { ram: 2, vram: 0 },
    description: 'Google’s small model. Fast on any laptop, good at short writing tasks.', files: [{ role: 'model', repo: 'unsloth/gemma-3-1b-it-GGUF', file: 'gemma-3-1b-it-Q4_K_M.gguf' }] },
  { id: 'llama3.2-1b', kind: 'text', tier: 'light', name: 'Llama 3.2 1B', license: 'Llama 3.2 Community', size: 0.81, req: { ram: 2, vram: 0 },
    description: 'Meta’s small assistant. Quick answers and summaries.', files: [{ role: 'model', repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF', file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf' }] },
  { id: 'qwen2.5-1.5b', kind: 'text', tier: 'light', name: 'Qwen2.5 1.5B', license: 'Apache-2.0', size: 0.99, req: { ram: 3, vram: 0 },
    description: 'Good everyday assistant on a normal laptop.', files: [{ role: 'model', repo: 'bartowski/Qwen2.5-1.5B-Instruct-GGUF', file: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf' }] },
  { id: 'llama3.2-3b', kind: 'text', tier: 'medium', name: 'Llama 3.2 3B', license: 'Llama 3.2 Community', size: 2.02, req: { ram: 5, vram: 0 },
    description: 'Solid writing and reasoning for its size.', files: [{ role: 'model', repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF', file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf' }] },
  { id: 'gemma3-4b', kind: 'text', tier: 'medium', name: 'Gemma 3 4B', license: 'Gemma', size: 3.3, req: { ram: 6, vram: 0 }, vision: true,
    description: 'Strong writer with wide language coverage — and it can see images you attach.', files: [
      { role: 'model', repo: 'unsloth/gemma-3-4b-it-GGUF', file: 'gemma-3-4b-it-Q4_K_M.gguf' },
      { role: 'mmproj', repo: 'unsloth/gemma-3-4b-it-GGUF', pattern: '^mmproj[^/]*\\.gguf$', optional: true },
    ] },
  { id: 'qwen3-vl-4b', kind: 'text', tier: 'medium', name: 'Qwen3-VL 4B', license: 'Apache-2.0', size: 3.3, req: { ram: 6, vram: 0 }, vision: true,
    description: 'Sees images: reads screenshots, documents and photos, and describes or answers about them.', files: [
      { role: 'model', repo: 'Qwen/Qwen3-VL-4B-Instruct-GGUF', pattern: 'Q4_K_M\\.gguf$' },
      { role: 'mmproj', repo: 'Qwen/Qwen3-VL-4B-Instruct-GGUF', pattern: '^mmproj[^/]*F16[^/]*\\.gguf$|^mmproj[^/]*\\.gguf$', optional: true },
    ] },
  { id: 'qwen3-4b', kind: 'text', tier: 'medium', name: 'Qwen3 4B Instruct', license: 'Apache-2.0', size: 2.5, req: { ram: 6, vram: 0 },
    description: 'The best small all-rounder: reasoning, code, tools and Portuguese. Fast with any GPU.', files: [{ role: 'model', repo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF', file: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf' }] },
  { id: 'qwen3.5-4b', kind: 'text', tier: 'medium', isNew: true, name: 'Qwen3.5 4B', license: 'Apache-2.0', size: 2.74, req: { ram: 6, vram: 0 }, vision: true,
    description: 'Newest small Qwen: strong reasoning and Portuguese, and it sees images.', files: [
      { role: 'model', repo: 'unsloth/Qwen3.5-4B-GGUF', pattern: 'Q4_K_M\\.gguf$' },
      { role: 'mmproj', repo: 'unsloth/Qwen3.5-4B-GGUF', pattern: '^mmproj[^/]*F16[^/]*\\.gguf$|^mmproj[^/]*\\.gguf$', optional: true },
    ] },
  { id: 'gemma4-e4b', kind: 'text', tier: 'medium', isNew: true, name: 'Gemma 4 E4B', license: 'Gemma', size: 5.0, req: { ram: 8, vram: 0 }, vision: true,
    description: 'Google’s Gemma 4 for laptops: natural writing in many languages, and it sees images.', files: [
      { role: 'model', repo: 'unsloth/gemma-4-e4b-it-GGUF', pattern: 'Q4_K_M\\.gguf$' },
      { role: 'mmproj', repo: 'unsloth/gemma-4-e4b-it-GGUF', pattern: '^mmproj[^/]*F16[^/]*\\.gguf$|^mmproj[^/]*\\.gguf$', optional: true },
    ] },
  { id: 'qwen2.5-7b', kind: 'text', tier: 'heavy', name: 'Qwen2.5 7B', license: 'Apache-2.0', size: 4.68, req: { ram: 10, vram: 6 },
    description: 'Strong local model. Best with a GPU (6 GB+) or 16 GB RAM.', files: [{ role: 'model', repo: 'bartowski/Qwen2.5-7B-Instruct-GGUF', file: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf' }] },
  { id: 'qwen3-8b', kind: 'text', tier: 'heavy', name: 'Qwen3 8B', license: 'Apache-2.0', size: 5.03, req: { ram: 10, vram: 6 },
    description: 'Thinks before answering. Excellent reasoning and code on a 6–8 GB GPU.', files: [{ role: 'model', repo: 'unsloth/Qwen3-8B-GGUF', file: 'Qwen3-8B-Q4_K_M.gguf' }] },
  { id: 'gemma3-12b', kind: 'text', tier: 'heavy', name: 'Gemma 3 12B', license: 'Gemma', size: 8.2, req: { ram: 16, vram: 10 }, vision: true,
    description: 'Near cloud-level writing, and it sees images. Needs a strong GPU or 16 GB+ RAM.', files: [
      { role: 'model', repo: 'unsloth/gemma-3-12b-it-GGUF', file: 'gemma-3-12b-it-Q4_K_M.gguf' },
      { role: 'mmproj', repo: 'unsloth/gemma-3-12b-it-GGUF', pattern: '^mmproj[^/]*\\.gguf$', optional: true },
    ] },

  // SPEECH TO TEXT (whisper.cpp)
  { id: 'whisper-tiny', kind: 'stt', tier: 'light', name: 'Whisper Tiny', license: 'MIT', size: 0.075, req: { ram: 1, vram: 0 },
    description: 'Fast dictation on any PC. Multilingual.', files: [{ role: 'model', repo: 'ggerganov/whisper.cpp', file: 'ggml-tiny.bin' }] },
  { id: 'whisper-base', kind: 'stt', tier: 'light', name: 'Whisper Base', license: 'MIT', size: 0.142, req: { ram: 1, vram: 0 },
    description: 'Better accuracy, still fast.', files: [{ role: 'model', repo: 'ggerganov/whisper.cpp', file: 'ggml-base.bin' }] },
  { id: 'whisper-small', kind: 'stt', tier: 'medium', name: 'Whisper Small', license: 'MIT', size: 0.466, req: { ram: 2, vram: 0 },
    description: 'Good accuracy in Portuguese and other languages.', files: [{ role: 'model', repo: 'ggerganov/whisper.cpp', file: 'ggml-small.bin' }] },
  { id: 'whisper-turbo', kind: 'stt', tier: 'heavy', name: 'Whisper Large v3 Turbo', license: 'MIT', size: 0.547, req: { ram: 4, vram: 0 },
    description: 'Best accuracy. Needs a decent CPU or a GPU.', files: [{ role: 'model', repo: 'ggerganov/whisper.cpp', file: 'ggml-large-v3-turbo-q5_0.bin' }] },
  { id: 'whisper-medium', kind: 'stt', tier: 'medium', name: 'Whisper Medium', license: 'MIT', size: 0.539, req: { ram: 3, vram: 0 },
    description: 'Very good accuracy for accents and noisy audio. Slower than Turbo.', files: [{ role: 'model', repo: 'ggerganov/whisper.cpp', file: 'ggml-medium-q5_0.bin' }] },
  { id: 'whisper-large-v3', kind: 'stt', tier: 'heavy', name: 'Whisper Large v3', license: 'MIT', size: 1.08, req: { ram: 5, vram: 0 },
    description: 'The most accurate Whisper. Best for long recordings and interviews; slow without a GPU.', files: [{ role: 'model', repo: 'ggerganov/whisper.cpp', file: 'ggml-large-v3-q5_0.bin' }] },
  // Speech to text on every system (sherpa-onnx). Parakeet v3 is very accurate in 25 European languages.
  { id: 'stt-parakeet-v3', kind: 'stt', engine: 'sherpa', family: 'parakeet', tier: 'medium', name: 'Parakeet TDT 0.6B v3', license: 'CC-BY-4.0', size: 0.487, req: { ram: 3, vram: 0 },
    description: 'NVIDIA’s fast, very accurate model for 25 European languages, including Portuguese, Spanish and French. Adds punctuation.',
    files: [{ role: 'pack', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2', file: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8' }] },
  { id: 'stt-whisper-tiny-onnx', kind: 'stt', engine: 'sherpa', family: 'whisper', size_name: 'tiny', platforms: ['linux', 'darwin'], tier: 'light', name: 'Whisper Tiny', license: 'MIT', size: 0.116, req: { ram: 1, vram: 0 },
    description: 'Fast dictation on any computer. Multilingual.',
    files: [{ role: 'pack', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2', file: 'sherpa-onnx-whisper-tiny' }] },
  { id: 'stt-whisper-base-onnx', kind: 'stt', engine: 'sherpa', family: 'whisper', size_name: 'base', platforms: ['linux', 'darwin'], tier: 'light', name: 'Whisper Base', license: 'MIT', size: 0.208, req: { ram: 1, vram: 0 },
    description: 'Better accuracy, still fast. Multilingual.',
    files: [{ role: 'pack', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2', file: 'sherpa-onnx-whisper-base' }] },
  { id: 'stt-whisper-turbo-onnx', kind: 'stt', engine: 'sherpa', family: 'whisper', size_name: 'turbo', platforms: ['linux', 'darwin'], tier: 'heavy', name: 'Whisper Large v3 Turbo', license: 'MIT', size: 0.564, req: { ram: 4, vram: 0 },
    description: 'Best Whisper accuracy in 99 languages. Needs a decent CPU.',
    files: [{ role: 'pack', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-turbo.tar.bz2', file: 'sherpa-onnx-whisper-turbo' }] },

  // IMAGE (stable-diffusion.cpp)
  { id: 'sdxs-512', kind: 'image', tier: 'light', name: 'SDXS 512', license: 'see model card', size: 1.2, req: { ram: 3, vram: 0 },
    description: 'Instant 512×512 sketches in one step — runs on any CPU. Good for ideas and thumbnails.', files: [{ role: 'model', repo: 'akleine/sdxs-512', pattern: '^[^/]+\\.(safetensors|gguf)$' }],
    args: { model: '-m', extra: ['--steps', '1', '--cfg-scale', '1'], width: 512, height: 512, fixedSteps: true, presets: [1, 1, 1] } },
  { id: 'z-image-turbo', kind: 'image', tier: 'medium', name: 'Z-Image Turbo', license: 'Apache-2.0', size: 5.8, req: { ram: 8, vram: 4 },
    description: 'Photorealistic images and readable text in 8 steps. Runs on 4 GB GPUs.', files: [
      { role: 'diffusion', repo: 'leejet/Z-Image-Turbo-GGUF', file: 'z_image_turbo-Q3_K.gguf', pattern: 'Q3_K\\.gguf$' },
      { role: 'llm', repo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF', file: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf' },
      { role: 'vae', repo: 'Green-Sky/flux.1-schnell-GGUF', file: 'ae-f16.gguf' },
    ], args: { diffusion: '--diffusion-model', llm: '--llm', vae: '--vae', extra: ['--cfg-scale', '1', '--steps', '8', '--offload-to-cpu', '--diffusion-fa', '--vae-tiling'], width: 768, height: 768, presets: [6, 8, 12] } },
  { id: 'flux2-klein-4b', kind: 'image', tier: 'medium', name: 'FLUX.2 klein 4B', license: 'Apache-2.0', size: 5.3, req: { ram: 8, vram: 4 },
    description: 'Newest FLUX: sharp detail, great prompt following and image editing in 4 steps.', files: [
      { role: 'diffusion', repo: 'leejet/FLUX.2-klein-4B-GGUF', pattern: 'q4_0[^/]*\\.gguf$' },
      { role: 'llm', repo: 'unsloth/Qwen3-4B-GGUF', file: 'Qwen3-4B-Q4_K_M.gguf' },
      { role: 'vae', repo: 'Comfy-Org/flux2-dev', file: 'split_files/vae/flux2-vae.safetensors' },
    ], args: { diffusion: '--diffusion-model', llm: '--llm', vae: '--vae', extra: ['--cfg-scale', '1', '--steps', '4', '--sampling-method', 'euler', '--offload-to-cpu', '--diffusion-fa', '--vae-tiling'], width: 1024, height: 1024, presets: [4, 6, 8], ref: true } },
  { id: 'flux-schnell', kind: 'image', tier: 'heavy', name: 'FLUX.1 schnell', license: 'Apache-2.0', size: 9.7, req: { ram: 12, vram: 8 },
    description: 'Excellent prompt following and detail. 4 steps.', files: [
      { role: 'diffusion', repo: 'Green-Sky/flux.1-schnell-GGUF', file: 'flux1-schnell-q4_k.gguf' },
      { role: 'vae', repo: 'Green-Sky/flux.1-schnell-GGUF', file: 'ae-f16.gguf' },
      { role: 'clip_l', repo: 'Green-Sky/flux.1-schnell-GGUF', file: 'clip_l-q8_0.gguf' },
      { role: 't5xxl', repo: 'Green-Sky/flux.1-schnell-GGUF', file: 't5xxl_q4_k.gguf' },
    ], args: { diffusion: '--diffusion-model', vae: '--vae', clip_l: '--clip_l', t5xxl: '--t5xxl', extra: ['--cfg-scale', '1', '--steps', '4', '--sampling-method', 'euler', '--offload-to-cpu', '--vae-tiling'], width: 1024, height: 1024, presets: [4, 6, 8] } },

  // New in 0.1.28-2 (stable-diffusion.cpp master-1015 supports them; first runs on real hardware may need tuning).
  { id: 'flux3-klein', kind: 'image', tier: 'medium', isNew: true, name: 'FLUX.3 Image Klein', license: 'FLUX Kommunity (free under $5M revenue)', size: 6.0, req: { ram: 12, vram: 8 },
    description: 'Black Forest Labs’ newest open model (5.6B): sharp photos, readable text and editing with up to 10 reference images. 16 steps.', files: [
      { role: 'diffusion', repo: 'leejet/flux-3-image-klein-GGUF', pattern: '(q4_0|q4_k)[^/]*\\.gguf$' },
      { role: 'llm', repo: 'Qwen/Qwen3-VL-4B-Instruct-GGUF', pattern: 'Q4_K_M\\.gguf$' },
      { role: 'vae', repo: 'Comfy-Org/flux2-dev', file: 'split_files/vae/flux2-vae.safetensors' },
    ], args: { diffusion: '--diffusion-model', llm: '--llm', vae: '--vae', extra: ['--cfg-scale', '1', '--steps', '16', '--sampling-method', 'euler', '--offload-to-cpu', '--diffusion-fa', '--vae-tiling'], width: 1024, height: 1024, presets: [12, 16, 24], ref: true } },
  { id: 'flux2-klein-9b', kind: 'image', tier: 'heavy', isNew: true, name: 'FLUX.2 klein 9B', license: 'FLUX Non-Commercial', nonCommercial: true, size: 10.6, req: { ram: 16, vram: 10 },
    description: 'The bigger klein: more detail and better hands than 4B, image editing in 4 steps. Personal, non-commercial use.', files: [
      { role: 'diffusion', repo: 'leejet/FLUX.2-klein-9B-GGUF', pattern: 'q4_0[^/]*\\.gguf$' },
      { role: 'llm', repo: 'unsloth/Qwen3-8B-GGUF', file: 'Qwen3-8B-Q4_K_M.gguf' },
      { role: 'vae', repo: 'Comfy-Org/flux2-dev', file: 'split_files/vae/flux2-vae.safetensors' },
    ], args: { diffusion: '--diffusion-model', llm: '--llm', vae: '--vae', extra: ['--cfg-scale', '1', '--steps', '4', '--sampling-method', 'euler', '--offload-to-cpu', '--diffusion-fa', '--vae-tiling'], width: 1024, height: 1024, presets: [4, 6, 8], ref: true } },
  { id: 'krea2-turbo', kind: 'image', tier: 'heavy', isNew: true, name: 'Krea 2 Turbo', license: 'Krea 2 Community', size: 10.3, req: { ram: 16, vram: 10 },
    description: 'Krea’s 12B model, distilled to 8 steps: rich color, strong aesthetics and natural photos.', files: [
      { role: 'diffusion', repo: 'Abiray/Krea-2-Turbo-GGUF', file: 'Krea-2-Turbo-Q4_K_M.gguf' },
      { role: 'llm', repo: 'Qwen/Qwen3-VL-4B-Instruct-GGUF', pattern: 'Q4_K_M\\.gguf$' },
      { role: 'vae', repo: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged', file: 'split_files/vae/wan_2.1_vae.safetensors' },
    ], args: { diffusion: '--diffusion-model', llm: '--llm', vae: '--vae', extra: ['--cfg-scale', '1', '--steps', '8', '--sampling-method', 'euler', '--offload-to-cpu', '--diffusion-fa', '--vae-tiling'], width: 1024, height: 1024, presets: [6, 8, 12] } },
  { id: 'mage-flow-turbo', kind: 'image', tier: 'heavy', isNew: true, name: 'Mage-Flow Turbo', license: 'see model card', size: 10.8, req: { ram: 16, vram: 8 },
    description: 'Microsoft’s 4B native-resolution model in 4 steps, from 512 to 2048 px.', files: [
      { role: 'diffusion', repo: 'Comfy-Org/Mage-Flow', pattern: 'diffusion_models/(?![^/]*edit)[^/]*turbo[^/]*\\.safetensors$' },
      { role: 'llm', repo: 'Qwen/Qwen3-VL-4B-Instruct-GGUF', pattern: 'Q4_K_M\\.gguf$' },
      { role: 'vae', repo: 'Comfy-Org/Mage-Flow', pattern: '^vae/[^/]*\\.safetensors$' },
    ], args: { diffusion: '--diffusion-model', llm: '--llm', vae: '--vae', extra: ['--cfg-scale', '1', '--steps', '4', '--sampling-method', 'euler', '--offload-to-cpu', '--diffusion-fa', '--vae-tiling'], width: 1024, height: 1024, presets: [4, 6, 8] } },
  { id: 'mage-flow-edit-turbo', kind: 'image', tier: 'heavy', isNew: true, name: 'Mage-Flow Edit Turbo', license: 'see model card', size: 11.6, req: { ram: 16, vram: 8 },
    description: 'Edit images with words in 4 steps (Edit image node). Keeps the parts you do not mention.', files: [
      { role: 'diffusion', repo: 'Comfy-Org/Mage-Flow', pattern: 'diffusion_models/[^/]*edit[^/]*turbo[^/]*\\.safetensors$' },
      { role: 'llm', repo: 'Qwen/Qwen3-VL-4B-Instruct-GGUF', pattern: 'Q4_K_M\\.gguf$' },
      { role: 'llm_vision', repo: 'Qwen/Qwen3-VL-4B-Instruct-GGUF', pattern: '^mmproj[^/]*\\.gguf$' },
      { role: 'vae', repo: 'Comfy-Org/Mage-Flow', pattern: '^vae/[^/]*\\.safetensors$' },
    ], args: { diffusion: '--diffusion-model', llm: '--llm', llm_vision: '--llm_vision', vae: '--vae', extra: ['--cfg-scale', '1', '--steps', '4', '--sampling-method', 'euler', '--offload-to-cpu', '--diffusion-fa', '--vae-tiling'], width: 1024, height: 1024, presets: [4, 6, 8], ref: true } },
  { id: 'qwen-image-edit-2511', kind: 'image', tier: 'heavy', isNew: true, name: 'Qwen Image Edit 2511', license: 'Apache-2.0', size: 19, req: { ram: 24, vram: 12 },
    description: 'Precise edits with words: change text, swap objects, keep faces consistent. Big and slow — for strong GPUs.', files: [
      { role: 'diffusion', repo: 'unsloth/Qwen-Image-Edit-2511-GGUF', pattern: 'Q4_K_M\\.gguf$' },
      { role: 'llm', repo: 'mradermacher/Qwen2.5-VL-7B-Instruct-GGUF', pattern: 'Q4_K_M\\.gguf$' },
      { role: 'llm_vision', repo: 'mradermacher/Qwen2.5-VL-7B-Instruct-GGUF', pattern: 'mmproj[^/]*\\.gguf$' },
      { role: 'vae', repo: 'Comfy-Org/Qwen-Image_ComfyUI', file: 'split_files/vae/qwen_image_vae.safetensors' },
    ], args: { diffusion: '--diffusion-model', llm: '--llm', llm_vision: '--llm_vision', vae: '--vae', extra: ['--cfg-scale', '2.5', '--steps', '20', '--sampling-method', 'euler', '--flow-shift', '3', '--model-args', 'qwen_image_zero_cond_t=true', '--offload-to-cpu', '--diffusion-fa', '--vae-tiling'], width: 1024, height: 1024, presets: [12, 20, 30], ref: true } },

  // VIDEO (stable-diffusion.cpp, Wan)
  { id: 'wan2.1-1.3b', kind: 'video', tier: 'light', name: 'Wan 2.1 1.3B', license: 'Apache-2.0', size: 6.2, req: { ram: 8, vram: 4 },
    description: '480p text-to-video clips of ~2 s. Made for 4 GB GPUs — on CPU it takes many minutes.', files: [
      { role: 'diffusion', repo: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged', file: 'split_files/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors' },
      { role: 'vae', repo: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged', file: 'split_files/vae/wan_2.1_vae.safetensors' },
      { role: 't5xxl', repo: 'city96/umt5-xxl-encoder-gguf', file: 'umt5-xxl-encoder-Q3_K_M.gguf' },
    ], args: { mode: 'vid_gen', diffusion: '--diffusion-model', vae: '--vae', t5xxl: '--t5xxl', extra: ['--cfg-scale', '6.0', '--sampling-method', 'euler', '--diffusion-fa', '--video-frames', '33', '--flow-shift', '3.0', '--offload-to-cpu', '--vae-tiling'], width: 832, height: 480, presets: [12, 20, 30], fps: 16 } },
  { id: 'wan2.2-5b-q3', kind: 'video', tier: 'medium', name: 'Wan 2.2 TI2V 5B (Q3)', license: 'Apache-2.0', size: 7.0, req: { ram: 12, vram: 6 },
    description: 'Text or image to video, better motion. Best with 6–8 GB VRAM.', files: [
      { role: 'diffusion', repo: 'QuantStack/Wan2.2-TI2V-5B-GGUF', file: 'Wan2.2-TI2V-5B-Q3_K_M.gguf' },
      { role: 'vae', repo: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged', file: 'split_files/vae/wan2.2_vae.safetensors' },
      { role: 't5xxl', repo: 'city96/umt5-xxl-encoder-gguf', file: 'umt5-xxl-encoder-Q3_K_M.gguf' },
    ], args: { mode: 'vid_gen', diffusion: '--diffusion-model', vae: '--vae', t5xxl: '--t5xxl', extra: ['--cfg-scale', '6.0', '--sampling-method', 'euler', '--diffusion-fa', '--video-frames', '33', '--flow-shift', '3.0', '--offload-to-cpu', '--vae-tiling'], width: 704, height: 480, presets: [12, 20, 30], fps: 24, image: true, end: true } },
  { id: 'wan2.2-5b-q4', kind: 'video', tier: 'heavy', name: 'Wan 2.2 TI2V 5B (Q4)', license: 'Apache-2.0', size: 8.5, req: { ram: 16, vram: 8 },
    description: 'Best local video quality here. 8 GB+ VRAM recommended.', files: [
      { role: 'diffusion', repo: 'QuantStack/Wan2.2-TI2V-5B-GGUF', file: 'Wan2.2-TI2V-5B-Q4_K_M.gguf' },
      { role: 'vae', repo: 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged', file: 'split_files/vae/wan2.2_vae.safetensors' },
      { role: 't5xxl', repo: 'city96/umt5-xxl-encoder-gguf', file: 'umt5-xxl-encoder-Q4_K_M.gguf' },
    ], args: { mode: 'vid_gen', diffusion: '--diffusion-model', vae: '--vae', t5xxl: '--t5xxl', extra: ['--cfg-scale', '6.0', '--sampling-method', 'euler', '--diffusion-fa', '--video-frames', '49', '--flow-shift', '3.0', '--offload-to-cpu', '--vae-tiling'], width: 1280, height: 704, presets: [12, 20, 30], fps: 24, image: true, end: true } },

  { id: 'ltx2.3', kind: 'video', tier: 'heavy', isNew: true, name: 'LTX-2.3 (video + sound)', license: 'LTX-2 Community', size: 22, req: { ram: 32, vram: 16 },
    description: 'Lightricks’ 22B model: video with synchronized sound from text or a first frame. Needs a strong GPU.', files: [
      { role: 'diffusion', repo: 'unsloth/LTX-2.3-GGUF', pattern: 'dev[^/]*Q4_K_M\\.gguf$' },
      { role: 'llm', repo: 'unsloth/gemma-3-12b-it-GGUF', file: 'gemma-3-12b-it-Q4_K_M.gguf' },
      { role: 'connectors', repo: 'unsloth/LTX-2.3-GGUF', pattern: 'text_encoders/[^/]*connectors[^/]*\\.safetensors$' },
      { role: 'vae', repo: 'unsloth/LTX-2.3-GGUF', pattern: 'vae/[^/]*video_vae[^/]*\\.safetensors$' },
      { role: 'audio_vae', repo: 'unsloth/LTX-2.3-GGUF', pattern: 'vae/[^/]*audio_vae[^/]*\\.safetensors$' },
    ], args: { mode: 'vid_gen', diffusion: '--diffusion-model', llm: '--llm', connectors: '--embeddings-connectors', vae: '--vae', audio_vae: '--audio-vae', extra: ['--cfg-scale', '6.0', '--sampling-method', 'euler', '--video-frames', '33', '--offload-to-cpu', '--diffusion-fa', '--vae-tiling'], width: 768, height: 512, presets: [20, 30, 40], fps: 24, image: true, frameStep: 8 } },

  // VOICES (Piper text-to-speech, offline)
  { id: 'tts-pt_BR-faber-medium', kind: 'tts', tier: 'light', name: 'Faber · Português (BR)', lang: 'pt-BR', license: 'see voice card', size: 0.063, req: { ram: 1, vram: 0 },
    description: 'Natural male voice in Brazilian Portuguese.', files: [{ role: 'model', repo: 'rhasspy/piper-voices', file: 'pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx' }, { role: 'config', repo: 'rhasspy/piper-voices', file: 'pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx.json' }] },
  { id: 'tts-pt_BR-edresson-low', kind: 'tts', tier: 'light', name: 'Edresson · Português (BR)', lang: 'pt-BR', license: 'see voice card', size: 0.028, req: { ram: 1, vram: 0 },
    description: 'Lighter Brazilian Portuguese male voice. Very fast.', files: [{ role: 'model', repo: 'rhasspy/piper-voices', file: 'pt/pt_BR/edresson/low/pt_BR-edresson-low.onnx' }, { role: 'config', repo: 'rhasspy/piper-voices', file: 'pt/pt_BR/edresson/low/pt_BR-edresson-low.onnx.json' }] },
  { id: 'tts-en_US-lessac-medium', kind: 'tts', tier: 'light', name: 'Lessac · English (US)', lang: 'en', license: 'see voice card', size: 0.063, req: { ram: 1, vram: 0 },
    description: 'Clear, neutral American English voice.', files: [{ role: 'model', repo: 'rhasspy/piper-voices', file: 'en/en_US/lessac/medium/en_US-lessac-medium.onnx' }, { role: 'config', repo: 'rhasspy/piper-voices', file: 'en/en_US/lessac/medium/en_US-lessac-medium.onnx.json' }] },
  { id: 'tts-en_US-amy-medium', kind: 'tts', tier: 'light', name: 'Amy · English (US)', lang: 'en', license: 'see voice card', size: 0.063, req: { ram: 1, vram: 0 },
    description: 'Warm American English female voice.', files: [{ role: 'model', repo: 'rhasspy/piper-voices', file: 'en/en_US/amy/medium/en_US-amy-medium.onnx' }, { role: 'config', repo: 'rhasspy/piper-voices', file: 'en/en_US/amy/medium/en_US-amy-medium.onnx.json' }] },
  { id: 'tts-en_US-ryan-high', kind: 'tts', tier: 'light', name: 'Ryan · English (US)', lang: 'en', license: 'see voice card', size: 0.12, req: { ram: 1, vram: 0 },
    description: 'High-quality American English male voice.', files: [{ role: 'model', repo: 'rhasspy/piper-voices', file: 'en/en_US/ryan/high/en_US-ryan-high.onnx' }, { role: 'config', repo: 'rhasspy/piper-voices', file: 'en/en_US/ryan/high/en_US-ryan-high.onnx.json' }] },
  { id: 'tts-en_GB-alba-medium', kind: 'tts', tier: 'light', name: 'Alba · English (UK)', lang: 'en', license: 'see voice card', size: 0.063, req: { ram: 1, vram: 0 },
    description: 'British English female voice.', files: [{ role: 'model', repo: 'rhasspy/piper-voices', file: 'en/en_GB/alba/medium/en_GB-alba-medium.onnx' }, { role: 'config', repo: 'rhasspy/piper-voices', file: 'en/en_GB/alba/medium/en_GB-alba-medium.onnx.json' }] },
  { id: 'tts-es_ES-davefx-medium', kind: 'tts', tier: 'light', name: 'Davefx · Español (ES)', lang: 'es', license: 'see voice card', size: 0.063, req: { ram: 1, vram: 0 },
    description: 'Spanish (Spain) male voice.', files: [{ role: 'model', repo: 'rhasspy/piper-voices', file: 'es/es_ES/davefx/medium/es_ES-davefx-medium.onnx' }, { role: 'config', repo: 'rhasspy/piper-voices', file: 'es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json' }] },
  { id: 'tts-es_MX-ald-medium', kind: 'tts', tier: 'light', name: 'Ald · Español (MX)', lang: 'es', license: 'see voice card', size: 0.063, req: { ram: 1, vram: 0 },
    description: 'Mexican Spanish male voice.', files: [{ role: 'model', repo: 'rhasspy/piper-voices', file: 'es/es_MX/ald/medium/es_MX-ald-medium.onnx' }, { role: 'config', repo: 'rhasspy/piper-voices', file: 'es/es_MX/ald/medium/es_MX-ald-medium.onnx.json' }] },
  { id: 'tts-fr_FR-siwis-medium', kind: 'tts', tier: 'light', name: 'Siwis · Français', lang: 'fr', license: 'see voice card', size: 0.063, req: { ram: 1, vram: 0 },
    description: 'French female voice.', files: [{ role: 'model', repo: 'rhasspy/piper-voices', file: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx' }, { role: 'config', repo: 'rhasspy/piper-voices', file: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json' }] },

  // NATURAL VOICES (sherpa-onnx). Packs hold several voices; pick one by id (speaker).
  { id: 'tts-kokoro', kind: 'tts', engine: 'sherpa', family: 'kokoro', tier: 'medium', name: 'Kokoro 82M', lang: 'multi', license: 'Apache-2.0', size: 0.132, req: { ram: 2, vram: 0 },
    langs: ['pt-BR', 'en-US', 'en-GB', 'es', 'fr', 'it', 'hi'],
    description: 'The most natural open voice of its size. 41 voices in Portuguese (BR), English, Spanish, French, Italian and Hindi.',
    files: [{ role: 'pack', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2', file: 'kokoro-int8-multi-lang-v1_0' }],
    voices: [
      { id: 0, name: 'Alloy', lang: 'en-US', gender: 'f' },
      { id: 1, name: 'Aoede', lang: 'en-US', gender: 'f' },
      { id: 2, name: 'Bella', lang: 'en-US', gender: 'f', top: true },
      { id: 3, name: 'Heart', lang: 'en-US', gender: 'f', top: true },
      { id: 4, name: 'Jessica', lang: 'en-US', gender: 'f' },
      { id: 5, name: 'Kore', lang: 'en-US', gender: 'f' },
      { id: 6, name: 'Nicole', lang: 'en-US', gender: 'f' },
      { id: 7, name: 'Nova', lang: 'en-US', gender: 'f' },
      { id: 8, name: 'River', lang: 'en-US', gender: 'f' },
      { id: 9, name: 'Sarah', lang: 'en-US', gender: 'f' },
      { id: 10, name: 'Sky', lang: 'en-US', gender: 'f' },
      { id: 11, name: 'Adam', lang: 'en-US', gender: 'm' },
      { id: 12, name: 'Echo', lang: 'en-US', gender: 'm' },
      { id: 13, name: 'Eric', lang: 'en-US', gender: 'm' },
      { id: 14, name: 'Fenrir', lang: 'en-US', gender: 'm' },
      { id: 15, name: 'Liam', lang: 'en-US', gender: 'm' },
      { id: 16, name: 'Michael', lang: 'en-US', gender: 'm', top: true },
      { id: 17, name: 'Onyx', lang: 'en-US', gender: 'm' },
      { id: 18, name: 'Puck', lang: 'en-US', gender: 'm' },
      { id: 19, name: 'Santa', lang: 'en-US', gender: 'm' },
      { id: 20, name: 'Alice', lang: 'en-GB', gender: 'f' },
      { id: 21, name: 'Emma', lang: 'en-GB', gender: 'f', top: true },
      { id: 22, name: 'Isabella', lang: 'en-GB', gender: 'f' },
      { id: 23, name: 'Lily', lang: 'en-GB', gender: 'f' },
      { id: 24, name: 'Daniel', lang: 'en-GB', gender: 'm' },
      { id: 25, name: 'Fable', lang: 'en-GB', gender: 'm' },
      { id: 26, name: 'George', lang: 'en-GB', gender: 'm' },
      { id: 27, name: 'Lewis', lang: 'en-GB', gender: 'm' },
      { id: 28, name: 'Dora', lang: 'es', gender: 'f', top: true },
      { id: 29, name: 'Alex', lang: 'es', gender: 'm' },
      { id: 30, name: 'Siwis', lang: 'fr', gender: 'f', top: true },
      { id: 31, name: 'Alpha', lang: 'hi', gender: 'f' },
      { id: 32, name: 'Beta', lang: 'hi', gender: 'f' },
      { id: 33, name: 'Omega', lang: 'hi', gender: 'm' },
      { id: 34, name: 'Psi', lang: 'hi', gender: 'm' },
      { id: 35, name: 'Sara', lang: 'it', gender: 'f', top: true },
      { id: 36, name: 'Nicola', lang: 'it', gender: 'm' },
      { id: 42, name: 'Dora', lang: 'pt-BR', gender: 'f', top: true },
      { id: 43, name: 'Alex', lang: 'pt-BR', gender: 'm', top: true },
      { id: 44, name: 'Santa', lang: 'pt-BR', gender: 'm' },
      { id: 53, name: 'Santa', lang: 'es', gender: 'm' },
    ] },
  { id: 'tts-supertonic', kind: 'tts', engine: 'sherpa', family: 'supertonic', tier: 'light', name: 'Supertonic 3', lang: 'multi', license: 'OpenRAIL-M', size: 0.129, req: { ram: 1.5, vram: 0 },
    langs: ['pt', 'en', 'es', 'fr', 'it', 'de', 'nl', 'pl', 'ru', 'tr', 'uk', 'ja', 'ko', 'hi', 'ar', 'vi', 'id', 'sv', 'da', 'fi', 'cs', 'ro', 'hu', 'el', 'bg', 'hr', 'sk', 'sl', 'lt', 'lv', 'et'],
    description: 'Very fast and clear, 31 languages. 10 voices that speak any of them.',
    files: [{ role: 'pack', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2', file: 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11' }],
    voices: ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'].map((n, i) => ({ id: i, name: n, lang: 'multi', gender: n[0] === 'F' ? 'f' : 'm', top: n === 'F1' || n === 'M1' })) },
  { id: 'tts-kitten', kind: 'tts', engine: 'sherpa', family: 'kitten', tier: 'light', name: 'Kitten TTS Nano', lang: 'en', license: 'Apache-2.0', size: 0.027, req: { ram: 1, vram: 0 },
    langs: ['en-US'],
    description: 'Tiny (27 MB) expressive English voices that run on any PC.',
    files: [{ role: 'pack', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kitten-nano-en-v0_2-fp16.tar.bz2', file: 'kitten-nano-en-v0_2-fp16' }],
    voices: [2, 3, 4, 5].flatMap((n, k) => [{ id: k * 2, name: `Voice ${n} ♂`, lang: 'en-US', gender: 'm' }, { id: k * 2 + 1, name: `Voice ${n} ♀`, lang: 'en-US', gender: 'f' }]) },
  { id: 'tts-pocket', kind: 'tts', engine: 'sherpa', family: 'pocket', tier: 'medium', name: 'Pocket TTS · voice cloning', lang: 'en', license: 'CC-BY-4.0 · non-commercial ONNX', nonCommercial: true, size: 0.098, req: { ram: 2, vram: 0 },
    langs: ['en-US'], clone: true,
    description: 'Clones a voice from a 5–10 second recording (English). Personal, non-commercial use.',
    files: [{ role: 'pack', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2', file: 'sherpa-onnx-pocket-tts-int8-2026-01-26' }],
    voices: [{ id: 'ref:bria', name: 'Bria', lang: 'en-US', gender: 'f' }, { id: 'ref:loona', name: 'Loona', lang: 'en-US', gender: 'f' }] },

  // HUGGING FACE VOICES (Python, installed privately with uv). Sizes include PyTorch and the model weights.
  { id: 'tts-py-chatterbox', kind: 'tts', engine: 'python', family: 'chatterbox', tier: 'heavy', name: 'Chatterbox Multilingual', lang: 'multi', license: 'MIT', size: 5.5, req: { ram: 8, vram: 0 },
    langs: ['pt', 'en', 'es', 'fr', 'it', 'de', 'nl', 'pl', 'ru', 'tr', 'ar', 'zh', 'ja', 'ko', 'hi', 'sv', 'da', 'fi', 'no', 'el', 'he', 'ms', 'sw'], clone: true,
    pip: ['chatterbox-tts==0.1.7'],
    description: 'Resemble AI. Among the most realistic open voices: 23 languages including Portuguese, emotion control and voice cloning from a few seconds. Best with an NVIDIA GPU.',
    files: [], voices: [{ id: 'default', name: 'Default voice', lang: 'multi', gender: 'f', top: true }] },
  { id: 'tts-py-xtts', kind: 'tts', engine: 'python', family: 'xtts', tier: 'heavy', name: 'XTTS v2', lang: 'multi', license: 'Coqui Public Model License', nonCommercial: true, size: 5, req: { ram: 8, vram: 0 },
    langs: ['pt', 'en', 'es', 'fr', 'de', 'it', 'pl', 'tr', 'ru', 'nl', 'cs', 'ar', 'zh', 'ja', 'hu', 'ko', 'hi'], clone: true,
    pip: ['coqui-tts==0.28.0'],
    licenseNotice: 'XTTS v2 uses the Coqui Public Model License: personal and non-commercial use only. Audio you create may not be used commercially.',
    description: 'Coqui. Clones a voice from 6 seconds in 17 languages including Portuguese, plus 14 studio voices. Non-commercial license.',
    files: [], voices: [{ id: 'Ana Florence', name: 'Ana Florence', lang: 'multi', gender: 'f', top: true }, { id: 'Claribel Dervla', name: 'Claribel Dervla', lang: 'multi', gender: 'f' }, { id: 'Daisy Studious', name: 'Daisy Studious', lang: 'multi', gender: 'f' }, { id: 'Gracie Wise', name: 'Gracie Wise', lang: 'multi', gender: 'f' }, { id: 'Tammie Ema', name: 'Tammie Ema', lang: 'multi', gender: 'f' }, { id: 'Alison Dietlinde', name: 'Alison Dietlinde', lang: 'multi', gender: 'f' }, { id: 'Sofia Hellen', name: 'Sofia Hellen', lang: 'multi', gender: 'f' }, { id: 'Andrew Chipper', name: 'Andrew Chipper', lang: 'multi', gender: 'm', top: true }, { id: 'Badr Odhiambo', name: 'Badr Odhiambo', lang: 'multi', gender: 'm' }, { id: 'Craig Gutsy', name: 'Craig Gutsy', lang: 'multi', gender: 'm' }, { id: 'Damien Black', name: 'Damien Black', lang: 'multi', gender: 'm' }, { id: 'Viktor Eka', name: 'Viktor Eka', lang: 'multi', gender: 'm' }, { id: 'Dionisio Schuyler', name: 'Dionisio Schuyler', lang: 'multi', gender: 'm' }, { id: 'Luis Moray', name: 'Luis Moray', lang: 'multi', gender: 'm' }] },
  { id: 'tts-py-bark', kind: 'tts', engine: 'python', family: 'bark', tier: 'heavy', name: 'Bark (small)', lang: 'multi', license: 'MIT', size: 4.5, req: { ram: 8, vram: 0 },
    langs: ['pt', 'en', 'es', 'fr', 'it', 'de'],
    pip: ['suno-bark==0.1.5', 'soundfile'],
    description: 'Suno. Very expressive: laughs, sighs and hesitations ([laughs], [sighs], …). Short clips work best; slow without a GPU.',
    files: [], voices: [{ id: 'v2/pt_speaker_0', name: 'Speaker 0', lang: 'pt', gender: '' }, { id: 'v2/pt_speaker_1', name: 'Speaker 1', lang: 'pt', gender: '' }, { id: 'v2/pt_speaker_2', name: 'Speaker 2', lang: 'pt', gender: '' }, { id: 'v2/pt_speaker_3', name: 'Speaker 3', lang: 'pt', gender: '' }, { id: 'v2/pt_speaker_4', name: 'Speaker 4', lang: 'pt', gender: '' }, { id: 'v2/pt_speaker_5', name: 'Speaker 5', lang: 'pt', gender: '' }, { id: 'v2/pt_speaker_6', name: 'Speaker 6', lang: 'pt', gender: '' }, { id: 'v2/pt_speaker_7', name: 'Speaker 7', lang: 'pt', gender: '' }, { id: 'v2/pt_speaker_8', name: 'Speaker 8', lang: 'pt', gender: '' }, { id: 'v2/pt_speaker_9', name: 'Speaker 9', lang: 'pt', gender: '' }, { id: 'v2/en_speaker_0', name: 'Speaker 0', lang: 'en-US', gender: '' }, { id: 'v2/en_speaker_1', name: 'Speaker 1', lang: 'en-US', gender: '' }, { id: 'v2/en_speaker_2', name: 'Speaker 2', lang: 'en-US', gender: '' }, { id: 'v2/en_speaker_3', name: 'Speaker 3', lang: 'en-US', gender: '' }, { id: 'v2/en_speaker_4', name: 'Speaker 4', lang: 'en-US', gender: '' }, { id: 'v2/en_speaker_5', name: 'Speaker 5', lang: 'en-US', gender: '' }, { id: 'v2/en_speaker_6', name: 'Speaker 6', lang: 'en-US', gender: '' }, { id: 'v2/en_speaker_7', name: 'Speaker 7', lang: 'en-US', gender: '' }, { id: 'v2/en_speaker_8', name: 'Speaker 8', lang: 'en-US', gender: '' }, { id: 'v2/en_speaker_9', name: 'Speaker 9', lang: 'en-US', gender: '' }, { id: 'v2/es_speaker_0', name: 'Speaker 0', lang: 'es', gender: '' }, { id: 'v2/es_speaker_1', name: 'Speaker 1', lang: 'es', gender: '' }, { id: 'v2/es_speaker_2', name: 'Speaker 2', lang: 'es', gender: '' }, { id: 'v2/es_speaker_3', name: 'Speaker 3', lang: 'es', gender: '' }, { id: 'v2/es_speaker_4', name: 'Speaker 4', lang: 'es', gender: '' }, { id: 'v2/es_speaker_5', name: 'Speaker 5', lang: 'es', gender: '' }, { id: 'v2/es_speaker_6', name: 'Speaker 6', lang: 'es', gender: '' }, { id: 'v2/es_speaker_7', name: 'Speaker 7', lang: 'es', gender: '' }, { id: 'v2/es_speaker_8', name: 'Speaker 8', lang: 'es', gender: '' }, { id: 'v2/es_speaker_9', name: 'Speaker 9', lang: 'es', gender: '' }, { id: 'v2/fr_speaker_0', name: 'Speaker 0', lang: 'fr', gender: '' }, { id: 'v2/fr_speaker_1', name: 'Speaker 1', lang: 'fr', gender: '' }, { id: 'v2/fr_speaker_2', name: 'Speaker 2', lang: 'fr', gender: '' }, { id: 'v2/fr_speaker_3', name: 'Speaker 3', lang: 'fr', gender: '' }, { id: 'v2/fr_speaker_4', name: 'Speaker 4', lang: 'fr', gender: '' }, { id: 'v2/fr_speaker_5', name: 'Speaker 5', lang: 'fr', gender: '' }, { id: 'v2/fr_speaker_6', name: 'Speaker 6', lang: 'fr', gender: '' }, { id: 'v2/fr_speaker_7', name: 'Speaker 7', lang: 'fr', gender: '' }, { id: 'v2/fr_speaker_8', name: 'Speaker 8', lang: 'fr', gender: '' }, { id: 'v2/fr_speaker_9', name: 'Speaker 9', lang: 'fr', gender: '' }, { id: 'v2/it_speaker_0', name: 'Speaker 0', lang: 'it', gender: '' }, { id: 'v2/it_speaker_1', name: 'Speaker 1', lang: 'it', gender: '' }, { id: 'v2/it_speaker_2', name: 'Speaker 2', lang: 'it', gender: '' }, { id: 'v2/it_speaker_3', name: 'Speaker 3', lang: 'it', gender: '' }, { id: 'v2/it_speaker_4', name: 'Speaker 4', lang: 'it', gender: '' }, { id: 'v2/it_speaker_5', name: 'Speaker 5', lang: 'it', gender: '' }, { id: 'v2/it_speaker_6', name: 'Speaker 6', lang: 'it', gender: '' }, { id: 'v2/it_speaker_7', name: 'Speaker 7', lang: 'it', gender: '' }, { id: 'v2/it_speaker_8', name: 'Speaker 8', lang: 'it', gender: '' }, { id: 'v2/it_speaker_9', name: 'Speaker 9', lang: 'it', gender: '' }, { id: 'v2/de_speaker_0', name: 'Speaker 0', lang: 'de', gender: '' }, { id: 'v2/de_speaker_1', name: 'Speaker 1', lang: 'de', gender: '' }, { id: 'v2/de_speaker_2', name: 'Speaker 2', lang: 'de', gender: '' }, { id: 'v2/de_speaker_3', name: 'Speaker 3', lang: 'de', gender: '' }, { id: 'v2/de_speaker_4', name: 'Speaker 4', lang: 'de', gender: '' }, { id: 'v2/de_speaker_5', name: 'Speaker 5', lang: 'de', gender: '' }, { id: 'v2/de_speaker_6', name: 'Speaker 6', lang: 'de', gender: '' }, { id: 'v2/de_speaker_7', name: 'Speaker 7', lang: 'de', gender: '' }, { id: 'v2/de_speaker_8', name: 'Speaker 8', lang: 'de', gender: '' }, { id: 'v2/de_speaker_9', name: 'Speaker 9', lang: 'de', gender: '' }] },
  { id: 'tts-py-parler', kind: 'tts', engine: 'python', family: 'parler', tier: 'heavy', name: 'Parler-TTS Mini Multilingual', lang: 'multi', license: 'Apache-2.0', size: 5.5, req: { ram: 8, vram: 0 },
    langs: ['pt', 'en', 'es', 'fr', 'de', 'it', 'pl', 'nl'],
    pip: ['parler-tts==0.2.3', 'soundfile'],
    description: 'Hugging Face. Voices described in words (warm, calm, radio host…), 8 languages including Portuguese.',
    files: [], voices: [
      { id: 'warm-female', name: 'Warm female', lang: 'multi', gender: 'f', top: true }, { id: 'calm-male', name: 'Calm male', lang: 'multi', gender: 'm', top: true },
      { id: 'news-female', name: 'News anchor', lang: 'multi', gender: 'f' }, { id: 'storyteller-male', name: 'Storyteller', lang: 'multi', gender: 'm' },
      { id: 'energetic-female', name: 'Energetic', lang: 'multi', gender: 'f' }, { id: 'radio-male', name: 'Radio host', lang: 'multi', gender: 'm' },
    ] },

  // UPSCALE (stable-diffusion.cpp ESRGAN)
  { id: 'realesrgan-x4', kind: 'upscale', tier: 'light', name: 'Real-ESRGAN 4×', license: 'BSD-3-Clause', size: 0.067, req: { ram: 2, vram: 0 },
    description: 'Makes images 4× bigger and sharper. Small and fast.', files: [{ role: 'model', url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth', file: 'RealESRGAN_x4plus.pth' }] },
  { id: 'realesrgan-x4-anime', kind: 'upscale', tier: 'light', name: 'Real-ESRGAN 4× Anime', license: 'BSD-3-Clause', size: 0.018, req: { ram: 2, vram: 0 },
    description: '4× upscaler tuned for illustrations, anime and flat colors.', files: [{ role: 'model', url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth', file: 'RealESRGAN_x4plus_anime_6B.pth' }] },
]
// Models removed from the catalog because the engine rejects them; their files are cleaned up on start.
const RETIRED = ['tiny-sd-turbo']
const ENGINE_FOR = { text: 'llama', image: 'sd', video: 'sd', upscale: 'sd', stt: 'whisper', tts: 'piper' }
const engineOf = (m) => m.engine || ENGINE_FOR[m.kind] || 'llama'
const isPack = (f) => f.role === 'pack'
const archiveOf = (f) => localName(f) + '.tar.bz2'

// ---------- state ----------
let root = null
let send = () => {}
let electronApp = null
let hw = null
let server = null // llama-server { proc, port, modelId }
let starting = null
const jobs = new Map() // id -> { received, total, controller, label }

function modelsDir() {
  const d = path.join(root, 'models')
  fs.mkdirSync(d, { recursive: true })
  return d
}
function engineDir(key) {
  return path.join(root, 'engine', key, ENGINES[key].tag)
}
function findExe(dir, name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  if (!fs.existsSync(dir)) return null
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.name === exe) return p
    }
  }
  return null
}
function engineBinary(key) {
  const e = ENGINES[key]
  return findExe(engineDir(key), Object.values(e.exe)[0])
}
// Back-compat with 0.2.0 installs (engine/<tag>).
function legacyLlama() {
  return findExe(path.join(root, 'engine', ENGINES.llama.tag), 'llama-server')
}

function customModels() {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'custom-models.json'), 'utf8')).map((m) => ({
      kind: 'text', tier: 'custom', req: { ram: 0, vram: 0 }, license: '', size: (m.size || 0) / GB, ...m,
      files: m.files || [{ role: 'model', url: m.url, file: m.file }],
      args: m.kind === 'image' ? { model: '-m', extra: ['--steps', '20', '--cfg-scale', '7'], width: 512, height: 512 } : undefined,
    }))
  } catch {
    return []
  }
}
function allModels() {
  const r = loadResolved()
  // Files found by pattern on first download are remembered in resolved.json.
  const withResolved = CATALOG.map((m) => (r[m.id] ? { ...m, files: m.files.map((f, i) => (f.file ? f : { ...f, file: r[m.id][i] })) } : m))
  return [...withResolved, ...customModels()].filter((m) => !m.platforms || m.platforms.includes(process.platform))
}
function localName(f) {
  return path.basename(f.file || f.url || '')
}
function fileOf(m, role) {
  const f = m.files.find((x) => x.role === role)
  return f?.file && fs.existsSync(path.join(modelsDir(), localName(f))) ? path.join(modelsDir(), localName(f)) : null
}
// A text model sees images only when its vision projector (mmproj) is on disk.
function hasVision(m) {
  return !!(m.vision && fileOf(m, 'mmproj'))
}
function isInstalled(m) {
  if (engineOf(m) === 'python') return !!root && fs.existsSync(path.join(pyEnv(m.family), '.orbi-ok'))
  return m.files.every((f) => f.optional || (isPack(f) ? fs.existsSync(path.join(modelsDir(), localName(f), '.orbi-ok')) : f.file && fs.existsSync(path.join(modelsDir(), localName(f)))))
}

function fitFor(m) {
  if (!hw) return { level: 'ok', reason: '' }
  const need = m.req || { ram: 0, vram: 0 }
  // Windows reports slightly less than the installed memory (12 GB shows as 11.7 GB), so allow a small margin.
  const effRam = hw.ram + 0.6
  const effVram = (hw.vram || 0) + 0.3
  if (hw.diskFree && m.size && hw.diskFree < m.size + 1) return { level: 'no', reason: 'Needs {need} GB free disk — you have {have} GB.', vars: { need: m.size.toFixed(1), have: hw.diskFree } }
  if (need.ram && effRam < need.ram) return { level: 'no', reason: 'Needs {need} GB RAM — this PC has {have} GB.', vars: { need: need.ram, have: hw.ram } }
  if (need.vram && effVram < need.vram) {
    if (m.kind === 'video' || (m.kind === 'image' && m.tier === 'heavy'))
      return { level: 'slow', reason: 'Best with {need} GB VRAM (you have {have}). It will run on CPU — very slowly.', vars: { need: need.vram, have: hw.vram || 0 } }
    return { level: 'slow', reason: 'Best with {need} GB VRAM (you have {have}). Works on CPU, slower.', vars: { need: need.vram, have: hw.vram || 0 } }
  }
  return { level: 'ok', reason: 'Runs well on this PC.' }
}

function engineSupported(m) {
  const e = ENGINES[typeof m === 'string' ? ENGINE_FOR[m] : engineOf(m)]
  return !!e?.asset(false)
}

function status() {
  const engines = {}
  for (const key of Object.keys(ENGINES)) {
    const job = jobs.get(`__engine:${key}`)
    engines[key] = {
      name: ENGINES[key].name,
      tag: ENGINES[key].tag,
      supported: !!ENGINES[key].asset(false),
      installed: !!(engineBinary(key) || (key === 'llama' && legacyLlama())),
      downloading: job ? { received: job.received, total: job.total } : null,
    }
  }
  const models = allModels().map((m) => {
    const job = jobs.get(m.id)
    return {
      id: m.id, kind: m.kind, tier: m.tier, name: m.name, description: m.description, license: m.license,
      size: Math.round((m.size || 0) * GB), req: m.req, ram: m.req?.ram ? `${m.req.ram} GB RAM` : '',
      badge: m.tier === 'light' ? 'Light' : m.tier === 'medium' ? 'Medium' : m.tier === 'heavy' ? 'Heavy' : 'Custom',
      fit: fitFor(m), installed: isInstalled(m), engineSupported: engineSupported(m), engine: engineOf(m), family: m.family, voices: m.voices, langs: m.langs, clone: !!m.clone, nonCommercial: !!m.nonCommercial, licenseNotice: m.licenseNotice, vision: !!m.vision, visionReady: hasVision(m), isNew: !!m.isNew,
      lang: m.lang,
      partial: partialBytes(m),
      gen: m.args ? { presets: m.args.presets || [20, 28, 40], fixedSteps: !!m.args.fixedSteps, width: m.args.width, height: m.args.height, fps: m.args.fps || 0, image: m.kind === 'image' || !!m.args.image, ref: !!m.args.ref, end: !!m.args.end } : null,
      downloading: job ? { received: job.received, total: job.total, label: job.label } : null,
    }
  })
  const recommended = {}
  for (const kind of ['text', 'image', 'video', 'stt']) {
    const pool = models.filter((m) => m.kind === kind && m.tier !== 'custom' && m.engineSupported)
    const ok = pool.filter((m) => m.fit.level === 'ok')
    const slow = pool.filter((m) => m.fit.level === 'slow' && m.tier !== 'heavy')
    // Video on a PC without a usable GPU takes too long to recommend.
    recommended[kind] = ok.length ? ok[ok.length - 1].id : slow.length && kind !== 'video' ? slow[0].id : null
  }
  // Voices: Kokoro sounds the most natural; Supertonic is the light choice for weaker PCs and other languages.
  const tts = (id) => models.find((m) => m.id === id && m.engineSupported && m.fit.level === 'ok')
  recommended.tts = tts('tts-kokoro')?.id || tts('tts-supertonic')?.id || null
  return {
    orphans: orphans(),
    clones: root ? clones() : [],
    hardware: hw,
    paths: root ? { root, models: path.join(root, 'models'), engines: path.join(root, 'engine') } : null,
    queue: queue.map((q) => q.id),
    engines,
    engineInstalled: engines.llama.installed,
    engineTag: ENGINES.llama.tag,
    engineDownloading: engines.llama.downloading,
    running: server ? { modelId: server.modelId, port: server.port } : null,
    starting: !!starting,
    models,
    recommended,
  }
}

let emitTimer = null
function emit() {
  clearTimeout(emitTimer)
  emitTimer = setTimeout(() => send('local:status', status()), 120)
}

// ---------- downloads ----------
async function resolveFile(f) {
  if (f.url) return { url: f.url, file: localName(f) }
  if (f.file) return { url: `${HF}/${f.repo}/resolve/main/${f.file.split('/').map(encodeURIComponent).join('/')}`, file: path.basename(f.file) }
  const res = await fetch(`${HF}/api/models/${f.repo}`, { headers: { 'user-agent': 'Orbi' } })
  if (!res.ok) throw new Error(`Hugging Face: could not list ${f.repo} (${res.status}).`)
  const json = await res.json()
  const re = new RegExp(f.pattern, 'i')
  const names = (json.siblings || []).map((s) => s.rfilename)
  // Exact pattern first; otherwise the first model file at the root of the repo (repos rename quantizations over time).
  const hit = names.find((n) => re.test(n) && (/mmproj|vision/.test(f.role) || !/mmproj/i.test(n))) || (['model', 'diffusion'].includes(f.role) ? names.find((n) => /^[^/]+\.(gguf|safetensors)$/i.test(n) && !/vae|clip|t5|encoder|mmproj/i.test(n)) : null)
  if (!hit) throw new Error(`${f.repo} has no compatible model file anymore. Pick another model or search Hugging Face.`)
  f.file = hit
  return { url: `${HF}/${f.repo}/resolve/main/${hit.split('/').map(encodeURIComponent).join('/')}`, file: path.basename(hit) }
}

async function download(url, dest, jobId, label, offset = 0, totalHint = 0) {
  let job = jobs.get(jobId)
  if (!job) {
    job = { received: 0, total: 0, controller: new AbortController(), label }
    jobs.set(jobId, job)
  }
  job.label = label
  emit()
  if (url.startsWith('file://') || path.isAbsolute(url)) {
    fs.copyFileSync(url.startsWith('file://') ? new URL(url) : url, dest)
    return
  }
  const part = dest + '.part'
  const have = fs.existsSync(part) ? fs.statSync(part).size : 0
  const headers = { 'user-agent': 'Orbi' }
  if (have) headers.Range = `bytes=${have}-`
  const res = await fetch(url, { signal: job.controller.signal, redirect: 'follow', headers })
  if (!res.ok && res.status !== 206) throw new Error(`Download failed (${res.status}) — ${url}`)
  const resumed = res.status === 206
  const len = Number(res.headers.get('content-length') || 0)
  job.total = totalHint || offset + (resumed ? have : 0) + len
  job.received = offset + (resumed ? have : 0)
  let last = 0
  const counter = new TransformStream({
    transform(chunk, c) {
      job.received += chunk.byteLength
      if (Date.now() - last > 300) {
        last = Date.now()
        emit()
      }
      c.enqueue(chunk)
    },
  })
  await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' }))
  fs.renameSync(part, dest)
}

async function extract(archive, dir) {
  fs.mkdirSync(dir, { recursive: true })
  if (archive.endsWith('.zip')) {
    const { unzipSync } = require('fflate')
    const files = unzipSync(new Uint8Array(fs.readFileSync(archive)))
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith('/')) continue
      const out = path.join(dir, name)
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, data)
    }
  } else if (/\.tar\.bz2$|\.tbz2?$/.test(archive)) {
    // The system tar handles bzip2 natively (Windows 10+, Linux, macOS). Fall back to a JS decoder.
    const ok = await new Promise((resolve) => {
      const proc = spawn(process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar', ['-xjf', archive, '-C', dir], { windowsHide: true })
      proc.on('error', () => resolve(false))
      proc.on('exit', (code) => resolve(code === 0))
    })
    if (!ok) {
      const bz2 = require('unbzip2-stream')
      await pipeline(fs.createReadStream(archive), bz2(), require('tar').x({ cwd: dir }))
    }
  } else await require('tar').x({ file: archive, cwd: dir })
}

async function installEngine(key = 'llama') {
  if (engineBinary(key) || (key === 'llama' && legacyLlama())) return status()
  if (!hw) hw = await hardware.detect(electronApp, root)
  const e = ENGINES[key]
  const useGpu = hw.gpuAccel && process.platform !== 'darwin'
  const url = (key === 'llama' && process.env.ORBI_LLAMA_URL) || (key === 'sd' && process.env.ORBI_SD_URL) || e.asset(useGpu)
  if (!url) throw new Error(`${e.name} has no build for ${process.platform}-${process.arch} yet. Use a cloud provider instead.`)
  const dir = engineDir(key)
  const archive = path.join(root, path.basename(url.split('?')[0]))
  const jobId = `__engine:${key}`
  try {
    await download(url, archive, jobId, `${e.name} engine`)
    await extract(archive, dir)
  } finally {
    fs.rmSync(archive, { force: true })
    jobs.delete(jobId)
    emit()
  }
  const bin = engineBinary(key)
  if (!bin) throw new Error(`${e.name}: executable not found in the download.`)
  if (process.platform !== 'win32') for (const f of fs.readdirSync(path.dirname(bin))) if (!/\.(so|dylib|txt|bat|sh)$/.test(f) || f.endsWith('.sh')) fs.chmodSync(path.join(path.dirname(bin), f), 0o755)
  return status()
}

async function installModel(id) {
  const m = CATALOG.find((x) => x.id === id) || allModels().find((x) => x.id === id)
  if (!m) throw new Error('Unknown model')
  await installEngine(engineOf(m))
  if (engineOf(m) === 'python') return installPython(m)
  const total = Math.round((m.size || 0) * GB)
  let done = 0
  try {
    for (const f of m.files) {
      try {
        if (isPack(f)) {
          // A pack is a .tar.bz2 with a folder inside; a marker file says it was fully extracted.
          const folder = path.join(modelsDir(), localName(f))
          if (!fs.existsSync(path.join(folder, '.orbi-ok'))) {
            const archive = path.join(modelsDir(), archiveOf(f))
            if (!fs.existsSync(archive)) await download(f.url, archive, id, `${m.name}`, done, total)
            jobs.get(id).label = `${m.name} · unpacking`
            emit()
            fs.rmSync(folder, { recursive: true, force: true })
            await extract(archive, modelsDir())
            if (!fs.existsSync(folder)) throw new Error(`${m.name}: the download did not contain ${localName(f)}.`)
            fs.writeFileSync(path.join(folder, '.orbi-ok'), new Date().toISOString())
            fs.rmSync(archive, { force: true })
          }
          done += Math.round((m.size || 0) * GB)
          continue
        }
        const { url, file } = await resolveFile(f)
        const dest = path.join(modelsDir(), file)
        if (!fs.existsSync(dest)) await download(url, dest, id, `${m.name} · ${file}`, done, total)
        done += fs.existsSync(dest) ? fs.statSync(dest).size : 0
      } catch (e) {
        // Optional extras (like the image projector) must not block the model itself.
        if (!f.optional || jobs.get(id)?.controller.signal.aborted) throw e
        send('local:error', { id, message: `${m.name}: image input could not be added (${String(e.message || e).slice(0, 160)})` })
      }
    }
    if (m.files.some((f) => f.pattern)) saveResolved(m)
  } finally {
    jobs.delete(id)
    emit()
  }
  return status()
}

let resolvedCache = null
function saveResolved(m) {
  const map = { ...loadResolved() }
  map[m.id] = m.files.map((f) => f.file)
  resolvedCache = map
  fs.writeFileSync(path.join(root, 'resolved.json'), JSON.stringify(map, null, 2))
}
function loadResolved() {
  if (resolvedCache) return resolvedCache
  try {
    resolvedCache = JSON.parse(fs.readFileSync(path.join(root, 'resolved.json'), 'utf8'))
  } catch {
    resolvedCache = {}
  }
  return resolvedCache
}

function readCustom() {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'custom-models.json'), 'utf8'))
  } catch {
    return []
  }
}

// Adds a model from a direct link or from a Hugging Face repo + file, then downloads it.
// kind: 'text' (.gguf for llama.cpp) or 'image' (single-file SD 1.x/2.x/XL checkpoint for sd.cpp).
async function addCustomModel(input, name) {
  const o = typeof input === 'string' ? { url: input, name } : input
  const kind = o.kind === 'image' ? 'image' : 'text'
  let url = (o.url || '').trim()
  if (!url && o.repo && o.file) url = `${HF}/${o.repo}/resolve/main/${o.file.split('/').map(encodeURIComponent).join('/')}`
  const okExt = kind === 'text' ? /\.gguf(\?|$)/i : /\.(gguf|safetensors)(\?|$)/i
  if (!okExt.test(url)) throw new Error(kind === 'text' ? 'Pick a .gguf file (a Hugging Face "resolve" link or a file from search).' : 'Pick a .safetensors or .gguf checkpoint.')
  const file = decodeURIComponent(url.split('?')[0].split('/').pop())
  const id = 'custom-' + file.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/\.(gguf|safetensors)$/, '')
  const list = readCustom().filter((m) => m.id !== id)
  list.push({ id, kind, name: o.name || file.replace(/\.(gguf|safetensors)$/i, ''), description: o.repo ? `Hugging Face · ${o.repo}` : url, url, file, size: o.size || 0, repo: o.repo })
  fs.writeFileSync(path.join(root, 'custom-models.json'), JSON.stringify(list, null, 2))
  emit()
  return installModel(id)
}

// ---------- Hugging Face search ----------
async function hfSearch(query, kind = 'text') {
  const params = new URLSearchParams({ search: query || '', sort: 'downloads', direction: '-1', limit: '24', full: 'false' })
  if (kind === 'text') params.set('filter', 'gguf')
  else params.set('pipeline_tag', 'text-to-image')
  const res = await fetch(`${HF}/api/models?${params}`, { headers: { 'user-agent': 'Orbi' } })
  if (!res.ok) throw new Error(`Hugging Face search failed (${res.status}).`)
  const list = await res.json()
  return list.map((m) => ({ repo: m.id || m.modelId, downloads: m.downloads || 0, likes: m.likes || 0, updated: m.lastModified || '' }))
}

async function hfFiles(repo, kind = 'text') {
  const res = await fetch(`${HF}/api/models/${repo}/tree/main?recursive=true`, { headers: { 'user-agent': 'Orbi' } })
  if (!res.ok) throw new Error(`Could not list ${repo} (${res.status}). It may be gated — accept its license on huggingface.co first.`)
  const items = await res.json()
  const re = kind === 'text' ? /\.gguf$/i : /^[^/]+\.(safetensors|gguf)$/i
  const fitsRam = (bytes) => !hw || bytes / GB + 1.5 <= hw.ram + 0.6
  return items
    .filter((f) => f.type === 'file' && re.test(f.path) && !/mmproj|-of-0000[2-9]/i.test(f.path))
    .map((f) => {
      const size = f.lfs?.size || f.size || 0
      return { file: f.path, size, fits: fitsRam(size), quant: (f.path.match(/(IQ\d_[A-Z]+|Q\d_K(_[SML])?|Q\d_\d|Q\d|BF16|F16|F32)/i) || [''])[0].toUpperCase() }
    })
    .sort((x, y) => x.size - y.size)
}

// ---------- download queue (used by the setup wizard) ----------
const queue = []
let queueRunning = false
function enqueue(ids) {
  for (const id of ids) if (!queue.some((q) => q.id === id) && !jobs.has(id)) queue.push({ id })
  emit()
  if (!queueRunning) runQueue()
  return status()
}
async function runQueue() {
  queueRunning = true
  while (queue.length) {
    const { id } = queue[0]
    try {
      const m = allModels().find((x) => x.id === id)
      if (m && !isInstalled(m)) await installModel(id)
    } catch (e) {
      send('local:error', { id, message: String(e.message || e) })
    }
    queue.shift()
    emit()
  }
  queueRunning = false
}
function clearQueue() {
  queue.length = 0
  emit()
}

function removeAll() {
  stop()
  cancelMedia()
  for (const j of jobs.values()) j.controller.abort()
  queue.length = 0
  for (const f of [...workers.keys()]) stopWorker(f)
  for (const sub of ['models', 'engine', 'python', 'custom-models.json', 'resolved.json']) fs.rmSync(path.join(root, sub), { recursive: true, force: true })
  resolvedCache = null
  emit()
  return status()
}

function retireOld() {
  const resolved = loadResolved()
  let changed = false
  for (const id of RETIRED) {
    for (const f of resolved[id] || []) fs.rmSync(path.join(root, 'models', path.basename(f)), { force: true })
    if (resolved[id]) {
      delete resolved[id]
      changed = true
    }
  }
  if (changed) {
    resolvedCache = resolved
    fs.writeFileSync(path.join(root, 'resolved.json'), JSON.stringify(resolved, null, 2))
  }
}

function activeWork() {
  const list = []
  for (const [id, j] of jobs) list.push({ kind: 'download', label: j.label || id })
  if (activeRuns.size) list.push({ kind: 'generation', label: 'Image or video generation' })
  if (server) list.push({ kind: 'model', label: `Local model ${server.modelId}` })
  return list
}

function partialBytes(m) {
  let n = 0
  for (const f of m.files) {
    const p = f.file && path.join(modelsDir(), (isPack(f) ? archiveOf(f) : localName(f)) + '.part')
    if (p && fs.existsSync(p)) n += fs.statSync(p).size
  }
  return n
}

// Files in the models folder that no model uses anymore (old versions, retired models, broken downloads).
function orphans() {
  if (!root || !fs.existsSync(path.join(root, 'models'))) return { files: [], bytes: 0 }
  const used = new Set()
  for (const m of allModels()) for (const f of m.files) if (f.file) used.add(localName(f))
  const busy = new Set([...jobs.keys()].flatMap((id) => (allModels().find((m) => m.id === id)?.files || []).flatMap((f) => [localName(f) + '.part', archiveOf(f), archiveOf(f) + '.part'])))
  const files = fs
    .readdirSync(modelsDir())
    .filter((f) => !busy.has(f) && (f.endsWith('.part') ? !jobs.size : !used.has(f)))
    .map((f) => ({ file: f, bytes: dirBytes(path.join(modelsDir(), f)) }))
  return { files, bytes: files.reduce((a, f) => a + f.bytes, 0) }
}
function dirBytes(p) {
  const st = fs.statSync(p)
  if (!st.isDirectory()) return st.size
  return fs.readdirSync(p).reduce((a, f) => a + dirBytes(path.join(p, f)), 0)
}
function cleanOrphans() {
  for (const f of orphans().files) fs.rmSync(path.join(modelsDir(), f.file), { recursive: true, force: true })
  emit()
  return status()
}

function cancel(id) {
  jobs.get(id)?.controller.abort()
}

function removeModel(id) {
  const m = allModels().find((x) => x.id === id)
  if (!m) return status()
  if (engineOf(m) === 'python') {
    stopWorker(m.family)
    fs.rmSync(pyEnv(m.family), { recursive: true, force: true })
    emit()
    return status()
  }
  if (server?.modelId === id) stop()
  const shared = new Set(allModels().filter((x) => x.id !== id && isInstalled(x)).flatMap((x) => x.files.map(localName)))
  const resolved = loadResolved()[id] || []
  m.files.forEach((f, i) => {
    const name = path.basename(resolved[i] || f.file || f.url || '')
    const local = isPack(f) ? localName(f) : name
    if (local && !shared.has(local)) fs.rmSync(path.join(modelsDir(), local), { recursive: true, force: true })
    // Interrupted downloads leave a .part file (and packs an archive) — remove them too.
    if (local) for (const extra of [local + '.part', local + '.tar.bz2', local + '.tar.bz2.part']) fs.rmSync(path.join(modelsDir(), extra), { force: true })
  })
  if (id.startsWith('custom-')) fs.writeFileSync(path.join(root, 'custom-models.json'), JSON.stringify(readCustom().filter((x) => x.id !== id), null, 2))
  emit()
  return status()
}

// ---------- text: llama-server ----------
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}
const CTX = 8192
function threads() {
  return Math.max(2, Math.min(8, os.cpus().length - 1))
}

async function ensureRunning(modelId) {
  const want = allModels().find((x) => x.id === modelId)
  const visionNow = !!(want && hasVision(want))
  if (server && server.modelId === modelId && server.proc.exitCode === null && server.vision === visionNow) return server
  if (starting) await starting.catch(() => {})
  if (server && server.modelId === modelId && server.vision === visionNow) return server
  starting = (async () => {
    stop()
    const bin = engineBinary('llama') || legacyLlama()
    if (!bin) throw new Error('Install a local text model first (Settings → Models).')
    const m = allModels().find((x) => x.id === modelId)
    if (!m || !isInstalled(m)) throw new Error('This local model is not downloaded yet.')
    const file = path.join(modelsDir(), localName(m.files[0]))
    const port = await freePort()
    // llama.cpp fits GPU layers to the free VRAM by itself (--fit is on by default), so -ngl is left to it.
    const args = ['-m', file, '--host', '127.0.0.1', '--port', String(port), '--alias', modelId, '-c', String(CTX), '-t', String(threads()), '--jinja']
    const mmproj = m.vision ? fileOf(m, 'mmproj') : null
    if (mmproj) args.push('--mmproj', mmproj)
    const proc = spawn(bin, args, { cwd: path.dirname(bin), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let log = ''
    proc.stderr.on('data', (d) => (log = (log + d).slice(-4000)))
    server = { proc, port, modelId, vision: !!mmproj }
    proc.on('exit', () => {
      if (server?.proc === proc) server = null
      emit()
    })
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error('Local engine stopped: ' + log.split('\n').filter((l) => / E |error/i.test(l)).slice(-2).join(' ').slice(0, 300))
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 300))
    }
    emit()
    return server
  })()
  try {
    return await starting
  } finally {
    starting = null
  }
}

function stop() {
  if (server) {
    try {
      server.proc.kill()
    } catch {
      /* ignore */
    }
    server = null
    emit()
  }
}

function installedModels(kind = 'text') {
  return allModels()
    .filter((m) => m.kind === kind && isInstalled(m))
    .map((m) => ({ id: m.id, name: `${m.name} (local)`, image: kind === 'image', video: kind === 'video', vision: hasVision(m) }))
}

// ---------- image & video: sd-cli ----------
const activeRuns = new Map()

function runProcess(bin, args, onLine, signal) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd: path.dirname(bin), windowsHide: true })
    let tail = ''
    const onData = (d) => {
      const s = String(d)
      tail = (tail + s).slice(-6000)
      for (const line of s.split(/\r|\n/)) if (line.trim()) onLine?.(line.trim())
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    signal?.addEventListener('abort', () => proc.kill())
    proc.on('error', reject)
    proc.on('exit', (code) => (code === 0 ? resolve(tail) : reject(new Error(tail.split('\n').filter((l) => /error|fail|assert/i.test(l)).slice(-3).join(' ').slice(0, 400) || `exit code ${code}`))))
  })
}

async function generateMedia({ modelId, prompt, negative, width, height, steps, seed, initImage, mask, strength, frames, fps, refImages, endImage, jobId }, onProgress) {
  const m = allModels().find((x) => x.id === modelId)
  if (!m || !['image', 'video'].includes(m.kind)) throw new Error('Unknown local image/video model.')
  if (!isInstalled(m)) throw new Error(`${m.name} is not downloaded yet.`)
  const bin = engineBinary('sd')
  if (!bin) throw new Error('The image engine is not installed.')
  const resolved = loadResolved()[m.id]
  const fileFor = (role) => {
    const i = m.files.findIndex((f) => f.role === role)
    return path.join(modelsDir(), path.basename((resolved && resolved[i]) || m.files[i].file))
  }
  const a = m.args
  const args = []
  if (a.mode) args.push('-M', a.mode)
  for (const role of ['model', 'diffusion', 'llm', 'llm_vision', 'connectors', 'vae', 'audio_vae', 'clip_l', 't5xxl']) if (a[role]) args.push(a[role], fileFor(role))
  args.push('-p', prompt)
  if (negative) args.push('-n', negative)
  const extra = [...a.extra]
  if (steps && !a.fixedSteps) {
    const i = extra.indexOf('--steps')
    if (i >= 0) extra[i + 1] = String(steps)
    else extra.push('--steps', String(steps))
  }
  if (frames && a.mode === 'vid_gen') {
    // Wan needs 4n+1 frames, LTX 8n+1.
    const st = a.frameStep || 4
    const f = Math.max(st + 1, Math.round((frames - 1) / st) * st + 1)
    const i = extra.indexOf('--video-frames')
    if (i >= 0) extra[i + 1] = String(f)
  }
  if (a.mode === 'vid_gen') extra.push('--fps', String(fps || a.fps || 16))
  if (refImages?.length && a.ref) for (const r of refImages) extra.push('-r', r)
  if (endImage && a.end) extra.push('--end-img', endImage)
  args.push(...extra)
  args.push('-W', String(width || a.width), '-H', String(height || a.height), '-t', String(threads()))
  if (seed !== undefined && seed !== null && seed !== '') args.push('--seed', String(seed))
  if (initImage && (m.kind === 'image' || a.image)) args.push('-i', initImage, ...(m.kind === 'image' ? ['--strength', String(strength ?? 0.75)] : []))
  if (mask) args.push('--mask', mask)
  const out = path.join(os.tmpdir(), `orbi-${Date.now()}.${m.kind === 'video' ? 'webm' : 'png'}`)
  args.push('-o', out)
  const controller = new AbortController()
  const runId = jobId || String(Date.now())
  activeRuns.set(runId, controller)
  try {
    await runProcess(bin, args, (line) => {
      const p = line.match(/\|\s*(\d+)\/(\d+)\s*-/) || line.match(/(\d+)\/(\d+)/)
      if (p) onProgress?.({ jobId: runId, step: Number(p[1]), total: Number(p[2]), line })
      else if (/load|loading/i.test(line)) onProgress?.({ jobId: runId, step: 0, total: 0, phase: 'loading' })
      else if (/decod/i.test(line)) onProgress?.({ jobId: runId, step: 0, total: 0, phase: 'decoding' })
    }, controller.signal).catch((e) => {
      throw new Error(friendly(String(e.message || e), m))
    })
  } finally {
    activeRuns.delete(runId)
  }
  if (!fs.existsSync(out)) throw new Error('The engine finished without writing an output file.')
  const buffer = fs.readFileSync(out)
  fs.rmSync(out, { force: true })
  return { buffer, mime: m.kind === 'video' ? 'video/webm' : 'image/png', model: m.name }
}

// Turns engine logs into something a person can act on; the raw line stays at the end for support.
function friendly(raw, m) {
  const tail = raw.replace(/\s+/g, ' ').slice(0, 220)
  if (/metadata validation|unknown model|get sd version|failed to load|invalid magic|unsupported/i.test(raw))
    return `${m.name}: the image engine could not read this model file. Delete it in Settings → Local models and download it again, or pick another model. (${tail})`
  if (/out of memory|ErrorOutOfDeviceMemory|alloc|cudaMalloc|vk::|bad_alloc/i.test(raw))
    return `${m.name} ran out of memory. Try a smaller size (e.g. 512×512), fewer frames, or a lighter model. (${tail})`
  if (/killed|SIGTERM|abort/i.test(raw)) return 'Stopped.'
  return `${m.name} failed: ${tail}`
}

function cancelMedia(jobId) {
  if (jobId) return activeRuns.get(jobId)?.abort()
  for (const c of activeRuns.values()) c.abort()
}

// 4x upscale with an ESRGAN model (sd-cli -M upscale).
async function upscaleImage({ modelId, inputPath, jobId }, onProgress) {
  const m = allModels().find((x) => x.id === modelId && x.kind === 'upscale') || allModels().find((x) => x.kind === 'upscale' && isInstalled(x))
  if (!m || !isInstalled(m)) throw new Error('Download an upscaler first (Settings → Local models → Image → Upscalers).')
  const bin = engineBinary('sd')
  if (!bin) throw new Error('The image engine is not installed.')
  const out = path.join(os.tmpdir(), `orbi-up-${Date.now()}.png`)
  const controller = new AbortController()
  const runId = jobId || String(Date.now())
  activeRuns.set(runId, controller)
  onProgress?.({ jobId: runId, step: 0, total: 0, phase: 'upscaling' })
  try {
    await runProcess(bin, ['-M', 'upscale', '--upscale-model', path.join(modelsDir(), localName(m.files[0])), '-i', inputPath, '-o', out, '-t', String(threads())], null, controller.signal).catch((e) => {
      throw new Error(friendly(String(e.message || e), m))
    })
  } finally {
    activeRuns.delete(runId)
  }
  if (!fs.existsSync(out)) throw new Error('The upscaler finished without writing an image.')
  const buffer = fs.readFileSync(out)
  fs.rmSync(out, { force: true })
  return { buffer, mime: 'image/png', model: m.name }
}

function runningJobs() {
  return [...activeRuns.keys()]
}

// ---------- speech to text: whisper-cli ----------
function sherpaBin(name) {
  return findExe(engineDir('sherpa'), name)
}
function sherpaEnv(bin) {
  const lib = path.join(path.dirname(path.dirname(bin)), 'lib')
  return { ...process.env, ...(process.platform === 'linux' ? { LD_LIBRARY_PATH: lib } : process.platform === 'darwin' ? { DYLD_LIBRARY_PATH: lib } : {}) }
}
async function transcribeSherpa(m, wavPath, language) {
  const bin = sherpaBin('sherpa-onnx-offline')
  if (!bin) throw new Error('The voice engine is not installed.')
  const dir = path.join(modelsDir(), localName(m.files[0]))
  const p = (f) => path.join(dir, f)
  const args = [`--num-threads=${threads()}`]
  if (m.family === 'parakeet') args.push(`--encoder=${p('encoder.int8.onnx')}`, `--decoder=${p('decoder.int8.onnx')}`, `--joiner=${p('joiner.int8.onnx')}`, `--tokens=${p('tokens.txt')}`, '--model-type=nemo_transducer')
  else {
    const n = m.size_name
    args.push(`--whisper-encoder=${p(`${n}-encoder.int8.onnx`)}`, `--whisper-decoder=${p(`${n}-decoder.int8.onnx`)}`, `--tokens=${p(`${n}-tokens.txt`)}`)
    if (language && language !== 'auto') args.push(`--whisper-language=${language.slice(0, 2)}`)
  }
  args.push(wavPath)
  const out = await new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd: path.dirname(bin), windowsHide: true, env: sherpaEnv(bin) })
    let all = ''
    proc.stdout.on('data', (d) => (all += d))
    proc.stderr.on('data', (d) => (all += d))
    proc.on('error', reject)
    proc.on('exit', (code) => (code === 0 ? resolve(all) : reject(new Error(all.trim().split('\n').pop() || `exit ${code}`))))
  })
  const texts = [...String(out).matchAll(/"text":\s*"((?:[^"\\]|\\.)*)"/g)].map((x) => JSON.parse(`"${x[1]}"`))
  return texts.join(' ').replace(/\s+/g, ' ').trim()
}

async function transcribe({ wavPath, modelId, language }) {
  const m = allModels().find((x) => x.id === modelId && x.kind === 'stt')
  if (!m || !isInstalled(m)) throw new Error('This voice model is not downloaded yet.')
  if (engineOf(m) === 'sherpa') return transcribeSherpa(m, wavPath, language)
  const bin = engineBinary('whisper')
  if (!bin) throw new Error('The voice engine is not installed.')
  const args = ['-m', path.join(modelsDir(), localName(m.files[0])), '-f', wavPath, '-nt', '-np', '-t', String(threads()), '-l', language || 'auto']
  const outText = await new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd: path.dirname(bin), windowsHide: true })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (err = (err + d).slice(-3000)))
    proc.on('error', reject)
    proc.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(err.split('\n').slice(-3).join(' ') || `exit ${code}`))))
  })
  return outText.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()
}

// ---------- text to speech ----------
// Cloned voices (reference recordings) live in <root>/voices as <id>.wav plus voices.json.
function voicesDir() {
  const d = path.join(root, 'voices')
  fs.mkdirSync(d, { recursive: true })
  return d
}
function clones() {
  try {
    return JSON.parse(fs.readFileSync(path.join(voicesDir(), 'voices.json'), 'utf8'))
  } catch {
    return []
  }
}
function saveClone({ name, wav }) {
  const id = `clone-${Date.now().toString(36)}`
  fs.writeFileSync(path.join(voicesDir(), `${id}.wav`), Buffer.from(wav, 'base64'))
  const list = [...clones(), { id, name: String(name || 'My voice').slice(0, 40), created: Date.now() }]
  fs.writeFileSync(path.join(voicesDir(), 'voices.json'), JSON.stringify(list, null, 2))
  emit()
  return list
}
function deleteClone(id) {
  fs.rmSync(path.join(voicesDir(), `${id}.wav`), { force: true })
  const list = clones().filter((c) => c.id !== id)
  fs.writeFileSync(path.join(voicesDir(), 'voices.json'), JSON.stringify(list, null, 2))
  emit()
  return list
}

function cleanForSpeech(text) {
  return String(text).replace(/[*_#`>]/g, '').replace(/\s*\n+\s*/g, '\n').slice(0, 8000)
}

function run(bin, args, { stdin, env } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd: path.dirname(bin), windowsHide: true, env: { ...process.env, ...env } })
    let err = ''
    proc.stderr.on('data', (d) => (err = (err + d).slice(-3000)))
    proc.stdout.on('data', () => {})
    proc.on('error', reject)
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').filter((l) => !/parse-options|^\s*$/.test(l)).pop() || `exit ${code}`))))
    if (stdin != null) proc.stdin.end(stdin)
    else proc.stdin.end()
  })
}

async function speakPiper(m, text, rate, out) {
  const bin = engineBinary('piper')
  if (!bin) throw new Error('The voice engine is not installed.')
  const args = ['-m', path.join(modelsDir(), localName(m.files[0])), '-c', path.join(modelsDir(), localName(m.files[1])), '-f', out, '--length_scale', String(Math.max(0.5, Math.min(2, 1 / (rate || 1)))), '-q']
  const espeak = path.join(path.dirname(bin), 'espeak-ng-data')
  if (fs.existsSync(espeak)) args.push('--espeak_data', espeak)
  // One paragraph per line; Piper reads stdin until it closes.
  await run(bin, args, { stdin: cleanForSpeech(text) + '\n' })
}

const KOKORO_LANG = { 'pt-BR': 'pt-br', es: 'es', fr: 'fr', it: 'it', hi: 'hi' }
async function speakSherpa(m, { text, rate = 1, voice, lang }, out) {
  const bin = engineBinary('sherpa')
  if (!bin) throw new Error('The voice engine is not installed.')
  const dir = path.join(modelsDir(), localName(m.files[0]))
  const p = (f) => path.join(dir, f)
  const v = m.voices?.find((x) => String(x.id) === String(voice)) || m.voices?.find((x) => x.top) || m.voices?.[0]
  const length = String(Math.max(0.5, Math.min(2, 1 / (rate || 1))))
  const args = [`--num-threads=${threads()}`, `--output-filename=${out}`]
  if (m.family === 'kokoro') {
    args.push(`--kokoro-model=${p('model.int8.onnx')}`, `--kokoro-voices=${p('voices.bin')}`, `--kokoro-tokens=${p('tokens.txt')}`, `--kokoro-data-dir=${p('espeak-ng-data')}`, `--sid=${v?.id ?? 3}`, `--kokoro-length-scale=${length}`)
    if (v?.lang === 'en-US') args.push(`--kokoro-lexicon=${p('lexicon-us-en.txt')}`)
    else if (v?.lang === 'en-GB') args.push(`--kokoro-lexicon=${p('lexicon-gb-en.txt')}`)
    else args.push(`--kokoro-lang=${KOKORO_LANG[v?.lang] || 'en'}`)
  } else if (m.family === 'supertonic') {
    const code = String(lang || 'en').slice(0, 2).toLowerCase()
    args.push(
      `--supertonic-duration-predictor=${p('duration_predictor.int8.onnx')}`, `--supertonic-text-encoder=${p('text_encoder.int8.onnx')}`,
      `--supertonic-vector-estimator=${p('vector_estimator.int8.onnx')}`, `--supertonic-vocoder=${p('vocoder.int8.onnx')}`,
      `--supertonic-tts-json=${p('tts.json')}`, `--supertonic-unicode-indexer=${p('unicode_indexer.bin')}`, `--supertonic-voice-style=${p('voice.bin')}`,
      `--lang=${m.langs.includes(code) ? code : 'en'}`, `--sid=${v?.id ?? 0}`, '--num-steps=8', `--speed=${Math.max(0.5, Math.min(2, rate || 1))}`,
    )
  } else if (m.family === 'kitten') {
    args.push(`--kitten-model=${p('model.fp16.onnx')}`, `--kitten-voices=${p('voices.bin')}`, `--kitten-tokens=${p('tokens.txt')}`, `--kitten-data-dir=${p('espeak-ng-data')}`, `--sid=${v?.id ?? 1}`, `--kitten-length-scale=${length}`)
  } else if (m.family === 'pocket') {
    const id = String(voice || 'ref:bria')
    const ref = id.startsWith('ref:') ? p(`test_wavs/${id.slice(4)}.wav`) : path.join(voicesDir(), `${id}.wav`)
    if (!fs.existsSync(ref)) throw new Error('This cloned voice was deleted. Pick another voice.')
    args.push(
      `--pocket-lm-flow=${p('lm_flow.int8.onnx')}`, `--pocket-lm-main=${p('lm_main.int8.onnx')}`, `--pocket-encoder=${p('encoder.onnx')}`,
      `--pocket-decoder=${p('decoder.int8.onnx')}`, `--pocket-text-conditioner=${p('text_conditioner.onnx')}`, `--pocket-vocab-json=${p('vocab.json')}`,
      `--pocket-token-scores-json=${p('token_scores.json')}`, `--reference-audio=${ref}`,
    )
  } else throw new Error('Unknown voice family.')
  args.push(cleanForSpeech(text).replace(/\n/g, ' '))
  await run(bin, args, { env: sherpaEnv(bin) })
}

async function speak({ modelId, text, rate = 1, voice, lang }) {
  const m = allModels().find((x) => x.id === modelId && x.kind === 'tts')
  if (!m || !isInstalled(m)) throw new Error('This voice is not downloaded yet.')
  const out = path.join(os.tmpdir(), `orbi-tts-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`)
  try {
    if (engineOf(m) === 'python') await pyRequest(m.family, { op: 'speak', text: cleanForSpeech(text), voice: voice && !String(voice).startsWith('clone-') ? voice : undefined, ref: String(voice || '').startsWith('clone-') ? path.join(voicesDir(), `${voice}.wav`) : undefined, lang: lang || 'en', rate, out }, 600000)
    else if (engineOf(m) === 'sherpa') await speakSherpa(m, { text, rate, voice, lang }, out)
    else await speakPiper(m, text, rate, out)
    return fs.readFileSync(out)
  } finally {
    fs.rmSync(out, { force: true })
  }
}

// ---------- Python voices (uv) ----------
function pyRoot() {
  return path.join(root, 'python')
}
function pyEnv(family) {
  return path.join(pyRoot(), 'envs', family)
}
function pyEnvVars(family) {
  const models = path.join(pyEnv(family), 'models')
  return {
    UV_PYTHON_INSTALL_DIR: path.join(pyRoot(), 'runtime'),
    UV_CACHE_DIR: path.join(pyRoot(), 'cache'),
    UV_PYTHON_PREFERENCE: 'only-managed',
    HF_HOME: path.join(models, 'hf'),
    XDG_CACHE_HOME: path.join(models, 'cache'),
    TTS_HOME: path.join(models, 'tts'),
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  }
}
function pyExe(family) {
  return process.platform === 'win32' ? path.join(pyEnv(family), 'Scripts', 'python.exe') : path.join(pyEnv(family), 'bin', 'python')
}
function workerScript() {
  const dest = path.join(pyRoot(), 'orbi_voice.py')
  const src = fs.readFileSync(path.join(__dirname, 'orbi_voice.py'), 'utf8')
  if (!fs.existsSync(dest) || fs.readFileSync(dest, 'utf8') !== src) {
    fs.mkdirSync(pyRoot(), { recursive: true })
    fs.writeFileSync(dest, src)
  }
  return dest
}
// PyTorch build: CUDA for NVIDIA GPUs, the small CPU build otherwise.
function torchIndex() {
  const nvidia = (hw?.gpus || []).some((g) => /nvidia/i.test(g.vendor || g.name || ''))
  if (nvidia && process.platform !== 'darwin') return 'https://download.pytorch.org/whl/cu124'
  if (process.platform === 'linux') return 'https://download.pytorch.org/whl/cpu'
  return null
}

function runLogged(cmd, args, { env, signal, onLine }) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true })
    let tail = ''
    const onData = (d) => {
      tail = (tail + d).slice(-4000)
      const lines = String(d).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      if (lines.length) onLine?.(lines[lines.length - 1])
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    const abort = () => proc.kill()
    signal?.addEventListener('abort', abort)
    proc.on('error', reject)
    proc.on('exit', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) reject(new Error('Cancelled'))
      else if (code === 0) resolve(tail)
      else reject(new Error(tail.trim().split('\n').slice(-4).join(' ').slice(0, 600) || `${path.basename(cmd)} exited with ${code}`))
    })
  })
}

async function installPython(m) {
  const uv = engineBinary('python')
  if (!uv) throw new Error('The Python installer (uv) is missing.')
  const job = { received: 0, total: 100, controller: new AbortController(), label: `${m.name} · preparing Python` }
  jobs.set(m.id, job)
  const env = pyEnvVars(m.family)
  const step = (pct, label) => {
    job.received = pct
    job.label = `${m.name} · ${label}`
    emit()
  }
  const opts = (pct, label) => ({ env, signal: job.controller.signal, onLine: (l) => ((job.label = `${m.name} · ${label} · ${l.slice(0, 80)}`), emit()) })
  try {
    stopWorker(m.family)
    const dir = pyEnv(m.family)
    fs.rmSync(path.join(dir, '.orbi-ok'), { force: true })
    step(3, 'preparing Python 3.11')
    await runLogged(uv, ['python', 'install', '3.11'], opts(3, 'Python 3.11'))
    step(10, 'creating the environment')
    if (!fs.existsSync(pyExe(m.family))) await runLogged(uv, ['venv', dir, '--python', '3.11', '--seed'], opts(10, 'environment'))
    step(15, 'installing PyTorch (large download)')
    const index = m.torch === false ? null : torchIndex()
    if (m.torch !== false) await runLogged(uv, ['pip', 'install', '--python', pyExe(m.family), 'torch==2.6.0', 'torchaudio==2.6.0', ...(index ? ['--index-url', index] : [])], opts(15, 'PyTorch'))
    step(50, `installing ${m.name}`)
    await runLogged(uv, ['pip', 'install', '--python', pyExe(m.family), ...(m.pip || []), 'soundfile', ...(index ? ['--extra-index-url', index, '--index-strategy', 'unsafe-best-match'] : [])], opts(50, m.name))
    step(70, 'downloading the voice model')
    await pyRequest(m.family, { op: 'warmup' }, 3600000, job.controller.signal)
    fs.writeFileSync(path.join(dir, '.orbi-ok'), new Date().toISOString())
    step(100, 'ready')
  } finally {
    jobs.delete(m.id)
    emit()
  }
  return status()
}

const workers = new Map() // family -> { proc, pending: Map<id, {resolve, reject, timer}>, buf, idle }
function stopWorker(family) {
  const w = workers.get(family)
  if (!w) return
  workers.delete(family)
  for (const p of w.pending.values()) p.reject(new Error('The voice engine stopped.'))
  try {
    w.proc.kill()
  } catch {}
}
function worker(family) {
  let w = workers.get(family)
  if (w && w.proc.exitCode === null) return w
  if (!fs.existsSync(pyExe(family))) throw new Error('This voice is not installed yet.')
  const proc = spawn(pyExe(family), ['-u', workerScript(), family], { env: { ...process.env, ...pyEnvVars(family) }, windowsHide: true })
  w = { proc, pending: new Map(), buf: '', err: '', seq: 0 }
  workers.set(family, w)
  proc.stdout.on('data', (d) => {
    w.buf += d
    let i
    while ((i = w.buf.indexOf('\n')) >= 0) {
      const line = w.buf.slice(0, i).trim()
      w.buf = w.buf.slice(i + 1)
      if (!line.startsWith('{')) continue
      try {
        const r = JSON.parse(line)
        const p = w.pending.get(String(r.id))
        if (!p) continue
        w.pending.delete(String(r.id))
        clearTimeout(p.timer)
        r.ok ? p.resolve(r) : p.reject(new Error(r.error || 'Voice error'))
      } catch {}
    }
  })
  proc.stderr.on('data', (d) => (w.err = (w.err + d).slice(-3000)))
  proc.on('exit', () => {
    workers.delete(family)
    for (const p of w.pending.values()) p.reject(new Error(w.err.trim().split('\n').slice(-3).join(' ') || 'The voice engine stopped.'))
  })
  return w
}
function pyRequest(family, payload, timeout = 600000, signal) {
  const w = worker(family)
  const id = String(++w.seq)
  clearTimeout(w.idle)
  // Free the memory when the voice has not been used for 10 minutes.
  w.idle = setTimeout(() => stopWorker(family), 10 * 60000)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      w.pending.delete(id)
      reject(new Error('The voice took too long.'))
    }, timeout)
    w.pending.set(id, { resolve, reject, timer })
    signal?.addEventListener('abort', () => stopWorker(family))
    w.proc.stdin.write(JSON.stringify({ id, ...payload }) + '\n')
  })
}
process.on('exit', () => {
  for (const f of [...workers.keys()]) stopWorker(f)
})

async function init(dir, sender, app) {
  root = dir
  send = sender
  electronApp = app
  fs.mkdirSync(root, { recursive: true })
  hw = await hardware.detect(app, dir).catch(() => null)
  try {
    retireOld()
  } catch {
    /* ignore */
  }
  emit()
}

async function refreshHardware() {
  hardware.reset()
  hw = await hardware.detect(electronApp, root)
  return status()
}

module.exports = {
  init, status, installEngine, installModel, addCustomModel, removeModel, cancel, ensureRunning, stop, installedModels,
  generateMedia, cancelMedia, upscaleImage, runningJobs, transcribe, speak, clones, saveClone, deleteClone, cleanOrphans, refreshHardware, hfSearch, hfFiles, enqueue, clearQueue, removeAll, activeWork, CTX, CATALOG,
}
