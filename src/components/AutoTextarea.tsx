import { useLayoutEffect, useRef, type Ref, type TextareaHTMLAttributes } from 'react'

/** Expands with edits, generated prompts and container resizing. */
export function AutoTextarea({ ref: outer, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
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
  // The caller may want the element too (e.g. to insert text at the cursor).
  const attach = (el: HTMLTextAreaElement | null) => {
    ref.current = el
    if (typeof outer === 'function') outer(el)
    else if (outer) outer.current = el
  }
  return <textarea {...props} ref={attach} style={{ ...props.style, resize: 'none', overflowY: 'hidden' }} />
}
