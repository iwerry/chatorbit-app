// Audio studio: voiceover (text to speech), music (Lyria) and sound effects, all on Orbi Cloud.
// Same pattern as the Creative studio: controls on the left, results on the right, cost shown before you generate.
import { useMemo, useState } from 'react'
import { ChevronLeft, Download, Loader2, Mic2, Music, Sparkles, Volume2, Wallet, Waves } from 'lucide-react'
import { api, type MediaItem } from '../lib/api'
import { fmtCredits, refreshCloud, useCloud } from '../lib/cloud'
import { fmtDate, t } from '../lib/i18n'
import { audioItems } from '../lib/menuItems'
import { CostChip, ModelSelect, type MenuItem } from './ModelMenu'
import { AutoTextarea } from './AutoTextarea'

type Tab = 'voice' | 'music' | 'sfx'

const MUSIC_IDEAS = [
  'Lo-fi hip hop beat for studying, warm vinyl crackle, soft piano chords, 80 bpm, instrumental',
  'Upbeat Brazilian bossa nova with nylon guitar, light percussion and a sunny summer mood',
  'Epic cinematic trailer music, big drums, strings and brass, rising tension, instrumental',
  'Catchy pop jingle for a coffee brand, happy and bright, female vocals, 15 seconds',
  'Dark synthwave track with driving bass, retro 80s drums and neon night atmosphere',
]
const SFX_IDEAS = ['Heavy rain on a tin roof with distant thunder', 'Old wooden door creaking open slowly', 'Sci-fi spaceship engine powering up', 'Crowd cheering in a stadium after a goal', 'Notification chime, soft and friendly, short']
const VOICE_IDEAS = ['Bem-vindo ao Orbi. Aqui você cria imagens, vídeos e áudio com os melhores modelos de IA, em um só lugar.', 'Introducing the new Orbi watch: calm design, all-day battery, and the details that matter.']

