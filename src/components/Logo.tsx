import type { SVGProps } from 'react'

// Orbi mark: a solid core crossed by a tilted orbit, with a satellite dot.
export function OrbiMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
      <circle cx="16" cy="16" r="6.2" fill="currentColor" />
      <ellipse cx="16" cy="16" rx="13.2" ry="5.6" transform="rotate(-28 16 16)" stroke="currentColor" strokeWidth="2.1" />
      <circle cx="26.6" cy="9.4" r="2.6" fill="currentColor" stroke="var(--orbi-mark-gap, #c8f04a)" strokeWidth="1.6" />
    </svg>
  )
}

// Temporary chat: a little ghost — the conversation leaves no trace.
export function GhostIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M5.2 19.4V11a6.8 6.8 0 0 1 13.6 0v8.4c0 .5-.55.8-.97.52l-1.38-.92a.9.9 0 0 0-1 0l-1.45.97a.9.9 0 0 1-1 0l-1.5-1a.9.9 0 0 0-1 0l-1.5 1a.9.9 0 0 1-1 0l-1.45-.97a.9.9 0 0 0-1 0l-1.38.92c-.42.28-.97-.02-.97-.52Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <ellipse cx="9.6" cy="11.2" rx="1.15" ry="1.55" fill="currentColor" />
      <ellipse cx="14.4" cy="11.2" rx="1.15" ry="1.55" fill="currentColor" />
    </svg>
  )
}
