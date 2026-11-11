// Shared by the Audio studio and the Node canvas: how voice, music and sound-effect settings become requests.
// Lyria and Seed Audio take their settings as plain directions in the prompt; voice delivery travels as a
// "⟦style: …⟧" prefix that the orbi function turns into OpenRouter `instructions`.

// The server recognises exactly this sentence (supabase/functions/orbi/openrouter.ts sampleText) and serves
// one stored, free preview per voice.
export const sampleText = (voice: string) => `Hi! This is ${voice.replace(/:.*$/, '').replace(/^English_/, '').replace(/[_-]+/g, ' ')}, one of the voices you can use in Orbi.`
export const voiceName = (voice: string) => voice.replace(/:.*$/, '').replace(/_/g, ' ')
// Models that follow spoken delivery directions; the others read [tags] inside the text.
export const takesStyle = (id = '') => /^google\/.*tts|^fish-audio\/|^openai\/.*tts/.test(id)
export const withStyle = (model: string | undefined, style: string, text: string) => (takesStyle(model) && style.trim() ? `⟦style: ${style.trim().replace(/⟧/g, '')}⟧ ${text}` : text)
export const STYLES = ['Warm and friendly', 'Excited and upbeat', 'Calm narrator', 'Whispering', 'Serious news anchor', 'Slow and clear']

export const GENRES = ['Pop', 'Rock', 'Hip hop', 'Lo-fi', 'Electronic', 'Bossa nova', 'Samba', 'Sertanejo', 'Funk', 'Jazz', 'Classical', 'Cinematic', 'Ambient', 'R&B', 'Reggae']
export const MOODS = ['Happy', 'Calm', 'Epic', 'Dark', 'Romantic', 'Energetic', 'Melancholic', 'Mysterious']
export const VOCALS = ['Instrumental', 'Female vocals', 'Male vocals', 'Duet', 'Choir'] as const
export const LANGUAGES = ['Any language', 'Portuguese', 'English', 'Spanish', 'French'] as const
export const SECTIONS = ['[Intro]', '[Verse]', '[Pre-chorus]', '[Chorus]', '[Bridge]', '[Outro]']
export const SPACES = ['Dry studio', 'Small room', 'Large hall', 'Outdoors', 'Underwater', 'Far away']
export const INTENSITY = ['Soft', 'Medium', 'Intense'] as const

export type MusicSettings = { description: string; genres: string[]; moods: string[]; bpm: number; vocals: string; language: string; length: number; lyrics: string; fullSong: boolean }
export function musicPrompt(s: MusicSettings) {
  const sing = s.vocals !== 'Instrumental'
  return [
    s.description.trim(),
    s.genres.length ? `Genre: ${s.genres.join(', ')}.` : '',
    s.moods.length ? `Mood: ${s.moods.join(', ').toLowerCase()}.` : '',
    s.bpm ? `Tempo: about ${s.bpm} BPM.` : '',
    sing ? `Vocals: ${s.vocals.toLowerCase()}.` : 'Instrumental only, no vocals.',
    sing && s.language !== 'Any language' ? `Sing in ${s.language}.` : '',
    s.fullSong && s.length ? `Length: about ${s.length / 60} minute${s.length > 60 ? 's' : ''}.` : '',
    sing && s.lyrics.trim() ? `Lyrics (sing these words; the [tags] mark the song structure):\n${s.lyrics.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export type SfxSettings = { description: string; seconds: number; intensity: string; space: string; loop: boolean }
export const sfxPrompt = (s: SfxSettings) =>
  [
    `Sound effect only, no speech, no music: ${s.description.trim()}.`,
    `About ${s.seconds} second${s.seconds > 1 ? 's' : ''} long.`,
    s.intensity && s.intensity !== 'Medium' ? `${s.intensity} intensity.` : '',
    s.space ? `Acoustics: ${s.space.toLowerCase()}.` : '',
    s.loop ? 'Seamless loop: no fade in or out, the end joins the start.' : '',
  ]
    .filter(Boolean)
    .join(' ')

// Previews already heard this session (model|voice → audio data URL).
export const sampleCache = new Map<string, string>()
