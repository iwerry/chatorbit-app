// Magic wand + random buttons for any prompt field, with one-step undo.
import { useState } from 'react'
import { Dices, Loader2, Undo2, WandSparkles } from 'lucide-react'
import type { ModelInfo } from '../lib/api'
import { t } from '../lib/i18n'
import { enhanceNegative, enhancePrompt, randomPrompt, type PromptMode, type PromptPair } from '../lib/promptTools'

type Props = {
  models: ModelInfo[]
  mode: PromptMode
  prompt: string
  negative: string
  onChange: (p: PromptPair) => void
  // 'both' rewrites prompt and negative; 'negative' only improves the negative (uses prompt as context).
  target?: 'both' | 'prompt' | 'negative'
  small?: boolean
}

export function PromptTools({ models, mode, prompt, negative, onChange, target = 'both', small }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [undo, setUndo] = useState<PromptPair | null>(null)
  const size = small ? 12 : 13

  const apply = (next: PromptPair) => {
    setUndo({ prompt, negative })
    onChange(next)
  }
  const wand = async () => {
    setBusy(true)
    setError('')
    try {
      if (target === 'negative') apply({ prompt, negative: await enhanceNegative(models, prompt, negative, mode) })
      else {
        const r = await enhancePrompt(models, { prompt, negative, mode })
        apply(target === 'prompt' ? { prompt: r.prompt, negative } : r)
      }
    } catch (e) {
      setError(t(String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
    } finally {
      setBusy(false)
    }
  }
  const dice = () => {
    const r = randomPrompt(mode)
    apply(target === 'negative' ? { prompt, negative: r.negative } : target === 'prompt' ? { prompt: r.prompt, negative } : r)
  }

  return (
    <div className={`prompt-tools ${small ? 'small' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
      <button
        className="prompt-tool wand"
        onClick={wand}
        disabled={busy}
        title={target === 'negative' ? t('Magic wand: write a negative prompt for this prompt') : prompt.trim() ? t('Magic wand: improve the prompt and the negative prompt with AI') : t('Magic wand: invent a prompt with AI')}
      >
        {busy ? <Loader2 size={size} className="animate-spin" /> : <WandSparkles size={size} />}
        {!small && <span>{busy ? t('Improving…') : t('Improve')}</span>}
      </button>
      <button className="prompt-tool" onClick={dice} disabled={busy} title={target === 'negative' ? t('Use a standard negative prompt') : t('Random idea')}>
        <Dices size={size} />
        {!small && <span>{t('Random')}</span>}
      </button>
      {undo && !busy && (
        <button
          className="prompt-tool"
          title={t('Undo')}
          onClick={() => {
            onChange(undo)
            setUndo(null)
          }}
        >
          <Undo2 size={size} />
        </button>
      )}
      {error && (
        <span className="prompt-tool-error" title={error}>
          {error}
        </span>
      )}
    </div>
  )
}
