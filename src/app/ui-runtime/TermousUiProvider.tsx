import { useEffect, useMemo, type ReactNode } from 'react'
import { App as AntdApp, ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import { i18n, type Language } from '#shared/i18n'
import { createAntdTheme, type ThemeMode } from '#shared/theme'
import { termousPopconfirmProps } from '#shared/ui'

interface TermousUiProviderProps {
  children: ReactNode
  language: Language
  theme: ThemeMode
}

// 配置引用决定通知接口的身份；普通重绘不能重建接口并复活已关闭的消息。
const notificationConfig = {
  placement: 'topRight',
  duration: 3,
  maxCount: 3,
  showProgress: true,
  pauseOnHover: true,
} as const

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
    <ConfigProvider locale={antdLocale} theme={antdTheme} button={{ autoInsertSpace: false }} popconfirm={termousPopconfirmProps}>
      <AntdApp
        className="termous-antd-root"
        notification={notificationConfig}
      >
        {children}
      </AntdApp>
    </ConfigProvider>
  )
}
