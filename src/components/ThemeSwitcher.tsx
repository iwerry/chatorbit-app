import type { Dispatch, SetStateAction } from 'react'
import { Moon, SquareTerminal, Sun } from 'lucide-react'
import { t } from '../lib/i18n'

export type ThemeMode = 'light' | 'dark' | 'terminal'

export function ThemeSwitcher({ themeMode, setThemeMode }: { themeMode: ThemeMode; setThemeMode: Dispatch<SetStateAction<ThemeMode>> }) {
  return (
    <div className="theme-switcher" aria-label={t('Interface theme')}>
      <button className={themeMode === 'light' ? 'theme-option-active' : ''} onClick={() => setThemeMode('light')} aria-label={t('Light theme')} aria-pressed={themeMode === 'light'} title={t('Light')}>
        <Sun size={13} />
      </button>
      <button className={themeMode === 'dark' ? 'theme-option-active' : ''} onClick={() => setThemeMode('dark')} aria-label={t('Dark theme')} aria-pressed={themeMode === 'dark'} title={t('Dark')}>
        <Moon size={13} />
      </button>
      <button className={themeMode === 'terminal' ? 'theme-option-active' : ''} onClick={() => setThemeMode('terminal')} aria-label={t('Terminal theme')} aria-pressed={themeMode === 'terminal'} title={t('Terminal')}>
        <SquareTerminal size={14} />
      </button>
    </div>
  )
}
