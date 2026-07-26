import { useEffect, useMemo, type ReactNode } from 'react'
import { App as AntdApp, ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import { i18n } from '../i18n'
import { createAntdTheme } from '../theme/antdTheme'
import type { Language, ThemeMode } from '../types/domain'

interface TermousUiProviderProps {
  children: ReactNode
  language: Language
  theme: ThemeMode
}

export function TermousUiProvider({ children, language, theme }: TermousUiProviderProps) {
  const antdTheme = useMemo(() => createAntdTheme(theme), [theme])
  const antdLocale = language === 'zh-CN' ? zhCN : enUS

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    void i18n.changeLanguage(language)
  }, [language])

  return (
    <ConfigProvider locale={antdLocale} theme={antdTheme} button={{ autoInsertSpace: false }}>
      <AntdApp
        className="termous-antd-root"
        notification={{
          placement: 'topRight',
          duration: 3,
          maxCount: 3,
          showProgress: true,
          pauseOnHover: true,
        }}
      >
        {children}
      </AntdApp>
    </ConfigProvider>
  )
}
