import { expect, test, vi } from 'vitest'
import { initialData } from '../model/appDataState'
import type { SettingsCommandGateway } from '../api/runtimeGatewayContracts'
import { createSettingsCommands } from './settingsCommands'

test('设置命令转交模块网关，不再写入或回滚整份聚合状态', async () => {
  const setData = vi.fn()
  const updateAppearanceSettings = vi.fn().mockRejectedValue(new Error('保存失败'))
  const api = { updateAppearanceSettings } as unknown as SettingsCommandGateway
  const commands = createSettingsCommands({ api, setData })
  await expect(commands.setAppearanceSettings({ theme: 'light' })).rejects.toThrow('保存失败')
  expect(updateAppearanceSettings).toHaveBeenCalledWith({ theme: 'light' })
  expect(setData).not.toHaveBeenCalled()
})

test('快捷键清除与重置原样转交，不改变领域补丁语义', async () => {
  const updateShortcutSettings = vi.fn().mockResolvedValue(initialData.settings)
  const commands = createSettingsCommands({ api: { updateShortcutSettings } as unknown as SettingsCommandGateway, setData: vi.fn() })
  await commands.updateShortcutSettings({ reset_all: true })
  expect(updateShortcutSettings).toHaveBeenCalledExactlyOnceWith({ reset_all: true })
})

test('删除字体后重新读取设置与资源，由模块订阅更新字体回退值', async () => {
  const api = { deleteTerminalFont: vi.fn().mockResolvedValue(undefined), settings: vi.fn().mockResolvedValue(initialData.settings), terminalFonts: vi.fn().mockResolvedValue([]) }
  const setData = vi.fn()
  await createSettingsCommands({ api: api as unknown as SettingsCommandGateway, setData }).deleteTerminalFont('font-1')
  expect(api.deleteTerminalFont).toHaveBeenCalledWith('font-1')
  expect(api.settings).toHaveBeenCalledOnce()
  expect(setData.mock.calls[0][0](initialData)).toEqual({ ...initialData, terminalFonts: [] })
})
