import { useSyncExternalStore } from 'react'
export type TaskTerminal = { id: string; shell: string; command: string; cwd: string; output: string; running: boolean; code?: number; cancelled?: boolean; timedOut?: boolean }
type Event = Partial<TaskTerminal> & { id: string; phase: 'start' | 'data' | 'exit'; text?: string }
let tasks: TaskTerminal[] = []
const listeners = new Set<() => void>()
export function receiveTaskTerminal(event: Event) {
  if (event.phase === 'start') {
    const previous = tasks.filter((t) => t.id !== event.id)
    const completed = new Set(previous.filter((t) => !t.running).slice(-31).map((t) => t.id))
    tasks = [...previous.filter((t) => t.running || completed.has(t.id)), { id: event.id, shell: event.shell || 'shell', command: event.command || '', cwd: event.cwd || '', output: '', running: true }]
  }
  else tasks = tasks.map((t) => t.id !== event.id ? t : event.phase === 'data' ? { ...t, output: (t.output + (event.text || '')).slice(-200000) } : { ...t, running: false, code: event.code, cancelled: event.cancelled, timedOut: event.timedOut })
  listeners.forEach((listener) => listener())
}
export function useTaskTerminals() { return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => tasks) }
