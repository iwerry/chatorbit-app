// Read-aloud: a downloaded Piper voice (natural, offline) or one of the system voices.
import { api, type TtsChoice } from './api'
import { routeAudio } from './audioDevices'
import { CLOUD_ONLY } from './cloud'

let current: { stop: () => void } | null = null

export function stopSpeaking() {
  current?.stop()
  current = null
}

export const SAMPLE: Record<string, string> = {
  en: 'Hi! This is how I will read your answers.',
  pt: 'Olá! É assim que vou ler as suas respostas.',
  es: '¡Hola! Así es como voy a leer tus respuestas.',
  fr: 'Bonjour ! Voici comment je vais lire vos réponses.',
}
export const sampleFor = (lang: string) => SAMPLE[lang.slice(0, 2)] || SAMPLE.en

export function systemVoices(): SpeechSynthesisVoice[] {
  return typeof speechSynthesis === 'undefined' ? [] : speechSynthesis.getVoices()
}

// Split long text at sentence ends so the first part plays while the next one is being made.
function chunks(text: string, max = 320): string[] {
  const parts = text.split(/(?<=[.!?…])\s+|\n+/).map((p) => p.trim()).filter(Boolean)
  const out: string[] = []
  let cur = ''
  for (const p of parts) {
    if (cur && (cur + ' ' + p).length > max) {
      out.push(cur)
      cur = p
    } else cur = cur ? cur + ' ' + p : p
  }
  if (cur) out.push(cur)
  return out.length ? out : [text]
}

export const isLocalChoice = (c: TtsChoice | null): c is Extract<TtsChoice, { modelId: string }> => !!c && (c.type === 'piper' || c.type === 'local')

// Plays text and resolves when it ends (or is stopped).
export async function speak(text: string, choice: TtsChoice | null, lang: string): Promise<void> {
  stopSpeaking()
  const clean = text.replace(/```[\s\S]*?```/g, ' ').replace(/\]\([^)]*\)/g, ']').replace(/[#*_>`~[\]]/g, '')
  // Orbi Cloud voices are the default now; system voices remain only as an explicit choice.
  // Orbi Cloud: voices come only from the cloud (no downloaded or operating-system voices).
  if (CLOUD_ONLY && choice?.type !== 'cloud') choice = { type: 'cloud', model: '', voice: '' }
  if (isLocalChoice(choice) || choice?.type === 'native' || choice?.type === 'cloud') {
    let stopped = false
    let audio: HTMLAudioElement | null = null
    let finish = () => {}
    current = {
      stop: () => {
        stopped = true
        audio?.pause()
        finish()
      },
    }
    const make = (part: string) =>
      choice.type === 'cloud'
        ? api.cloudSpeak({ text: part, model: choice.model || undefined, voice: choice.voice || undefined })
        : choice.type === 'native' ? api.speakSystem({ text: part, system: choice.id, rate: choice.rate }) : api.speakLocal({ text: part, modelId: choice.modelId, rate: choice.rate, voice: choice.voice, lang })
    const list = chunks(clean)
    let next: Promise<string> | null = make(list[0])
    for (let i = 0; i < list.length && !stopped; i++) {
      let url: string
      try {
        url = await next!
      } catch (e) {
        // If the operating system refuses a native voice, fall back to the browser voice with the same name.
        if (i === 0 && choice.type === 'native') return speak(text, { type: 'system', name: choice.name, rate: choice.rate }, lang)
        throw e
      }
      next = i + 1 < list.length ? make(list[i + 1]) : null
      if (stopped) break
      await new Promise<void>((resolve) => {
        finish = resolve
        audio = new Audio(url)
        audio.onended = audio.onerror = () => resolve()
        const a = audio
        routeAudio(a).then(() => a.play().catch(() => resolve()))
      })
    }
    return
  }
  const synth = typeof speechSynthesis === 'undefined' ? null : speechSynthesis
  if (!synth) throw new Error('This system has no voices for reading aloud.')
  const u = new SpeechSynthesisUtterance(clean.slice(0, 6000))
  const voice = choice?.type === 'system' ? systemVoices().find((v) => v.name === choice.name) : undefined
  if (voice) u.voice = voice
  u.lang = voice?.lang || (lang === 'en' ? 'en-US' : lang)
  u.rate = choice?.rate || 1
  return new Promise((resolve) => {
    current = {
      stop: () => {
        synth.cancel()
        resolve()
      },
    }
    u.onend = u.onerror = () => resolve()
    synth.speak(u)
  })
}
