// Prompt help used by the composer, the Canvas and the Node editor:
// - Improve: reads what the person wrote (any language) and rewrites it the way people should talk to an AI,
//   keeping their idea, subject and language.
// - Surprise me: invents a fresh idea every time (or reimagines the one already written), never the same loop.
// Both run on a fast, inexpensive chat model, not on whatever (maybe costly) model the chat is using.
import { api, type ModelInfo } from './api'
import { DEFAULT_NEGATIVE, IDEAS } from './ideas'
import { getLang } from './i18n'

export type PromptMode = 'image' | 'video' | 'chat'
export type PromptPair = { prompt: string; negative: string }
type Media = Exclude<PromptMode, 'chat'>

// ---------- offline fallback (no connection, or no chat model) ----------
const PARTS = {
  subject: [
    'an old lighthouse keeper with a white beard', 'a red vintage scooter', 'a glass greenhouse full of orchids', 'a fox wearing a knitted scarf', 'a futuristic tram',
    'a ballerina in a silver tutu', 'a tiny island with one palm tree', 'a street food stall selling pastel de feira', 'an astronaut gardening on Mars', 'a jazz trumpet player',
    'a samurai in rain', 'a koi pond with lanterns', 'a desert caravan of camels', 'a cozy reading nook', 'a giant octopus around a sunken ship', 'a capoeira dancer on the beach',
  ],
  setting: ['in a misty pine forest', 'on a rainy Tokyo street', 'at a Rio de Janeiro rooftop at sunset', 'inside a brutalist concrete museum', 'on a salt flat that mirrors the sky', 'under the northern lights'],
  style: ['cinematic photography', 'editorial magazine photo', 'watercolor illustration', 'isometric 3D render', 'analog film photo', 'claymation diorama', 'bold flat vector illustration'],
  light: ['golden hour light', 'soft overcast light', 'dramatic rim light', 'neon reflections', 'blue hour glow', 'volumetric light rays'],
  motion: ['slow dolly-in', 'smooth orbit around the subject', 'handheld tracking shot', 'gentle crane up', 'slow-motion'],
}
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function randomPrompt(mode: PromptMode): PromptPair {
  const m: Media = mode === 'video' ? 'video' : 'image'
  const pool = IDEAS.filter((x) => x.mode === m)
  if (pool.length && Math.random() < 0.4) {
    const idea = pick(pool)
    return { prompt: idea.prompt, negative: idea.negative || DEFAULT_NEGATIVE[m] }
  }
  const prompt =
    m === 'video'
      ? `${cap(pick(PARTS.subject))} ${pick(PARTS.setting)}, ${pick(PARTS.motion)}, ${pick(PARTS.light)}, ${pick(PARTS.style)}`
      : `${cap(pick(PARTS.subject))} ${pick(PARTS.setting)}, ${pick(PARTS.style)}, ${pick(PARTS.light)}`
  return { prompt, negative: DEFAULT_NEGATIVE[m] }
}

// ---------- writer model ----------
// Fast and inexpensive models that write well, best first. Falls back to any text model.
const WRITERS = [/anthropic\/claude-haiku/, /google\/gemini-[\d.]+-flash(?!.*(image|tts|lite|audio))/, /openai\/gpt-[\d.]+-mini(?!.*(image|audio|tts|transcribe))/, /deepseek\/deepseek-chat/]
export async function pickWriter(models: ModelInfo[]): Promise<ModelInfo | null> {
  const text = models.filter((m) => !m.image && !/image|tts|transcri|embed|audio/i.test(m.id))
  if (!text.length) return null
  for (const re of WRITERS) {
    const hit = text.filter((m) => re.test(m.id)).sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))[0]
    if (hit) return hit
  }
  const saved = String((await api.getSetting('selectedModel', '')) || '')
  return text.find((m) => m.key === saved) || text[0]
}

const LANGS: Record<string, string> = { pt: 'Brazilian Portuguese', es: 'Spanish', fr: 'French', en: 'English' }
const uiLanguage = () => LANGS[getLang()] || 'English'

