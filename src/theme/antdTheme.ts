import type { ThemeConfig } from 'antd'
import { theme as antdTheme } from 'antd'
import type { ThemeMode } from '../types/domain'

const fontFamily =
  '"Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif'

const codeFontFamily = '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace'

export function createAntdTheme(mode: ThemeMode): ThemeConfig {
  const dark = mode === 'dark'

  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: dark ? '#6aa8ff' : '#1f6feb',
      colorInfo: dark ? '#6aa8ff' : '#1f6feb',
      colorSuccess: dark ? '#35c78a' : '#12835a',
      colorWarning: dark ? '#e7b552' : '#9b6306',
      colorError: dark ? '#ff6b63' : '#c9353f',
      colorBgBase: dark ? '#0f1116' : '#f4f5f7',
      colorTextBase: dark ? '#f4f6fb' : '#151a22',
      borderRadius: 10,
      borderRadiusLG: 14,
      borderRadiusSM: 7,
      controlHeight: 36,
      controlHeightLG: 42,
      controlHeightSM: 30,
      fontFamily,
      fontFamilyCode: codeFontFamily,
      fontSize: 13,
      lineWidth: 1,
      motionDurationFast: '0.12s',
      motionDurationMid: '0.18s',
      motionEaseOut: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      zIndexBase: 0,
      zIndexPopupBase: 3000,
    },
    components: {
      Button: {
        borderRadius: 9,
        controlHeight: 34,
        defaultBg: dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(20, 28, 42, 0.055)',
        defaultBorderColor: dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(30, 42, 58, 0.13)',
        defaultColor: dark ? '#f4f6fb' : '#151a22',
        primaryShadow: 'none',
      },
      Input: {
        activeShadow: '0 0 0 3px rgba(31, 111, 235, 0.14)',
        borderRadius: 9,
      },
      InputNumber: {
        activeShadow: '0 0 0 3px rgba(31, 111, 235, 0.14)',
        borderRadius: 9,
      },
      Modal: {
        borderRadiusLG: 16,
        contentBg: dark ? '#1d2028' : '#ffffff',
        headerBg: dark ? '#1d2028' : '#ffffff',
        titleFontSize: 16,
      },
      Select: {
        borderRadius: 9,
        selectorBg: dark ? 'rgba(255, 255, 255, 0.055)' : 'rgba(20, 28, 42, 0.04)',
        optionActiveBg: dark ? 'rgba(255, 255, 255, 0.075)' : 'rgba(20, 28, 42, 0.055)',
        optionSelectedBg: dark ? 'rgba(255, 255, 255, 0.105)' : 'rgba(20, 28, 42, 0.075)',
        optionSelectedColor: dark ? '#f4f6fb' : '#151a22',
        multipleItemBg: dark ? 'rgba(255, 255, 255, 0.075)' : 'rgba(20, 28, 42, 0.06)',
        multipleItemBorderColor: dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(30, 42, 58, 0.12)',
      },
      Segmented: {
        itemActiveBg: dark ? 'rgba(106, 168, 255, 0.18)' : 'rgba(31, 111, 235, 0.12)',
        itemSelectedBg: dark ? 'rgba(255, 255, 255, 0.12)' : '#ffffff',
        trackBg: dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(20, 28, 42, 0.06)',
      },
      Tag: {
        borderRadiusSM: 999,
      },
    },
  }
}
