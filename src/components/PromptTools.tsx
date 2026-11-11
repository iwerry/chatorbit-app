// Improve + Surprise me buttons for any prompt field, with one-step undo.
import { useState } from 'react'
import { Dices, Loader2, Undo2, WandSparkles } from 'lucide-react'
import type { ModelInfo } from '../lib/api'
import { t } from '../lib/i18n'
import { DEFAULT_NEGATIVE } from '../lib/ideas'
import { enhanceNegative, enhancePrompt, surprisePrompt, type PromptMode, type PromptPair } from '../lib/promptTools'

type Props = {
  models: ModelInfo[]
  mode: PromptMode
  prompt: string
  negative: string
  onChange: (p: PromptPair) => void
  // 'both' rewrites prompt and negative; 'negative' only improves the negative (uses prompt as context).
  target?: 'both' | 'prompt' | 'negative'
  small?: boolean
  // Name of the model the prompt is for, so the help follows its strengths.
  modelName?: string
  // One button only (Canvas): Surprise me improves what is written and adds a creative twist, filling positive and negative together.
  single?: boolean
}

export function PromptTools({ models, mode, prompt, negative, onChange, target = 'both', small, modelName, single }: Props) {
  const [busy, setBusy] = useState<null | 'improve' | 'surprise'>(null)
  const [error, setError] = useState('')
  const [undo, setUndo] = useState<PromptPair | null>(null)
  const size = small ? 12 : 13

  const apply = (next: PromptPair) => {
    setUndo({ prompt, negative })
    onChange(next)
  }
  const run = async (kind: 'improve' | 'surprise') => {
    setBusy(kind)
    setError('')
    try {
      if (target === 'negative') {
        apply({ prompt, negative: kind === 'improve' ? await enhanceNegative(models, prompt, negative, mode) : DEFAULT_NEGATIVE[mode === 'video' ? 'video' : 'image'] })
        return
      }
      const r = kind === 'improve' ? await enhancePrompt(models, { prompt, negative, mode, target: modelName }) : await surprisePrompt(models, { prompt, negative, mode, target: modelName })
      apply(target === 'prompt' ? { prompt: r.prompt, negative } : r)
    } catch (e) {
      setError(t(String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={`prompt-tools ${small ? 'small' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
      {!single && <button
        className="prompt-tool wand"
        onClick={() => run('improve')}
        disabled={!!busy}
        title={target === 'negative' ? t('Write a negative prompt that fits this prompt') : prompt.trim() ? t('Improve: AI reads what you wrote and makes it clear and specific, keeping your idea') : t('Improve: AI writes a prompt for you')}
      >
        {busy === 'improve' ? <Loader2 size={size} className="animate-spin" /> : <WandSparkles size={size} />}
        {!small && <span>{busy === 'improve' ? t('Improving…') : t('Improve')}</span>}
      </button>}
      <button
        className="prompt-tool"
        onClick={() => run('surprise')}
        disabled={!!busy}
        title={target === 'negative' ? t('Use a standard negative prompt') : single ? t('Surprise me: AI improves your idea with a creative twist and writes the positive and negative prompts') : prompt.trim() ? t('Surprise me: AI reimagines your idea in an unexpected way') : t('Surprise me: AI invents a new idea every time')}
      >
        {busy === 'surprise' ? <Loader2 size={size} className="animate-spin" /> : <Dices size={size} />}
        {!small && <span>{busy === 'surprise' ? t('Thinking…') : t('Surprise me')}</span>}
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
