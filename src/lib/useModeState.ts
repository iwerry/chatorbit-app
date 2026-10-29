import { useState, type Dispatch, type SetStateAction } from 'react'

/** Bind updates to the originating workspace, including asynchronous completions. */
export function useModeState<T>(mode: 'image' | 'video', initial: T): [T, Dispatch<SetStateAction<T>>, (target: 'image' | 'video', value: T) => void] {
  const [states, setStates] = useState({ image: initial, video: initial })
  return [states[mode], (value) => setStates((previous) => ({ ...previous, [mode]: typeof value === 'function' ? (value as (old: T) => T)(previous[mode]) : value })), (target, value) => setStates((previous) => ({ ...previous, [target]: value }))]
}
