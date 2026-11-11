// Read-aloud with Orbi Cloud voices.
import { api, type TtsChoice } from './api'
import { routeAudio } from './audioDevices'

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

// Plays text and resolves when it ends (or is stopped).
export async function speak(text: string, choice: TtsChoice | null, _lang?: string): Promise<void> {
  stopSpeaking()
  const clean = text.replace(/```[\s\S]*?```/g, ' ').replace(/\]\([^)]*\)/g, ']').replace(/[#*_>`~[\]]/g, '')
  // Every voice comes from Orbi Cloud.
  const voice = choice?.type === 'cloud' ? choice : { type: 'cloud' as const, model: '', voice: '' }
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
  const make = (part: string) => api.cloudSpeak({ text: part, model: voice.model || undefined, voice: voice.voice || undefined })
  const list = chunks(clean)
  let next: Promise<string> | null = make(list[0])
  for (let i = 0; i < list.length && !stopped; i++) {
    const url = await next!
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
}
