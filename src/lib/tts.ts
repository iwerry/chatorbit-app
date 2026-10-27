// Read-aloud: a downloaded Piper voice (natural, offline) or one of the system voices.
import { api, type TtsChoice } from './api'

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

// Plays text and resolves when it ends (or is stopped).
export async function speak(text: string, choice: TtsChoice | null, lang: string): Promise<void> {
  stopSpeaking()
  const clean = text.replace(/```[\s\S]*?```/g, ' ').replace(/\]\([^)]*\)/g, ']').replace(/[#*_>`~[\]]/g, '')
  if (choice?.type === 'piper') {
    const url = await api.speakLocal({ text: clean, modelId: choice.modelId, rate: choice.rate })
    const audio = new Audio(url)
    return new Promise((resolve) => {
      current = {
        stop: () => {
          audio.pause()
          resolve()
        },
      }
      audio.onended = audio.onerror = () => resolve()
      audio.play().catch(() => resolve())
    })
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
