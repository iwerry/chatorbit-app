// Microphones and speakers the operating system offers (Windows, macOS or Linux): laptop mic, USB interfaces, headsets…
// The choice is saved in settings; an empty id means "follow the system default".
import { useEffect, useState } from 'react'
import { api } from './api'

export type AudioPrefs = { input: string; output: string }
let prefs: AudioPrefs = { input: '', output: '' }
const listeners = new Set<() => void>()

export const preferredInput = () => prefs.input
export const preferredOutput = () => prefs.output

export async function loadAudioPrefs() {
  const saved = await api.getSetting<Partial<AudioPrefs> | null>('audioDevices', null).catch(() => null)
  if (saved) prefs = { input: saved.input || '', output: saved.output || '' }
  listeners.forEach((f) => f())
}

export function setAudioPref(kind: keyof AudioPrefs, id: string) {
  prefs = { ...prefs, [kind]: id }
  api.setSetting('audioDevices', prefs)
  listeners.forEach((f) => f())
}

/** Sends an <audio> element to the chosen speaker. Silently keeps the default when the device is gone. */
export async function routeAudio(el: HTMLMediaElement) {
  const id = prefs.output
  const sink = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }
  if (!id || !sink.setSinkId) return
  try {
    await sink.setSinkId(id)
  } catch {
    /* device unplugged: stay on the default output */
  }
}

export type Device = { id: string; label: string }
export type DeviceList = { inputs: Device[]; outputs: Device[]; prefs: AudioPrefs; canPickOutput: boolean; refresh: (askPermission?: boolean) => Promise<void> }

const clean = (label: string, i: number, kind: string) => label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '') || `${kind} ${i + 1}`

/** Live device list: updates when a USB interface or headset is plugged in or out. */
export function useAudioDevices(active = true): DeviceList {
  const [inputs, setInputs] = useState<Device[]>([])
  const [outputs, setOutputs] = useState<Device[]>([])
  const [, bump] = useState(0)
  const refresh = async (askPermission = false) => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    let list = await navigator.mediaDevices.enumerateDevices()
    // Device names stay hidden until the microphone was allowed once.
    if (askPermission && list.some((d) => d.kind === 'audioinput' && !d.label)) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true })
        s.getTracks().forEach((t) => t.stop())
        list = await navigator.mediaDevices.enumerateDevices()
      } catch {
        /* no permission: show generic names */
      }
    }
    const pick = (kind: MediaDeviceKind, name: string) =>
      list
        .filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ id: d.deviceId, label: clean(d.label, i, name) }))
    setInputs(pick('audioinput', 'Microphone'))
    setOutputs(pick('audiooutput', 'Speaker'))
  }
  useEffect(() => {
    if (!active) return
    refresh(true)
    const onChange = () => refresh()
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange)
    const l = () => bump((n) => n + 1)
    listeners.add(l)
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange)
      listeners.delete(l)
    }
  }, [active])
  return { inputs, outputs, prefs, canPickOutput: typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === 'function', refresh }
}
