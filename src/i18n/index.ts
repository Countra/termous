import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from './resources'
import type { Language } from '../types/domain'

const browserLanguage = navigator.language === 'zh-CN' || navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US'

void i18n.use(initReactI18next).init({
  resources,
  lng: browserLanguage,
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false,
  },
})

export function changeLanguage(language: Language) {
  return i18n.changeLanguage(language)
}

export { i18n }

