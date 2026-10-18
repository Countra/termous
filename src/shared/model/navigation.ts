export type PageKey = 'workbench' | 'agent' | 'remote-desktop' | 'hosts' | 'vault' | 'files' | 'mounts' | 'forwards' | 'snippets' | 'audit' | 'account'

// 设置是覆盖当前页面的入口，不参与主页面生命周期。
export type NavigationTarget = PageKey | 'settings'