// How to talk to each kind of model: natural, specific sentences rather than keyword soup.
const CRAFT: Record<PromptMode, string> = {
  image: [
    'Write for modern image models (Gemini Image, GPT Image, FLUX, Seedream, Recraft), which follow clear natural sentences best.',
    'Cover, in this order: the subject and what it is doing; the setting; composition and framing (shot size, angle, lens); lighting; color palette and materials; style or medium; mood.',
    'Any text that must appear in the image goes in double quotes, exactly as written. Be concrete and visual; no vague praise words like "beautiful" or "amazing". 40–110 words.',
  ].join(' '),
  video: [
    'Write for modern video models (Veo, Kling, Seedance, Wan), which follow one clear shot description best.',
    'Describe one continuous shot: subject and look; the action as it unfolds over a few seconds; ONE camera movement; setting; lighting; mood; and sound if relevant (ambience, music, dialogue in quotes).',
    'Physical, observable details only; no lists of adjectives. 2–4 sentences.',
  ].join(' '),
  chat: [
    'Rewrite the message as a clear request to an AI assistant, the way an expert would ask: state the goal first, then the useful context, the constraints, and the format of the answer they want.',
    'Keep the person’s voice, facts and intent; do not invent facts or answer the question. Use short paragraphs or a short list when it helps. Keep it concise.',
  ].join(' '),
}

const reply = (mode: PromptMode) =>
  mode === 'chat' ? 'Reply with JSON only: {"prompt": "the rewritten message"}' : 'Reply with JSON only: {"prompt": "...", "negative": "a short comma-separated list of things to avoid that fits this prompt"}'

async function ask(models: ModelInfo[], system: string, user: string) {
  const m = await pickWriter(models)
  if (!m) throw new Error('Connect a chat model first (a cloud provider or a local text model).')
  return api.complete({ providerId: m.provider, model: m.id, system, prompt: user, maxTokens: 1600 })
}

// ---------- Improve ----------
export async function enhancePrompt(models: ModelInfo[], input: PromptPair & { mode: PromptMode; target?: string }): Promise<PromptPair> {
  if (!input.prompt.trim()) return surprisePrompt(models, input)
  const system = [
    `You are a senior prompt writer. Improve the person's ${input.mode === 'chat' ? 'message to an AI assistant' : `${input.mode} prompt`} so the AI understands it on the first try.`,
    'Read everything they wrote and keep their idea, subject, people, brand names, quoted text and intent exactly. Never replace the subject or add a different one. Fill gaps with sensible, specific detail.',
    CRAFT[input.mode],
    input.target ? `The target model is ${input.target}; follow its strengths.` : '',
    `Write in the same language the person used (if unclear, ${uiLanguage()}).`,
    input.mode === 'chat' ? '' : 'Keep what they already put in the negative prompt.',
    reply(input.mode),
  ]
    .filter(Boolean)
    .join('\n')
  const text = await ask(models, system, `${input.mode === 'chat' ? 'Message' : 'Prompt'}: ${input.prompt.trim()}${input.mode === 'chat' ? '' : `\nNegative prompt: ${input.negative.trim() || '(empty)'}`}`)
  return parsePair(text, input)
}

// ---------- Surprise me ----------
// A random creative spark makes every press land somewhere new; recent results are sent back so it never repeats.
const SPARKS = [
  'a tiny everyday object at monumental scale', 'a Brazilian festival tradition', 'a forgotten profession', 'two eras colliding', 'nature reclaiming a city', 'a quiet moment before something big',
  'an impossible architecture', 'a food photographed as a landscape', 'an animal doing a human job', 'a scene seen from directly above', 'a dream logic interior', 'a sports moment frozen mid-air',
  'a fashion editorial in an unexpected place', 'a sci-fi world built from craft materials', 'a myth retold in the present day', 'a micro world inside a drop of water', 'a product hero shot with a twist',
  'a cozy night scene with one light source', 'a storm seen from a safe place', 'a love letter to a neighborhood', 'a carnival of color in black and white world', 'a reflection that shows something else',
  'an underwater city', 'a vintage poster style', 'a hand-made miniature diorama', 'a surreal still life', 'a journey on an old train', 'a robot with a gentle hobby', 'a desert at the blue hour',
  'a celebration in the rain', 'an ordinary street seen like a movie set', 'a cosmic event over a small town', 'a single color dominating the scene', 'a textile pattern come to life',
]
const CHAT_SPARKS = [
  'plan something for the week', 'learn a skill fast', 'turn an idea into a business', 'write something heartfelt', 'compare options to decide', 'explain a hard topic simply',
  'create content for social media', 'organize a trip', 'improve a piece of writing', 'brainstorm names', 'build a study plan', 'prepare for a conversation or interview',
]
const recent: string[] = []

