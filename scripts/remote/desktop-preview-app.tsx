import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, ConfigProvider } from 'antd'
import { Monitor, PanelLeftClose, Unplug } from 'lucide-react'
import { create } from '@bufbuild/protobuf'
import { DesktopSourceSchema, DesktopTargetSchema } from '@termous/remote-protocol/desktop-protocol'
import { DesktopPresentationPreferences } from '@termous/remote-protocol/presentation'
import { TermousUiProvider } from '#app/ui-runtime'
import { DesktopPresentationControls } from '#entities/desktop-presentation'
import type { RemoteDesktopMediaDetails } from '#entities/remote-desktop'
import type { RemoteClient } from '#entities/remote-control'
import { RemoteHostDesktop, remoteCopy } from '#features/remote-control'
import { desktopCopy } from '../../src/features/remote-control/model/desktopCopy'
import { RemoteDesktopToolbar } from '../../src/features/remote-control/ui/desktop/RemoteDesktopToolbar'
import { DesktopMediaStatusBar } from '../../src/features/remote-control/ui/desktop/DesktopMediaStatusBar'
import { RemoteConnectionStatus } from '../../src/widgets/remote-workbench/ui/RemoteConnectionStatus'
import { createPreview } from './previewBridge'
import desktopStyles from '../../src/features/remote-control/ui/RemoteDesktop.module.scss'
import workbenchStyles from '../../src/widgets/remote-workbench/ui/RemoteWorkbench.module.scss'
import styles from './desktop-preview.module.scss'

// 视觉夹具只装配真实界面组件与合成指标，不读取账号、设备凭据或本机文件。
const query = new URLSearchParams(location.search)
const zh = !query.has('en')
const copy = desktopCopy(zh)
const { bridge, bootstrap } = createPreview(query)
const media: RemoteDesktopMediaDetails = {
  connectionId: 'preview', title: zh ? '开发工作站 · 显示器 1' : 'Workstation · Display 1', phase: 'viewing', transport: 'h264',
  presentation: {
    capabilities: { kind: 'video', available: true, dynamicSize: true, maxBitrate: 100_000_000, maxFramerate: 60, videoLimitsVersion: 3,
      videoModes: [[1280, 720], [1920, 1080], [2560, 1440]].map(([maxWidth, maxHeight]) => ({ maxWidth, maxHeight, maxFramerate: 60, maxBitrate: 100_000_000 })) },
    requested: { kind: 'video', size: '1080p', framerate: 60, bitrate: 16_000_000 },
    status: 'confirmed', revision: 1n, configRevision: 1n,
    codec: { negotiated: { mimeType: 'video/H264', profile: 'constrained_baseline', receiverLevel: 51, negotiatedLevel: 51, packetizationMode: 1, profileLevelId: '42e033' }, applied: { configRevision: 1n, level: 42 } },
    applied: { width: 1920, height: 1080, framerate: 60, bitrate: 16_000_000 },
    transport: { revision: 1n, path: 'relay', bitrateLimit: 100_000_000 },
  },
  sample: { attachmentId: 'preview', mediaGeneration: 1n, sampledAt: 1000, path: 'relay', protocol: 'udp', localRelayProtocol: 'udp', rttMs: 24, bitrate: 8_420_000, framerate: 59.8, width: 1920, height: 1080, lossPerMille: 0, jitterMs: 1.2 },
}
const sourceClient = {
  connection: { id: 'preview' }, bridge: {}, hostPresentations: new DesktopPresentationPreferences(), onEvent: () => () => {},
  desktop: async ({ action }: { action: string }) => {
    if (action !== 'sources') throw new Error('desktop_access_denied')
    return { sources: [create(DesktopSourceSchema, { title: 'Display 1', target: create(DesktopTargetSchema, { kind: 'host_desktop', instanceId: 'preview', sourceId: 'display-1', sourceKind: 'screen', sourceGeneration: 1n }) })] }
  },
} as unknown as RemoteClient

function Preview() {
  const root = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(true)
  const [owned, setOwned] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [tool, setTool] = useState<string>()
  const getContainer = useCallback(() => {
    const target = root.current
    return target && document.fullscreenElement === target ? target : document.body
  }, [])
  const [connection, setConnection] = useState<Awaited<ReturnType<typeof bridge.connection>>>()
  useEffect(() => {
    document.body.dataset.termousRemoteSurface = 'true'
    void bridge.connection().then(setConnection)
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === root.current)
    document.addEventListener('fullscreenchange', syncFullscreen)
    return () => document.removeEventListener('fullscreenchange', syncFullscreen)
  }, [])
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen()
      else await root.current?.requestFullscreen()
    } catch {
      setTool('fullscreen')
    }
  }
  if (!connection) return null
  return <div className={workbenchStyles.workbench}>
    <header className={workbenchStyles.header}>
      <PanelLeftClose size={18} />
      <div className={workbenchStyles.identity}><span className={workbenchStyles['device-icon']}><Monitor size={18} /></span><div><strong>Termous Workstation</strong><small>{zh ? '远程控制' : 'Remote control'}</small></div></div>
      <RemoteConnectionStatus connection={connection.ok ? connection.value : undefined} ready closed={false} path={zh ? 'P2P 直连' : 'P2P direct'} media={media} zh={zh} copy={remoteCopy(bootstrap.language)} />
      <Button icon={<Unplug size={14} />}>{zh ? '断开连接' : 'Disconnect'}</Button>
    </header>
    <div className={`${styles.workspace} ${query.has('split') ? styles.split : ''}`}>
    <div className={styles.pane}>
    {query.has('source') ? <RemoteHostDesktop client={sourceClient} active /> : <ConfigProvider getPopupContainer={getContainer}>
      <div ref={root} className={`${desktopStyles.desktop} ${styles.desktop}`}>
        <RemoteDesktopToolbar copy={copy} label="RDP" status={owned ? copy.control : copy.watching} viewing holdsControl={owned} controlAvailable working={false} keyboardAvailable={owned} clipboardAvailable={owned} fit={fit} fullscreen={fullscreen}
          onControl={() => setOwned(!owned)} onScale={setFit} onTool={setTool} onFullscreen={() => { void toggleFullscreen() }}
          presentation={<DesktopPresentationControls getContainer={getContainer} state={media.presentation} scale={fit ? 'fit' : 'actual'} onScale={value => setFit(value === 'fit')} onChange={() => {}} />}
        />
        <div className={`${desktopStyles.surface} ${styles.surface}`}>
          <div className={styles.poster}><Monitor size={44} strokeWidth={1} /><strong>{zh ? '远程桌面画面' : 'Remote desktop'}</strong><span>1920 × 1080</span></div>
          {tool && <p className={styles.notice}>{tool === 'fullscreen' ? (zh ? '当前浏览器未授权全屏' : 'Full screen is unavailable in this browser') : tool === 'text' ? copy.keyboard : copy.clipboard}<button onClick={() => setTool(undefined)}>×</button></p>}
        </div>
        <DesktopMediaStatusBar value={media} copy={copy} zh={zh} getContainer={getContainer} />
      </div>
    </ConfigProvider>}
    </div>
    {query.has('split') ? <div className={styles.adjacent}>{zh ? '另一工作区' : 'Another workspace'}</div> : null}
    </div>
  </div>
}

export function RemoteDesktopPreviewApp() {
  return <TermousUiProvider language={bootstrap.language} theme={bootstrap.theme}><Preview /></TermousUiProvider>
}
