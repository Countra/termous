// 桌面动词索引区分名称相近但副作用相反的操作；其他领域继续按各自名称和说明检索。
const operations: Array<{ words: RegExp; names: string[] }> = [
  { words: /\bacquire\b|申请控制|取得控制|获取控制|接管/iu, names: ['control.acquire'] },
  { words: /\brelease\b|归还|释放/iu, names: ['release'] },
  { words: /\battach\b|(?<!解除|取消|释放)(?:附着|挂接)/iu, names: ['attach'] },
  { words: /\bdetach\b|解除附着|取消挂接|释放附着/iu, names: ['detach'] },
  { words: /\bconnect\b|连接/iu, names: ['connect'] },
  { words: /\b(?:capture|screenshot)\b|截图|截屏/iu, names: ['capture', 'captures.create'] },
  { words: /\bclick\b|点击|单击|双击/iu, names: ['pointer.click'] },
  { words: /\bshortcut\b|快捷键|组合键/iu, names: ['keyboard.shortcut'] },
  { words: /输入文字|输入文本/iu, names: ['keyboard.text'] },
  { words: /\b(?:get|list|search)\b|查询|列出|搜索/iu, names: ['get', 'list', 'search'] },
]

interface SearchEntry { original: string; group: string; keywords: string; tool: { name: string; description: string } }
export interface DiscoveryInput { query?: string; group?: string; names?: string[] }

export function scoreToolEntry(entry: SearchEntry, args: DiscoveryInput) {
  if (args.names?.length) return args.names.includes(entry.original) || args.names.includes(entry.tool.name) ? 10000 : 0
  if (args.group && args.group !== entry.group) return 0
  const query = (args.query ?? '').trim().toLowerCase()
  const original = entry.original.toLowerCase()
  if (query === original || query === entry.tool.name.toLowerCase()) return 10000
  const visual = visualOperations(query, args.group)
  if (visual && !visual.some((name) => original === `termous.desktop_workflows.${name}`)) return 0
  const desktopIntent = !visual && (args.group?.startsWith('desktop_') || /desktops\.|桌面|控制权|申请控制|取得控制|获取控制|接管|附着|挂接/u.test(query))
  const intents = desktopIntent ? operations.filter((operation) => operation.words.test(query)) : []
  const actionMatches = intents.filter((intent) => intent.names.some((name) => original.endsWith(`.${name}`))).length
  if (intents.length && !actionMatches) return 0
  const tokens = query.split(/[\s,，。/]+/u).filter(Boolean)
  const words = entry.keywords.toLowerCase().split(' ')
  const score = tokens.reduce((sum, token) => {
    if (original.split('.').includes(token)) return sum + 20
    if (entry.tool.description.toLowerCase().includes(token)) return sum + 3
    return sum + (entry.keywords.toLowerCase().includes(token) || words.some((word) => word.length > 1 && token.includes(word)) ? 1 : 0)
  }, 0)
  return (args.group === entry.group ? 100 : 0) + (visual ? 200 : 0) + actionMatches * 200 + score
}

function visualOperations(query: string, group?: string): string[] | undefined {
  const snapshot = /\bsnapshots?\b|captures?\.|快照/u.test(query)
  const template = /\btemplates?\b|模板/u.test(query)
  if (!snapshot && !template && group !== 'workflow_templates') return undefined
  // 先辨认资源，再辨认明确动作；“释放快照”中的资源名不能把创建工具也选进来。
  if (/\b(?:release|discard)\b|释放|丢弃/u.test(query)) return [snapshot ? 'captures.release' : 'templates.discard']
  if (/\b(?:confirm|save)\b|确认|保存/u.test(query)) return ['templates.confirm']
  if (/\b(?:match|locate)\b|匹配|定位/u.test(query)) return ['templates.match']
  if (/\b(?:view|zoom)\b|局部查看|放大/u.test(query)) return ['captures.view']
  if (/\b(?:preview|crop)\b|预览|裁剪/u.test(query)) return ['templates.preview']
  if (/\b(?:create|new|capture|screenshot)\b|创建|新建|重新截|获取快照|截图|截屏/u.test(query)) return [template && !snapshot ? 'templates.preview' : 'captures.create']
  if (/\bget\b|读取|查看/u.test(query) && template) return ['templates.get']
  return undefined
}
