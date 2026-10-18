import type { ReactNode } from 'react'
import { App, ConfigProvider } from 'antd'
import { render, type RenderOptions } from '@testing-library/react'

export function renderWithFeedback(ui: ReactNode, options?: RenderOptions) {
  const Wrapper = options?.wrapper
  return render(ui, { ...options, wrapper: ({ children }) => <ConfigProvider theme={{ token: { motion: false } }}><App>{Wrapper ? <Wrapper>{children}</Wrapper> : children}</App></ConfigProvider> })
}
