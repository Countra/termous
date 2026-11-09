import assert from 'node:assert/strict'
import test from 'node:test'
import { Type } from 'typebox'
import { attachLocalTools } from './localTools.ts'
import { builtinTool, trustedTool } from '../contracts/toolSources.ts'
import { RuntimeToolDiscovery } from '../tools/runtimeToolDiscovery.ts'
import type { LocalToolContext } from '../contracts/localTools.ts'

const context: LocalToolContext = {
  directory: { path: 'C:/work', managed: false, revision: 1 },
  environment: { platform: 'windows', default_shell: 'powershell', shells: [] },
  tools: {
    'termous.local.files.read': { description: 'Read local files', inputSchema: Type.Object({path:Type.String()}) },
    'termous.local.commands.execute': { description: 'Run local commands', inputSchema: Type.Object({command:Type.String()}) },
  },
}

test('本地代理仅传业务参数和框架调用身份，不进入 MCP 自动准备', async () => {
  let pending = true
  const inputs: unknown[] = []
  const connection = attachLocalTools({ tools: [], originalName: () => null, close: async () => {} }, context, async input => {
    inputs.push(input)
    return {state:'completed',value:{task:{id:'lc_example',status:pending ? 'running' : 'completed'},stdout:{text:'完成'}}}
  })
  const command = connection.tools[1]!
  assert(trustedTool(command));assert(!builtinTool(command))
  await command.execute('framework-id',{command:'echo hello'})
  assert.deepEqual(inputs,[{tool_call_id:'framework-id',tool:'termous.local.commands.execute',arguments:{command:'echo hello'}}])
  assert.match(connection.pendingWork!()!,/lc_example/u)
  pending = false
  await command.execute('second',{command:'echo hello'})
  assert.equal(connection.pendingWork!(),undefined)
  await connection.close()
})

test('无资源绑定的普通会话可以发现并预加载本地入口', () => {
  const connection = attachLocalTools({tools:[],originalName:()=>null,close:async()=>{}},context,async()=>({}))
  const discovery = new RuntimeToolDiscovery(connection.tools,connection.originalName,[])
  discovery.preload([])
  assert(discovery.publish().some(tool=>connection.originalName(tool.name)==='termous.local.files.read'))
})
