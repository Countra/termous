import type { DesktopSnapshotMetadata } from '#entities/remote-desktop'

export interface Point { x: number; y: number }
export interface Region extends Point { width: number; height: number }
// 模板来源仅用于编辑器回显，不限制运行时的图像查找区域。
export interface TemplateSource { region: Region; reference_width: number; reference_height: number }
export interface ImageTarget {
  asset_id: string
  template_source?: TemplateSource
  region?: Region
  reference_width?: number
  reference_height?: number
  scales?: number[]
  threshold?: number
  anchor?: Point
  offset: Point
}
export interface Target extends Partial<Point> {
  kind: 'point' | 'image'
  reference_width?: number
  reference_height?: number
  image?: ImageTarget
}
export interface Action {
  button?: string; count?: number; delta?: number; horizontal?: boolean
  points?: Point[]; duration_ms?: number; code?: string; codes?: string[]
  text?: string; width?: number; height?: number
}
export const stepKinds = ['pointer.click', 'pointer.move', 'pointer.scroll', 'pointer.drag', 'keyboard.key', 'keyboard.shortcut', 'keyboard.text', 'clipboard.set_text', 'resize', 'capture', 'delay', 'image.wait', 'image.assert', 'if', 'repeat', 'breakpoint'] as const
export type StepKind = typeof stepKinds[number]
export interface Step {
  id: string; name: string; kind: StepKind; disabled?: boolean; action: Action
  target?: Target; end_target?: Target; image?: ImageTarget; absent?: boolean
  timeout_ms?: number; delay_ms?: number; iterations?: number
  bindings?: Record<string, string>; steps?: Step[]; else?: Step[]
}
export interface Parameter {
  id: string; name: string; type: 'string' | 'number' | 'boolean'
  sensitive?: boolean; default?: string | number | boolean
}
export interface Definition { schema_version: 1; parameters: Parameter[]; steps: Step[] }
export interface Author { origin: 'app' | 'mcp'; client_id?: string; client_name?: string; client_source?: 'external' | 'builtin_agent' }
export interface Script { origin?: 'app' | 'mcp'; creator?: Author; id: string; name: string; description: string; tags: string[]; revision: number; created_at: string; updated_at: string }
export interface Version { author?: Author; name?: string; description?: string; tags?: string[]; script_id: string; number: number; definition: Definition; created_at: string }
export interface SaveInput { expected_revision: number; name: string; description: string; tags: string[]; definition: Definition }
export interface Diagnostic { step_id?: string; field: string; code: string }
export interface Asset { id: string; run_id?: string; sha256: string; width: number; height: number; size: number; created_at: string }
export interface Run {
	 origin?: 'app' | 'mcp'; initiator?: Author
  id: string; script_id: string; version: number; name: string; state: string; phase: string
  session_id?: string; target_name?: string; protocol?: string; step_id?: string
  executed: number; assertions: number; revision: number; error_code?: string; cleanup_error?: string
  started_at: string; finished_at?: string
}
export interface StepResult {
  run_id: string; index: number; step_id: string; occurrence: string; kind: StepKind; state: string
  error_code?: string; asset_id?: string; evidence_cleared?: boolean; started_at: string; finished_at?: string
}
export interface StartInput {
  script_id: string; version: number; request_id: string; session_id?: string; connection_generation?: number
  profile_id?: string; keep_connection?: boolean; takeover: boolean; debug: boolean
  parameters: Record<string, string | number | boolean>
}
export interface Preview { id: string; state: string; reason?: string }
export interface Candidate extends Region { score: number; scale: number }
export interface Located { capture: { metadata: DesktopSnapshotMetadata }; result: { state: string; candidates: Candidate[] }; image: Blob }
export interface Snapshot { metadata: DesktopSnapshotMetadata; blob: Blob }

export interface WorkflowGateway {
  list(signal?: AbortSignal): Promise<Script[]>
  get(id: string): Promise<{ script: Script; version: Version }>
  save(id: string | undefined, input: SaveInput): Promise<Script>
  remove(id: string, revision: number): Promise<void>
  versions(id: string): Promise<Version[]>
  restore(id: string, version: number, expectedRevision: number): Promise<Script>
  validate(definition: Definition): Promise<Diagnostic[]>
  upload(file: Blob): Promise<Asset>
  asset(id: string, signal?: AbortSignal): Promise<Blob>
  openPreview(session: string, generation: number): Promise<Preview>
  closePreview(id: string): Promise<void>
  capture(id: string, signal?: AbortSignal): Promise<Snapshot>
  match(id: string, target: ImageTarget, signal?: AbortSignal): Promise<Located>
  listRuns(signal?: AbortSignal): Promise<Run[]>
  run(id: string, signal?: AbortSignal): Promise<{ run: Run; steps: StepResult[] }>
  start(input: StartInput): Promise<Run>
  control(id: string, requestID: string, action: 'pause' | 'resume' | 'step' | 'cancel'): Promise<Run>
  eventsURL(): string
}
