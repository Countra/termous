import { createRoot } from 'react-dom/client'
import '#shared/styles'
import { TermousUiProvider } from '#app/ui-runtime'
import { AssistantExtensions } from '#features/agent-integrations'
import type { AgentIntegrationSource, AgentIntegrationsGateway } from '#entities/agent-integrations'

// 只提供合成配置；不连接 Core，不启动外部进程，也不读取用户文件。
const sources:AgentIntegrationSource[]=[{id:'ext_docs',kind:'mcp',name:'Documentation',enabled:false,revision:1,mcp:{transport:'http',url:'https://example.test/mcp'},secret_configured:false,created_at:'',updated_at:''},
  {id:'ext_local',kind:'mcp',name:'Local workspace',enabled:false,revision:1,mcp:{transport:'stdio',command:'node',args:['workspace-server.js']},secret_configured:false,created_at:'',updated_at:''},
  {id:'ext_review',kind:'skill',name:'design-review',enabled:true,revision:1,secret_configured:false,created_at:'',updated_at:'',skill:{version:'a'.repeat(64),name:'design-review',description:'Review interface consistency and accessibility.',allow_implicit:true,files:[{path:'SKILL.md',mime_type:'text/markdown',object:{sha256:'b'.repeat(64),size_bytes:75}}]}}]
const unavailable=async():Promise<never>=>{throw new Error('此预览不执行外部操作')}
const gateway:AgentIntegrationsGateway={sources:async()=>structuredClone(sources),saveMCP:async input=>{const source:AgentIntegrationSource={id:crypto.randomUUID(),name:input.name,kind:'mcp',enabled:false,revision:1,mcp:input.mcp,secret_configured:false,created_at:'',updated_at:''};sources.push(source);return source},
  enabled:async(source,enabled)=>{const item=sources.find(value=>value.id===source.id)!;item.enabled=enabled;item.revision++;return structuredClone(item)},remove:async source=>{sources.splice(sources.findIndex(value=>value.id===source.id),1)},
  previewMCP:async text=>Object.entries(JSON.parse(text).mcpServers as Record<string,{url:string}>).map(([name,value])=>({name,mcp:{transport:'http',url:value.url},expected_revision:0})),
  tools:async source=>[{source_id:source,source_revision:1,name:'search',title:'Search documents',description:'Find documents by title or content.',contract_hash:'c'.repeat(64)}],permissions:async()=>[{tool:'search',trusted:false}],setPermission:async()=>{},
  previewSkill:unavailable,publishSkill:unavailable,skillDependencies:async()=>[],skillFile:async()=>new Blob(['# Design review\n\nReview spacing, contrast and keyboard access.'],{type:'text/markdown'}),policies:async()=>[],setPolicy:async()=>{}}
const params=new URLSearchParams(location.search)
const root=createRoot(document.getElementById('root')!)
root.render(<TermousUiProvider language={params.has('en')?'en-US':'zh-CN'} theme={params.has('light')?'light':'dark'}><AssistantExtensions gateway={gateway}/></TermousUiProvider>)
import.meta.hot?.dispose(()=>root.unmount())
