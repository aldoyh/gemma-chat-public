import { createContext, useContext, useState, type ReactNode } from 'react'
import { en } from './en'
import { ar } from './ar'

export type Language = 'en' | 'ar'

interface I18nContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: typeof en
}

const I18nContext = createContext<I18nContextType | undefined>(undefined)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>('en')

  const t = language === 'ar' ? ar : en

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return context
}
