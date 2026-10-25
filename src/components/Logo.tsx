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

export function SpyHatIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M5.3 9.2h13.4M7.7 9.2l1.15-4.1c.12-.42.53-.68.96-.6L12 4.9l2.18-.4c.43-.08.85.18.97.6l1.15 4.1"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8.3" cy="14.7" r="2.45" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="15.7" cy="14.7" r="2.45" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10.75 14.5c.7-.58 1.8-.58 2.5 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
