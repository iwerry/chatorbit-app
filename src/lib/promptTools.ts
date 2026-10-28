// Magic wand (improve a prompt and its negative with a chat model) and Random (instant offline ideas).
import { api, type ModelInfo } from './api'
import { DEFAULT_NEGATIVE, IDEAS } from './ideas'

export type PromptMode = 'image' | 'video'
export type PromptPair = { prompt: string; negative: string }

// ---------- random ----------
const PARTS = {
  subject: [
    'an old lighthouse keeper with a white beard', 'a red vintage scooter', 'a glass greenhouse full of orchids', 'a fox wearing a knitted scarf', 'a futuristic tram',
    'a ballerina in a silver tutu', 'a tiny island with one palm tree', 'a street food stall selling pastel de feira', 'an astronaut gardening on Mars', 'a jazz trumpet player',
    'a samurai in rain', 'a koi pond with lanterns', 'a desert caravan of camels', 'a cozy reading nook', 'a giant octopus around a sunken ship', 'a capoeira dancer on the beach',
    'a robot barista', 'a hot air balloon festival', 'a mountain cabin in snowfall', 'a neon-lit ramen shop',
  ],
  setting: [
    'in a misty pine forest', 'on a rainy Tokyo street', 'at a Rio de Janeiro rooftop at sunset', 'inside a brutalist concrete museum', 'on a salt flat that mirrors the sky',
    'in a cyberpunk alley', 'in a sunflower field', 'under the northern lights', 'in a 1970s living room', 'in a floating city above the clouds', 'on a quiet Lisbon tram line',
  ],
  style: [
    'cinematic photography', 'editorial magazine photo', 'Studio Ghibli-inspired watercolor', 'isometric 3D render', 'analog film photo, Kodak Portra 400', 'oil painting with thick brush strokes',
    'claymation diorama', 'bold flat vector illustration', 'ultra-detailed concept art', 'black and white documentary photo', 'paper cut-out collage',
  ],
  light: ['golden hour light', 'soft overcast light', 'dramatic rim light', 'neon reflections', 'candlelight', 'harsh midday sun with deep shadows', 'blue hour glow', 'volumetric god rays'],
  camera: ['35mm lens', '85mm portrait lens, shallow depth of field', 'wide-angle low shot', 'aerial drone view', 'macro close-up', 'symmetrical centered composition'],
  motion: ['slow dolly-in', 'smooth orbit around the subject', 'handheld tracking shot', 'gentle crane up', 'slow-motion', 'static tripod shot with moving clouds', 'fast FPV fly-through'],
}
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]

export function randomPrompt(mode: PromptMode): PromptPair {
  const pool = IDEAS.filter((x) => (mode === 'video' ? x.mode === 'video' : x.mode === 'image'))
  if (pool.length && Math.random() < 0.4) {
    const idea = pick(pool)
    return { prompt: idea.prompt, negative: idea.negative || DEFAULT_NEGATIVE[mode] }
  }
  const prompt =
    mode === 'video'
      ? `${cap(pick(PARTS.subject))} ${pick(PARTS.setting)}, ${pick(PARTS.motion)}, ${pick(PARTS.light)}, ${pick(PARTS.style)}`
      : `${cap(pick(PARTS.subject))} ${pick(PARTS.setting)}, ${pick(PARTS.style)}, ${pick(PARTS.light)}, ${pick(PARTS.camera)}, highly detailed`
  return { prompt, negative: DEFAULT_NEGATIVE[mode] }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// ---------- magic wand ----------
// Uses the chat model chosen in the chat (if it can write text), otherwise the first local or cloud one.
export async function pickWriter(models: ModelInfo[]): Promise<ModelInfo | null> {
  const text = models.filter((m) => !m.image || !/image/i.test(m.id))
  if (!text.length) return null
  const saved = String((await api.getSetting('selectedModel', '')) || '')
  return text.find((m) => m.key === saved) || text.find((m) => m.provider === 'orbi') || text[0]
}

const SYSTEM = (mode: PromptMode) =>
  [
    `You are an expert prompt writer for open ${mode === 'video' ? 'video' : 'image'} generation models (FLUX, Qwen Image, Z-Image, Wan, LTX).`,
    'Rewrite the user prompt into ONE richer prompt in English. Keep the subject, people, text in quotes and the intent exactly; never add a different subject.',
    mode === 'video'
      ? 'Describe subject, action over time, camera movement, setting, lighting and mood in 2–4 sentences.'
      : 'Add composition, setting, lighting, lens or medium, materials and style. Keep it under 90 words.',
    'Also write a short negative prompt: a comma-separated list of artifacts to avoid that fits this prompt. Keep what the user already put in the negative prompt.',
    'If the user prompt is empty, invent an original, striking prompt.',
    'Reply with JSON only: {"prompt": "...", "negative": "..."}',
  ].join('\n')

export async function enhancePrompt(models: ModelInfo[], input: PromptPair & { mode: PromptMode }): Promise<PromptPair> {
  const m = await pickWriter(models)
  if (!m) throw new Error('Connect a chat model first (a cloud provider or a local text model).')
  const reply = await api.complete({
    providerId: m.provider,
    model: m.id,
    system: SYSTEM(input.mode),
    prompt: `Prompt: ${input.prompt.trim() || '(empty)'}\nNegative prompt: ${input.negative.trim() || '(empty)'}`,
    maxTokens: 700,
  })
  return parsePair(reply, input)
}

// Improves only the negative prompt for a given positive prompt.
export async function enhanceNegative(models: ModelInfo[], positive: string, negative: string, mode: PromptMode): Promise<string> {
  if (!positive.trim()) return negative.trim() || DEFAULT_NEGATIVE[mode]
  const r = await enhancePrompt(models, { prompt: positive, negative, mode })
  return r.negative || negative || DEFAULT_NEGATIVE[mode]
}

function parsePair(reply: string, input: PromptPair & { mode: PromptMode }): PromptPair {
  const text = reply.replace(/```(?:json)?/g, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(text.slice(start, end + 1))
      const prompt = String(j.prompt || '').trim()
      if (prompt) return { prompt, negative: String(j.negative || input.negative || DEFAULT_NEGATIVE[input.mode]).trim() }
    } catch {
      /* fall through */
    }
  }
  const prompt = text.replace(/^prompt:\s*/i, '').split(/\n\s*negative( prompt)?:/i)[0].trim()
  const neg = text.match(/negative(?: prompt)?:\s*([\s\S]+)$/i)?.[1]?.trim()
  return { prompt: prompt || input.prompt, negative: neg || input.negative || DEFAULT_NEGATIVE[input.mode] }
}
