// CodeMirror 面板使用原生 DOM，图标沿用应用的 24px 画布与描边风格，避免文字基线造成偏移。
const paths = {
  expand: 'm9 18 6-6-6-6',
  previous: 'm5 12 7-7 7 7 M12 19V5',
  next: 'm5 12 7 7 7-7 M12 5v14',
  close: 'm18 6-12 12 M6 6l12 12',
  caseSensitive: 'm2 16 4-10 4 10 M3.2 13h5.6 M22 9v7 M22 12.5a3.5 3.5 0 1 0-7 0 3.5 3.5 0 1 0 7 0',
  wholeWord: 'M10 12a3 3 0 1 0-6 0 3 3 0 1 0 6 0 M10 9v6 M20 12a3 3 0 1 0-6 0 3 3 0 1 0 6 0 M14 7v8 M2 17v2h20v-2',
  regexp: 'M16 3v10 m-4.3-7.5 8.6 5 m-8.6 0 8.6-5 M7 17a1 1 0 1 0-2 0 1 1 0 1 0 2 0',
} as const

export type SearchPanelIcon = keyof typeof paths

export function createSearchPanelIcon(name: SearchPanelIcon) {
  const namespace = 'http://www.w3.org/2000/svg'
  const icon = document.createElementNS(namespace, 'svg')
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', focusable: 'false',
  })) icon.setAttribute(key, value)
  const path = document.createElementNS(namespace, 'path')
  path.setAttribute('d', paths[name])
  icon.append(path)
  return icon
}
