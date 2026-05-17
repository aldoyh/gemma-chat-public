import { useI18n } from '../i18n/useI18n'

export default function LanguageSwitcher() {
  const { language, setLanguage } = useI18n()

  return (
    <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
      <button
        onClick={() => setLanguage('en')}
        className={`px-3 py-1.5 rounded text-sm font-medium transition ${
          language === 'en'
            ? 'bg-white/20 text-white'
            : 'text-ink-400 hover:text-white'
        }`}
      >
        E
      </button>
      <button
        onClick={() => setLanguage('ar')}
        className={`px-3 py-1.5 rounded text-sm font-medium transition ${
          language === 'ar'
            ? 'bg-white/20 text-white'
            : 'text-ink-400 hover:text-white'
        }`}
        style={{ fontFamily: language === 'ar' ? 'Tajawal' : 'inherit' }}
      >
        ع
      </button>
    </div>
  )
}
