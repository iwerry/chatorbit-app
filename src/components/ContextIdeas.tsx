import { useEffect, useState } from 'react'
import { AudioLines, Film, Image } from 'lucide-react'
import { t } from '../lib/i18n'

/** Suggestions follow the draft (or the latest question), without making paid calls. */
export function ContextIdeas({ topic, onPick }: { topic: string; onPick: (prompt: string) => void }) {
  const [subject, setSubject] = useState('')
  const [step, setStep] = useState(0)
  useEffect(() => {
    const timer = setTimeout(() => setSubject(topic.replace(/\s+/g, ' ').trim().slice(0, 100)), 600)
    return () => clearTimeout(timer)
  }, [topic])
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = setInterval(() => setStep((i) => i + 1), 9000)
    return () => clearInterval(timer)
  }, [])
  const about = subject || t('your next project')
  const cards = [
    { label: 'Video', Icon: Film, lines: ['Turn “{topic}” into a 30-second video script.', 'Storyboard “{topic}” in five shots.', 'Plan a short vertical video about “{topic}”.'] },
    { label: 'Image', Icon: Image, lines: ['Explore three visual directions for “{topic}”.', 'Write a detailed image prompt for “{topic}”.', 'Create a campaign concept for “{topic}”.'] },
    { label: 'Audio', Icon: AudioLines, lines: ['Write a natural voiceover about “{topic}”.', 'Describe a soundtrack for “{topic}”.', 'Plan the sound effects for “{topic}”.'] },
  ]
  return <div className="context-ideas" aria-label={t('Ideas for your project')}>
    {cards.map(({ label, Icon, lines }) => {
      const prompt = t(lines[step % lines.length], { topic: about })
      return <button type="button" className="context-idea" key={label} onClick={() => onPick(prompt)}>
        <span className="context-idea-kind"><Icon size={14} />{t(label)}</span>
        <span key={prompt} className="context-idea-copy">{prompt}</span>
      </button>
    })}
  </div>
}
