import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

/** Expands with edits, generated prompts and container resizing. */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const area = ref.current
    if (!area) return
    const resize = () => {
      area.style.height = 'auto'
      area.style.height = `${area.scrollHeight + 2}px`
    }
    resize()
    const observer = new ResizeObserver(() => {
      if (area.clientWidth !== width) { width = area.clientWidth; resize() }
    })
    let width = area.clientWidth
    observer.observe(area)
    return () => observer.disconnect()
  }, [props.value])
  return <textarea {...props} ref={ref} style={{ ...props.style, resize: 'none', overflowY: 'hidden' }} />
}
