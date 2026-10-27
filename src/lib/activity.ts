// Tracks work that keeps running while the user moves around the app
// (chat answers, image/video renders, workflows) so the rail can show it and announce when it ends.
import { useSyncExternalStore } from 'react'

export type ActivityArea = 'chats' | 'creative'
export type ActivityKind = 'chat' | 'image' | 'video' | 'workflow' | 'upscale'
export type Activity = { id: string; area: ActivityArea; kind: ActivityKind; label: string; progress?: number; started: number }
export type ActivityDone = Activity & { ok: boolean; message?: string; ended: number }

let items: Activity[] = []
const subs = new Set<() => void>()
const doneSubs = new Set<(a: ActivityDone) => void>()
const emit = () => subs.forEach((f) => f())

export const activity = {
  start(a: Omit<Activity, 'id' | 'started'> & { id?: string }) {
    const id = a.id || Math.random().toString(36).slice(2, 10)
    items = [...items.filter((x) => x.id !== id), { ...a, id, started: Date.now() }]
    emit()
    return id
  },
  update(id: string, patch: Partial<Activity>) {
    if (!items.some((x) => x.id === id)) return
    items = items.map((x) => (x.id === id ? { ...x, ...patch } : x))
    emit()
  },
  end(id: string, result: { ok: boolean; message?: string } = { ok: true }) {
    const a = items.find((x) => x.id === id)
    if (!a) return
    items = items.filter((x) => x.id !== id)
    emit()
    doneSubs.forEach((f) => f({ ...a, ...result, ended: Date.now() }))
  },
  onDone(fn: (a: ActivityDone) => void) {
    doneSubs.add(fn)
    return () => {
      doneSubs.delete(fn)
    }
  },
}

export function useActivities() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => {
        subs.delete(cb)
      }
    },
    () => items,
  )
}
