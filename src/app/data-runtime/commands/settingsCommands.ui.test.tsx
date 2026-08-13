import { expect, test } from 'vitest'
import type { CompletionSettings, Settings, ShortcutSettingsPatch } from '#common/contracts'
import { SerialMutationQueue } from '#shared/async'
import { initialData } from '../model/appDataState'
import type { SettingsCommandGateway } from '../api/runtimeGatewayContracts'
import { createSettingsCommands } from './settingsCommands'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function createHarness(api: Partial<SettingsCommandGateway>) {
  let data = structuredClone(initialData)
  const completionSettingsMutation = { current: 0 }
  const completionSettingsPendingWrites = { current: 0 }
  const completionSettings = { current: data.settings.completion }
  const confirmedCompletionSettings = { current: data.settings.completion }
  const shortcutSettingsMutation = { current: 0 }
  const shortcutSettingsPendingWrites = { current: 0 }
  const shortcutSettings = { current: data.settings.shortcuts }
  const confirmedShortcutSettings = { current: data.settings.shortcuts }
  const commands = createSettingsCommands({
    api: api as SettingsCommandGateway,
    currentSettings: data.settings,
    setData: (update) => {
      data = typeof update === 'function' ? update(data) : update
    },
    completionSettingsMutation,
    completionSettingsPendingWrites,
    completionSettingsWriteQueue: new SerialMutationQueue(),
    completionSettings,
    confirmedCompletionSettings,
    shortcutSettingsMutation,
    shortcutSettingsPendingWrites,
    shortcutSettingsWriteQueue: new SerialMutationQueue(),
    shortcutSettings,
    confirmedShortcutSettings,
  })

  return {
    commands,
    data: () => data,
  }
}

test('外观设置写入失败时恢复调用前的完整设置快照', async () => {
  const request = deferred<Settings>()
  const harness = createHarness({
    updateAppearanceSettings: () => request.promise,
  })
  const mutation = harness.commands.setAppearanceSettings({ theme: 'light' })

  expect(harness.data().settings.appearance.theme).toBe('light')
  request.reject(new Error('write failed'))
  await expect(mutation).rejects.toThrow('write failed')
  expect(harness.data().settings.appearance.theme).toBe(initialData.settings.appearance.theme)
})

test('较早的补全设置失败不会回退或拒绝较新的乐观写入', async () => {
  const firstRequest = deferred<Settings>()
  const completionA: CompletionSettings = {
    ...initialData.settings.completion,
    enabled: false,
  }
  const completionB: CompletionSettings = {
    ...initialData.settings.completion,
    providers: {
      ...initialData.settings.completion.providers,
      history: false,
    },
  }
  let calls = 0
  const harness = createHarness({
    updateCompletionSettings: async (completion) => {
      calls += 1
      if (calls === 1) {
        return firstRequest.promise
      }
      return { ...harness.data().settings, completion }
    },
  })

  const firstMutation = harness.commands.setCompletionSettings(completionA)
  const secondMutation = harness.commands.setCompletionSettings(completionB)
  firstRequest.reject(new Error('stale write failed'))

  await expect(firstMutation).resolves.toBeUndefined()
  await secondMutation
  expect(harness.data().settings.completion).toEqual(completionB)
})

test('较早的快捷键写入失败仍拒绝对应调用方且保留较新的乐观状态', async () => {
  const firstRequest = deferred<Settings>()
  const patchA: ShortcutSettingsPatch = {
    changes: { 'terminal.copy': { bindings: [] } },
  }
  const patchB: ShortcutSettingsPatch = {
    changes: { 'terminal.paste': { bindings: [] } },
  }
  let calls = 0
  const harness = createHarness({
    updateShortcutSettings: async () => {
      calls += 1
      if (calls === 1) {
        return firstRequest.promise
      }
      return harness.data().settings
    },
  })

  const firstMutation = harness.commands.updateShortcutSettings(patchA)
  const secondMutation = harness.commands.updateShortcutSettings(patchB)
  firstRequest.reject(new Error('stale shortcut write failed'))

  await expect(firstMutation).rejects.toThrow('stale shortcut write failed')
  await secondMutation
  expect(Object.keys(harness.data().settings.shortcuts.overrides).sort()).toEqual([
    'terminal.copy',
    'terminal.paste',
  ])
})