export function AudioStudio({ media, onBack, onMediaCreated, onOpenAccount }: { media: MediaItem[]; onBack: () => void; onMediaCreated: (m: MediaItem) => void; onOpenAccount: () => void }) {
  const { catalog, state } = useCloud()
  const [tab, setTab] = useState<Tab>('voice')
  const [script, setScript] = useState('')
  const [voiceModel, setVoiceModel] = useState('')
  const [voice, setVoice] = useState('')
  const [musicPrompt, setMusicPrompt] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [instrumental, setInstrumental] = useState(true)
  const [musicModel, setMusicModel] = useState('')
  const [sfxPrompt, setSfxPrompt] = useState('')
  const [sfxModel, setSfxModel] = useState('')
  const [busy, setBusy] = useState<Tab | null>(null)
  const [error, setError] = useState('')
  const [lastLyrics, setLastLyrics] = useState('')

  const tts = catalog?.tts ?? []
  const vm = tts.find((m) => m.id === voiceModel) ?? tts[0]
  const v = vm && vm.voices.includes(voice) ? voice : vm?.voices[0] || ''
  const musicList = catalog?.music ?? []
  const mm = musicList.find((m) => m.id === musicModel) ?? musicList[0]
  const sfxList = catalog?.sfx ?? []
  const sm = sfxList.find((m) => m.id === sfxModel) ?? sfxList[0]
  const musicItems: MenuItem[] = musicList.map((m) => ({ key: m.id, name: m.name.replace(/^[^:]+:\s*/, ''), sub: `${m.id} · ${m.seconds && m.seconds <= 30 ? t('30-second clip') : t('full song')}`, group: 'Google · Lyria', usd: m.usd, unit: 'song' }))

  const audio = useMemo(() => media.filter((m) => m.kind === 'audio'), [media])
  const estimate = tab === 'voice' ? (vm?.usd ? (vm.usd * Math.max(script.length, 1)) / 1000 : undefined) : tab === 'music' ? mm?.usd : sm?.usd

  const run = async () => {
    setError('')
    setBusy(tab)
    try {
      if (tab === 'voice') {
        if (!script.trim()) throw new Error(t('Write the text to read.'))
        const item = await api.speech({ text: script.trim(), model: vm?.id, voice: v || undefined, source: 'audio' })
        onMediaCreated(item)
      } else if (tab === 'music') {
        if (!musicPrompt.trim()) throw new Error(t('Describe the music.'))
        const prompt = [musicPrompt.trim(), instrumental ? 'Instrumental only, no vocals.' : '', !instrumental && lyrics.trim() ? `Lyrics:\n${lyrics.trim()}` : ''].filter(Boolean).join('\n\n')
        const item = await api.cloudMusic({ model: mm?.id || 'google/lyria-3-clip-preview', prompt, source: 'audio' })
        setLastLyrics(item.lyrics || '')
        onMediaCreated(item)
      } else {
        if (!sfxPrompt.trim()) throw new Error(t('Describe the sound.'))
        if (!sm) throw new Error(t('No sound-effect model is available right now.'))
        const item = await api.speech({ text: `Sound effect only, no speech: ${sfxPrompt.trim()}`, model: sm.id, voice: sm.voices[0], purpose: 'sfx', source: 'audio' })
        onMediaCreated(item)
      }
      refreshCloud()
    } catch (e) {
      setError(String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(null)
    }
  }

  const TABS: { id: Tab; label: string; icon: typeof Mic2 }[] = [
    { id: 'voice', label: 'Voiceover', icon: Mic2 },
    { id: 'music', label: 'Music', icon: Music },
    { id: 'sfx', label: 'Sound effects', icon: Waves },
  ]

  return (
    <main className="studio audio-studio">
      <header className="studio-top">
        <div className="flex min-w-0 items-center gap-2">
          <button className="creative-topbar-button" onClick={onBack} aria-label={t('Back to chats')}>
            <ChevronLeft size={17} />
          </button>
          <span className="studio-title">{t('Audio')}</span>
          <nav className="studio-tabs" role="tablist">
            {TABS.map((x) => (
              <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'active' : ''} onClick={() => (setTab(x.id), setError(''))}>
                <x.icon size={14} />
                {t(x.label)}
              </button>
            ))}
          </nav>
        </div>
        <button className="orbi-btn" onClick={onOpenAccount} title={t('Open your account')}>
          <Wallet size={13} /> <span className="num">{fmtCredits(state?.user?.credits.total ?? 0)}</span> {t('credits')}
        </button>
      </header>

      <div className="audio-body">
        <section className="audio-controls">
          {tab === 'voice' && (
            <>
              <label className="audio-label">{t('Text to read')}</label>
              <AutoTextarea className="studio-prompt" rows={8} value={script} onChange={(e) => setScript(e.target.value)} placeholder={t('Write the script. Tip: some voices understand directions in brackets, like [whispering] or [excited].')} />
              <div className="audio-ideas">
                {VOICE_IDEAS.map((x) => (
                  <button key={x} onClick={() => setScript(x)}>
                    {x.slice(0, 42)}…
                  </button>
                ))}
              </div>
              <label className="audio-label">{t('Voice model')}</label>
              <ModelSelect items={audioItems(tts, 'k')} value={vm?.id} onPick={(k) => (setVoiceModel(k), setVoice(''))} icon={<Volume2 size={14} />} />
              {!!vm?.voices.length && (
                <>
                  <label className="audio-label">{t('Voice')}</label>
                  <select className="ab-input" value={v} onChange={(e) => setVoice(e.target.value)}>
                    {vm.voices.map((x) => (
                      <option key={x} value={x}>
                        {x.replace(/:.*$/, '')}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <p className="studio-hint num">{t('{n} characters', { n: script.length })}</p>
            </>
          )}

          {tab === 'music' && (
            <>
              <label className="audio-label">{t('Describe the music')}</label>
              <AutoTextarea className="studio-prompt" rows={5} value={musicPrompt} onChange={(e) => setMusicPrompt(e.target.value)} placeholder={t('Genre, mood, instruments, tempo… e.g. calm lo-fi with soft piano, 80 bpm')} />
              <div className="audio-ideas">
                {MUSIC_IDEAS.map((x) => (
                  <button key={x} onClick={() => setMusicPrompt(x)}>
                    {x.slice(0, 40)}…
                  </button>
                ))}
              </div>
              <label className="studio-check">
                <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} /> {t('Instrumental (no vocals)')}
              </label>
              {!instrumental && (
                <>
                  <label className="audio-label">{t('Lyrics (optional)')}</label>
                  <AutoTextarea className="studio-prompt" rows={5} value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder={t('Write the lyrics, or leave empty and the model writes them.')} />
                </>
              )}
              <label className="audio-label">{t('Music model')}</label>
              {musicItems.length ? <ModelSelect items={musicItems} value={mm?.id} onPick={setMusicModel} icon={<Music size={14} />} /> : <p className="studio-hint">{t('Sign in to your Orbi account to see the models.')}</p>}
            </>
          )}

          {tab === 'sfx' && (
            <>
              <label className="audio-label">{t('Describe the sound')}</label>
              <AutoTextarea className="studio-prompt" rows={5} value={sfxPrompt} onChange={(e) => setSfxPrompt(e.target.value)} placeholder={t('e.g. footsteps on gravel, slow, at night')} />
              <div className="audio-ideas">
                {SFX_IDEAS.map((x) => (
                  <button key={x} onClick={() => setSfxPrompt(x)}>
                    {x}
                  </button>
                ))}
              </div>
              <label className="audio-label">{t('Sound model')}</label>
              {sfxList.length ? (
                <ModelSelect items={audioItems(sfxList, 'k')} value={sm?.id} onPick={setSfxModel} icon={<Waves size={14} />} />
              ) : (
                <p className="studio-hint">{t('No sound-effect model is available right now.')}</p>
              )}
            </>
          )}

          <div className="audio-go">
            <CostChip usd={estimate} />
            <button className="orbi-btn orbi-btn-primary" onClick={run} disabled={!!busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {busy ? t('Creating…') : t('Generate')}
            </button>
          </div>
          {busy === 'music' && <p className="studio-hint">{t('Music takes up to a minute.')}</p>}
          {error && <p className="studio-error">{error}</p>}
          {tab === 'music' && lastLyrics && (
            <details className="audio-lyrics">
              <summary>{t('Lyrics and notes from the model')}</summary>
              <pre>{lastLyrics}</pre>
            </details>
          )}
        </section>

        <section className="audio-results">
          <h2>{t('Your audio')}</h2>
          {!audio.length && <p className="studio-hint">{t('What you create appears here and in the Media Library.')}</p>}
          <ul>
            {audio.slice(0, 60).map((m) => (
              <li key={m.id} className="audio-item">
                <div className="min-w-0 flex-1">
                  <strong className="block truncate">{m.prompt || m.name}</strong>
                  <small className="block truncate">
                    {m.model ? `${m.model.replace(/^[^/]+\//, '')} · ` : ''}
                    {fmtDate(m.created_at)}
                  </small>
                  <audio src={m.url} controls preload="none" />
                </div>
                <button className="icon-button" title={t('Save a copy')} onClick={() => api.saveMediaAs(m.id)}>
                  <Download size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  )
}
