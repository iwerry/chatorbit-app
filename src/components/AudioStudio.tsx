// Audio studio: voiceover (text to speech), music (Lyria) and sound effects, all on Orbi Cloud.
// Same pattern as the Creative studio: controls on the left, results on the right, cost shown before you generate.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Download, Loader2, Mic2, Music, Play, Search, Sparkles, Square, Volume2, Wallet, Waves } from 'lucide-react'
import { activity } from '../lib/activity'
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

// Voice previews: the server recognises exactly this sentence (supabase/functions/orbi/openrouter.ts sampleText),
// makes it once per voice and serves it free to everyone.
const sampleText = (voice: string) => `Hi! This is ${voice.replace(/:.*$/, '').replace(/^English_/, '').replace(/[_-]+/g, ' ')}, one of the voices you can use in Orbi.`
const samples = new Map<string, string>()
// Models that follow spoken delivery directions (OpenRouter `instructions`); others read [tags] inside the text.
const takesStyle = (id = '') => /^google\/.*tts|^fish-audio\/|^openai\/.*tts/.test(id)
const STYLES = ['Warm and friendly', 'Excited and upbeat', 'Calm narrator', 'Whispering', 'Serious news anchor', 'Slow and clear']

// Music and sound-effect settings become plain directions in the prompt: Lyria and Seed Audio read them from the text.
const GENRES = ['Pop', 'Rock', 'Hip hop', 'Lo-fi', 'Electronic', 'Bossa nova', 'Samba', 'Sertanejo', 'Funk', 'Jazz', 'Classical', 'Cinematic', 'Ambient', 'R&B', 'Reggae']
const MOODS = ['Happy', 'Calm', 'Epic', 'Dark', 'Romantic', 'Energetic', 'Melancholic', 'Mysterious']
const VOCALS = ['Instrumental', 'Female vocals', 'Male vocals', 'Duet', 'Choir'] as const
const LANGUAGES = ['Any language', 'Portuguese', 'English', 'Spanish', 'French'] as const
const SECTIONS = ['[Intro]', '[Verse]', '[Pre-chorus]', '[Chorus]', '[Bridge]', '[Outro]']
const LENGTHS = [0, 60, 120, 180]
const SPACES = ['Dry studio', 'Small room', 'Large hall', 'Outdoors', 'Underwater', 'Far away']
const INTENSITY = ['Soft', 'Medium', 'Intense'] as const

function Chips({ options, value, onChange, multi = false }: { options: readonly string[]; value: string[]; onChange: (v: string[]) => void; multi?: boolean }) {
  return (
    <div className="audio-ideas audio-chips">
      {options.map((o) => {
        const on = value.includes(o)
        return (
          <button key={o} aria-pressed={on} className={on ? 'active' : ''} onClick={() => onChange(on ? value.filter((x) => x !== o) : multi ? [...value, o] : [o])}>
            {t(o)}
          </button>
        )
      })}
    </div>
  )
}

// Voices of the chosen model, each with a short preview to hear before choosing.
function VoicePicker({ model, voices, value, onChange }: { model: string; voices: string[]; value: string; onChange: (v: string) => void }) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState('')
  const [playing, setPlaying] = useState('')
  const [error, setError] = useState('')
  const player = useRef<HTMLAudioElement | null>(null)
  useEffect(() => () => player.current?.pause(), [])
  const shown = voices.filter((x) => x.toLowerCase().includes(query.trim().toLowerCase()))
  const listen = async (voice: string) => {
    player.current?.pause()
    if (playing === voice) return setPlaying('')
    setError('')
    const key = `${model}|${voice}`
    try {
      let url = samples.get(key)
      if (!url) {
        setLoading(voice)
        url = await api.cloudSpeak({ text: sampleText(voice), model, voice })
        samples.set(key, url)
      }
      const audio = new Audio(url)
      player.current = audio
      audio.onended = () => setPlaying('')
      setPlaying(voice)
      await audio.play()
    } catch (e) {
      setPlaying('')
      setError(String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setLoading('')
    }
  }
  return (
    <>
      {voices.length > 12 && (
        <label className="orbi-field audio-voice-search">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search {n} voices', { n: voices.length })} aria-label={t('Search voices')} />
        </label>
      )}
      <div className="audio-voices" role="radiogroup" aria-label={t('Voice')}>
        {shown.map((x) => (
          <div key={x} className={`audio-voice ${x === value ? 'active' : ''}`}>
            <button className="audio-voice-play" onClick={() => listen(x)} aria-label={t('Listen to {voice}', { voice: x.replace(/:.*$/, '') })} title={t('Listen')}>
              {loading === x ? <Loader2 size={12} className="animate-spin" /> : playing === x ? <Square size={11} /> : <Play size={12} />}
            </button>
            <button className="audio-voice-name" role="radio" aria-checked={x === value} onClick={() => onChange(x)}>
              {x.replace(/:.*$/, '').replace(/_/g, ' ')}
            </button>
          </div>
        ))}
      </div>
      <p className="studio-hint">{error || t('Press play to hear a short English sample of each voice. Samples are free.')}</p>
    </>
  )
}

