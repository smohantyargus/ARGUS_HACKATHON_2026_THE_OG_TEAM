import { createContext, useContext, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
export type ResolvedTheme = Theme

interface ThemeCtx {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
  toggle: () => void
}

const THEME_STORAGE_KEY = 'haidoc-theme'
const ThemeContext = createContext<ThemeCtx | undefined>(undefined)

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const storedTheme = localStorage.getItem(THEME_STORAGE_KEY)
      return isTheme(storedTheme) ? storedTheme : 'light'
    } catch {
      return 'light'
    }
  })
  const resolvedTheme = theme

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Theme still works when storage is unavailable.
    }
  }, [theme])

  const toggle = () => setTheme(current => (current === 'light' ? 'dark' : 'light'))

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}


export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
