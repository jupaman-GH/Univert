import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { toast } from 'sonner'

export type Appearance = {
  /** 0 = opaca, 1 = totalmente transparente. */
  transparency: number
  /** Color de fondo hexadecimal, p. ej. "#0b0f14". */
  color: string
  /** Nivel de blur del fondo (px). Cero desactiva el efecto acrílico. */
  blur: number
  /** Color lateral (titlebar y sidebar), hexadecimal. */
  barColor: string
  /** Color de acento (botones seleccionados, sliders, foco), hexadecimal. */
  accent: string
}

const DEFAULT_APPEARANCE: Appearance = {
  transparency: 0,
  color: '#0b0f14',
  blur: 0,
  barColor: '#0f1620',
  // Equivalente hex de oklch(0.75 0.18 195): el cian original del tema.
  accent: '#00cfd1'
}

/** Color de texto legible sobre el acento dado (claro u oscuro). */
function readableOn(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!match) return '#0b0f14'
  const value = parseInt(match[1], 16)
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff].map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  // Corte calibrado con los presets: negro sobre cian/amarillo/naranja/verde,
  // blanco sobre rojo (y acentos oscuros personalizados).
  return luminance > 0.3 ? '#0b0f14' : '#f8fafc'
}

type AppearanceContextValue = {
  appearance: Appearance
  setAppearance: (appearance: Partial<Appearance>) => void
  resetAppearance: () => void
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null)

export function AppearanceProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [appearance, setAppearanceState] = useState<Appearance>(DEFAULT_APPEARANCE)

  const setAppearance = useCallback((partial: Partial<Appearance>) => {
    setAppearanceState((previous) => ({ ...previous, ...partial }))
  }, [])

  const resetAppearance = useCallback(() => {
    setAppearanceState(DEFAULT_APPEARANCE)
  }, [])

  // Sincroniza con el proceso main (color con alfa vía setBackgroundColor) y con el
  // CSS del renderer (blur del fondo) en cada cambio, para feedback en vivo.
  useEffect(() => {
    void window.api.window.setAppearance({
      transparency: 1 - appearance.transparency,
      color: appearance.color,
      blur: appearance.blur
    })
    document.documentElement.style.setProperty('--window-blur', `${appearance.blur}px`)
    // Color lateral disponible para el titlebar y el sidebar vía var(--bar-color).
    document.documentElement.style.setProperty('--bar-color', appearance.barColor)
    // Color de acento: sobrescribe las variables del tema que usan los botones
    // seleccionados, los sliders, los focos y los brillos (todos via var(--primary)).
    document.documentElement.style.setProperty('--primary', appearance.accent)
    document.documentElement.style.setProperty('--ring', appearance.accent)
    document.documentElement.style.setProperty('--primary-foreground', readableOn(appearance.accent))
  }, [appearance])

  const value = useMemo(
    () => ({ appearance, setAppearance, resetAppearance }),
    [appearance, setAppearance, resetAppearance]
  )

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext)
  if (!context) {
    throw new Error('useAppearance debe usarse dentro de AppearanceProvider')
  }
  return context
}

/** Guarda la configuración con confirmación visual. */
export function saveAppearanceWithToast(save: () => void): void {
  save()
  toast.success('Apariencia guardada')
}