export function AudioStudio({ media, onBack, onMediaCreated, onOpenAccount, visible = true }: { visible?: boolean; media: MediaItem[]; onBack: () => void; onMediaCreated: (m: MediaItem) => void; onOpenAccount: () => void }) {
  const { catalog, state } = useCloud()
  // A tab asked for from the Create menu (also when this page opens for the first time).
  const pending = () => {
    const w = window as unknown as { __orbiAudioTab?: Tab }
    const v = w.__orbiAudioTab
    w.__orbiAudioTab = undefined
    return v
  }
  const [tab, setTab] = useState<Tab>(() => pending() || 'voice')
  useEffect(() => {
    const on = () => {
      const v = pending()
      if (v) setTab(v)
    }
    window.addEventListener('orbi:audio-tab', on)
    return () => window.removeEventListener('orbi:audio-tab', on)
  }, [])
  const [script, setScript] = useState('')
  const [voiceModel, setVoiceModel] = useState('')
  const [voice, setVoice] = useState('')
  const [style, setStyle] = useState('')
  const [musicPrompt, setMusicPrompt] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [genres, setGenres] = useState<string[]>([])
  const [moods, setMoods] = useState<string[]>([])
  const [bpm, setBpm] = useState(0)
  const [vocals, setVocals] = useState<string>('Instrumental')
  const [language, setLanguage] = useState<string>('Any language')
  const [length, setLength] = useState(0)
  const [musicModel, setMusicModel] = useState('')
  const [sfxPrompt, setSfxPrompt] = useState('')
  const [sfxSeconds, setSfxSeconds] = useState(5)
  const [sfxLoop, setSfxLoop] = useState(false)
  const [space, setSpace] = useState<string[]>([])
  const [intensity, setIntensity] = useState<string[]>(['Medium'])
  const [sfxModel, setSfxModel] = useState('')
  const lyricsBox = useRef<HTMLTextAreaElement | null>(null)
  const [busy, setBusy] = useState<Record<Tab, number>>({ voice: 0, music: 0, sfx: 0 })
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

  const fullSong = !!mm && !(mm.seconds && mm.seconds <= 30)
  const musicText = () => {
    const sing = vocals !== 'Instrumental'
    return [
      musicPrompt.trim(),
      genres.length ? `Genre: ${genres.join(', ')}.` : '',
      moods.length ? `Mood: ${moods.join(', ').toLowerCase()}.` : '',
      bpm ? `Tempo: about ${bpm} BPM.` : '',
      sing ? `Vocals: ${vocals.toLowerCase()}.` : 'Instrumental only, no vocals.',
      sing && language !== 'Any language' ? `Sing in ${language}.` : '',
      fullSong && length ? `Length: about ${length / 60} minute${length > 60 ? 's' : ''}.` : '',
      sing && lyrics.trim() ? `Lyrics (sing these words; the [tags] mark the song structure):\n${lyrics.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }
  const sfxText = () =>
    [
      `Sound effect only, no speech, no music: ${sfxPrompt.trim()}.`,
      `About ${sfxSeconds} second${sfxSeconds > 1 ? 's' : ''} long.`,
      intensity[0] && intensity[0] !== 'Medium' ? `${intensity[0]} intensity.` : '',
      space[0] ? `Acoustics: ${space[0].toLowerCase()}.` : '',
      sfxLoop ? 'Seamless loop: no fade in or out, the end joins the start.' : '',
    ]
      .filter(Boolean)
      .join(' ')
  const insertSection = (tag: string) => {
    const box = lyricsBox.current
    const at = box ? box.selectionStart : lyrics.length
    const before = lyrics.slice(0, at)
    const next = `${before}${before && !before.endsWith('\n') ? '\n' : ''}${tag}\n${lyrics.slice(at)}`
    setLyrics(next)
    requestAnimationFrame(() => box?.focus())
  }

  const audio = useMemo(() => media.filter((m) => m.kind === 'audio'), [media])
  const estimate = tab === 'voice' ? (vm?.usd ? (vm.usd * Math.max(script.length, 1)) / 1000 : undefined) : tab === 'music' ? mm?.usd : sm?.usd

  const run = async () => {
    setError('')
    setBusy((p) => ({ ...p, [tab]: p[tab] + 1 }))
    const activityId = activity.start({ area: 'audio', kind: 'audio', label: t(tab === 'voice' ? 'Voiceover' : tab === 'music' ? 'Music' : 'Sound effects') })
    try {
      if (tab === 'voice') {
        if (!script.trim()) throw new Error(t('Write the text to read.'))
        // The server turns the ⟦style⟧ prefix into the model's delivery instructions.
        const text = takesStyle(vm?.id) && style.trim() ? `⟦style: ${style.trim().replace(/⟧/g, '')}⟧ ${script.trim()}` : script.trim()
        const item = await api.speech({ text, model: vm?.id, voice: v || undefined, source: 'audio' })
        onMediaCreated(item)
      } else if (tab === 'music') {
        if (!musicPrompt.trim() && !genres.length) throw new Error(t('Describe the music or pick a genre.'))
        const item = await api.cloudMusic({ model: mm?.id || 'google/lyria-3-clip-preview', prompt: musicText(), source: 'audio' })
        setLastLyrics(item.lyrics || '')
        onMediaCreated(item)
      } else {
        if (!sfxPrompt.trim()) throw new Error(t('Describe the sound.'))
        if (!sm) throw new Error(t('No sound-effect model is available right now.'))
        const item = await api.speech({ text: sfxText(), model: sm.id, voice: sm.voices[0], purpose: 'sfx', source: 'audio' })
        onMediaCreated(item)
      }
      refreshCloud()
    } catch (e) {
      activity.end(activityId, { ok: false })
      setError(String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy((p) => ({ ...p, [tab]: Math.max(0, p[tab] - 1) }))
      activity.end(activityId)
    }
  }

  const TABS: { id: Tab; label: string; icon: typeof Mic2 }[] = [
    { id: 'voice', label: 'Voiceover', icon: Mic2 },
    { id: 'music', label: 'Music', icon: Music },
    { id: 'sfx', label: 'Sound effects', icon: Waves },
  ]

  return (
    <main className="studio audio-studio" style={visible ? undefined : { display: 'none' }}>
      <header className="studio-top">
        <div className="flex min-w-0 items-center gap-2">
          <button className="creative-topbar-button" onClick={onBack} aria-label={t('Back to chats')}>
            <ChevronLeft size={17} />
          </button>
          <span className="studio-title">{t('Audio')}</span>
          <nav className="studio-tabs" role="tablist">
            {TABS.map((x) => (
              <button key={x.id} role="tab" aria-selected={tab === x.id} className={`${tab === x.id ? 'active' : ''} ${busy[x.id] ? 'task-heartbeat' : ''}`} onClick={() => (setTab(x.id), setError(''))}>
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
                  <label className="audio-label">
                    {t('Voice')} <span className="audio-label-note">{t('{n} voices', { n: vm.voices.length })}</span>
                  </label>
                  <VoicePicker key={vm.id} model={vm.id} voices={vm.voices} value={v} onChange={setVoice} />
                </>
              )}
              {takesStyle(vm?.id) ? (
                <>
                  <label className="audio-label">{t('Delivery (tone, pace, emotion)')}</label>
                  <input className="ab-input" value={style} onChange={(e) => setStyle(e.target.value)} placeholder={t('e.g. warm and friendly, a little faster')} maxLength={300} />
                  <div className="audio-ideas audio-chips">
                    {STYLES.map((x) => (
                      <button key={x} aria-pressed={style === x} className={style === x ? 'active' : ''} onClick={() => setStyle(style === x ? '' : x)}>
                        {t(x)}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="studio-hint">{t('This model reads directions inside the text, like [whispering], [laughs] or [excited].')}</p>
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
              <label className="audio-label">{t('Music model')}</label>
              {musicItems.length ? <ModelSelect items={musicItems} value={mm?.id} onPick={setMusicModel} icon={<Music size={14} />} /> : <p className="studio-hint">{t('Sign in to your Orbi account to see the models.')}</p>}
              <label className="audio-label">{t('Style')}</label>
              <Chips options={GENRES} value={genres} onChange={setGenres} multi />
              <label className="audio-label">{t('Mood')}</label>
              <Chips options={MOODS} value={moods} onChange={setMoods} multi />
              <label className="audio-label">
                {t('Tempo')} <span className="audio-label-note num">{bpm ? `${bpm} BPM` : t('model decides')}</span>
              </label>
              <input type="range" className="audio-range" min={0} max={180} step={5} value={bpm} onChange={(e) => setBpm(Number(e.target.value) < 60 ? 0 : Number(e.target.value))} aria-label={t('Tempo')} />
              {fullSong && (
                <>
                  <label className="audio-label">{t('Length')}</label>
                  <Chips options={LENGTHS.map((s) => (s ? `~${s / 60} min` : 'Model decides'))} value={[length ? `~${length / 60} min` : 'Model decides']} onChange={(x) => setLength(x[0] === 'Model decides' || !x[0] ? 0 : Number(x[0].replace(/\D/g, '')) * 60)} />
                </>
              )}
              <label className="audio-label">{t('Vocals')}</label>
              <Chips options={VOCALS} value={[vocals]} onChange={(x) => setVocals(x[0] || 'Instrumental')} />
              {vocals !== 'Instrumental' && (
                <>
                  <label className="audio-label">{t('Language of the lyrics')}</label>
                  <Chips options={LANGUAGES} value={[language]} onChange={(x) => setLanguage(x[0] || 'Any language')} />
                  <label className="audio-label">{t('Lyrics (optional)')}</label>
                  <div className="audio-ideas audio-sections">
                    {SECTIONS.map((x) => (
                      <button key={x} onClick={() => insertSection(x)} title={t('Insert {tag}', { tag: x })}>
                        {x}
                      </button>
                    ))}
                  </div>
                  <AutoTextarea ref={lyricsBox} className="studio-prompt" rows={6} value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder={t('Write the lyrics, or leave empty and the model writes them.')} />
                </>
              )}
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
              <label className="audio-label">
                {t('Duration')} <span className="audio-label-note num">{t('{n} s', { n: sfxSeconds })}</span>
              </label>
              <input type="range" className="audio-range" min={1} max={20} value={sfxSeconds} onChange={(e) => setSfxSeconds(Number(e.target.value))} aria-label={t('Duration')} />
              <p className="studio-hint">{t('The model treats the duration as a guide, so the result can be a little shorter or longer.')}</p>
              <label className="audio-label">{t('Intensity')}</label>
              <Chips options={INTENSITY} value={intensity} onChange={(x) => setIntensity(x.length ? x : ['Medium'])} />
              <label className="audio-label">{t('Space')}</label>
              <Chips options={SPACES} value={space} onChange={setSpace} />
              <label className="studio-check">
                <input type="checkbox" checked={sfxLoop} onChange={(e) => setSfxLoop(e.target.checked)} /> {t('Seamless loop')}
              </label>
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
            <button className="orbi-btn orbi-btn-primary" onClick={run} >
              {busy[tab] ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {t('Generate')} {busy[tab] > 0 && <span className="num">{busy[tab]}</span>}
            </button>
          </div>
          {busy.music > 0 && <p className="studio-hint">{t('Music takes up to a minute.')}</p>}
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