export async function surprisePrompt(models: ModelInfo[], input: Partial<PromptPair> & { mode: PromptMode; target?: string }): Promise<PromptPair> {
  const base = (input.prompt || '').trim()
  const spark = pick(input.mode === 'chat' ? CHAT_SPARKS : SPARKS)
  const system = [
    input.mode === 'chat'
      ? 'You suggest one surprising, genuinely useful thing a person could ask an AI assistant today, written as their message.'
      : `You are a bold creative director inventing one striking, original ${input.mode} idea and writing it as a ready-to-use prompt.`,
    base
      ? 'The person already has an idea: keep its core subject and intent, fix what is vague or missing, and push it further with one unexpected, smarter creative choice (angle, setting, light, style or story) so it becomes the best complete version of their idea.'
      : `Use this creative spark as a starting point, interpreted freely: "${spark}".`,
    CRAFT[input.mode],
    input.target ? `The target model is ${input.target}.` : '',
    recent.length ? `Do not repeat or resemble these recent ideas:\n- ${recent.join('\n- ')}` : '',
    `Write in ${base ? 'the same language the person used' : uiLanguage()}.`,
    input.mode === 'chat' ? '' : `Also write a fresh negative prompt made for this exact ${input.mode}: the usual flaws of the medium plus anything that would spoil this specific scene.`,
    reply(input.mode),
  ]
    .filter(Boolean)
    .join('\n')
  try {
    const text = await ask(models, system, base ? `Idea: ${base}` : `Spark: ${spark}`)
    const r = parsePair(text, { prompt: base, negative: input.negative || '', mode: input.mode })
    recent.unshift(r.prompt.slice(0, 120))
    recent.splice(8)
    return r
  } catch (e) {
    // Without a connection the button still does something useful.
    if (input.mode === 'chat') throw e
    return randomPrompt(input.mode)
  }
}

// Improves only the negative prompt for a given positive prompt.
export async function enhanceNegative(models: ModelInfo[], positive: string, negative: string, mode: PromptMode): Promise<string> {
  const m: Media = mode === 'video' ? 'video' : 'image'
  if (!positive.trim()) return negative.trim() || DEFAULT_NEGATIVE[m]
  const r = await enhancePrompt(models, { prompt: positive, negative, mode: m })
  return r.negative || negative || DEFAULT_NEGATIVE[m]
}

function parsePair(text: string, input: PromptPair & { mode: PromptMode }): PromptPair {
  const fallbackNeg = input.mode === 'chat' ? '' : input.negative || DEFAULT_NEGATIVE[input.mode]
  const clean = text.replace(/```(?:json)?/g, '').trim()
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(clean.slice(start, end + 1))
      const prompt = String(j.prompt || '').trim()
      if (prompt) return { prompt, negative: input.mode === 'chat' ? '' : String(j.negative || fallbackNeg).trim() }
    } catch {
      /* fall through */
    }
  }
  // Broken or cut-off JSON: take the fields that are there, ending a cut prompt at its last full sentence.
  const field = (k: string) => clean.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)("|$)`))
  const unescape = (v: string) => v.replace(/\\n/g, '\n').replace(/\\(["\\/])/g, '$1')
  const pm = field('prompt')
  if (pm?.[1]) {
    let prompt = unescape(pm[1]).trim()
    if (!pm[2]) prompt = prompt.replace(/[^.!?。]*$/, '').trim() || prompt
    const nm = field('negative')
    return { prompt, negative: input.mode === 'chat' ? '' : (nm?.[2] ? unescape(nm[1]).trim() : '') || fallbackNeg }
  }
  const prompt = clean.replace(/^prompt:\s*/i, '').split(/\n\s*negative( prompt)?:/i)[0].trim()
  const neg = clean.match(/negative(?: prompt)?:\s*([\s\S]+)$/i)?.[1]?.trim()
  return { prompt: prompt || input.prompt, negative: input.mode === 'chat' ? '' : neg || fallbackNeg }
}
