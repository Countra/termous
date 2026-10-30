import assert from 'node:assert/strict'
import test from 'node:test'
import { Type } from 'typebox'
import { createPiAgent } from './piAgentAdapter.ts'
import { RuntimeEventWriter } from './runtimeEventWriter.ts'
import { runtimeBootstrap, runtimeUserMessage } from '../test-support/runtimeBootstrapTestFixture.ts'
import { testAgentSkillBundle } from '../test-support/skillBundleTestFixture.ts'
import { agentRuntimeProtocolVersion, defaultExecutionBudget } from '#common/contracts'
import { externalToolName, externalToolSource, identifyTool } from '../contracts/toolSources.ts'
import type { RuntimeEventInput } from '../contracts/runtimeEvents.ts'

for (const mode of ['invalid-json','dynamic-tools','refresh-schema'] as const) test(`Pi 1.4 真实请求合同：${mode}`, async()=>{
  const bootstrap=runtimeBootstrap()
  bootstrap.model.snapshot.context_window_tokens=128000
  bootstrap.model.snapshot.execution_budget={...defaultExecutionBudget,enabled:false}
  bootstrap.messages=[runtimeUserMessage([], {text:'执行隔离协议回归'})]
  const events:RuntimeEventInput[]=[]
  const skills=testAgentSkillBundle()
  const writer=new RuntimeEventWriter({start:{type:'start',protocol_version:agentRuntimeProtocolVersion,core_base_url:'http://127.0.0.1:8122',ticket:'t'.repeat(48),run_id:bootstrap.run.id,generation:1,skills},runtimeBearer:bootstrap.runtime_bearer,initialSequence:1,
    onFailure:error=>{throw error},core:{bootstrap:async()=>bootstrap,appendAuditEvents:async()=>{},appendEvents:async(_start,_bearer,batch)=>{events.push(...batch);return batch[batch.length-1]!.sequence},
      appendSteer:async()=>{throw new Error('不应追加指令')},commitCheckpoint:async()=>{throw new Error('不应压缩')}}})
  const source=externalToolSource('fixture')
  let calls=0,requests=0,changed=false,refreshes=0
  const makeTool=(original:string,revised=false)=>identifyTool({name:externalToolName(source,original),label:original,description:'Return an isolated fixture counter.',parameters:revised ? Type.Object({revised_value:Type.Number()}) : Type.Object({value:Type.Number()}),
    execute:async()=>{calls++;return {content:[{type:'text' as const,text:`counter=${calls}`}],details:{}}}},source,original)
  const first=makeTool('counter'),second=makeTool(mode==='refresh-schema' ? 'counter' : 'next_counter',mode==='refresh-schema')
  const agent=createPiAgent({bootstrap,events:writer,skills,commitCheckpoint:async()=>{throw new Error('不应压缩')},
    mcp:{tools:[first],originalName:name=>name===first.name ? 'fixture::counter' : name===second.name ? 'fixture::next_counter' : null,close:async()=>{},
      refreshTools:async()=>{refreshes++;if(mode!=='invalid-json' && calls===5 && !changed){changed=true;return {removed:[first.name],tools:[second]}}}},
    fetch:async(_input,init)=>{
      assert.ok(++requests<30)
      const headers=new Headers(init?.headers)
      assert.match(headers.get('user-agent') ?? '',/Termous/u)
      assert.equal(headers.get('x-title'),null)
      const body=JSON.parse(String(init?.body))
      const names=body.tools.map((tool:{function:{name:string}})=>tool.function.name)
      assert.ok(names.length<=32)
      if (mode==='invalid-json' && requests===3) return complete('参数无效，已停止')
      if (mode!=='invalid-json' && calls===12) return complete('完成')
      const current=changed ? second : first
      if(changed && mode==='dynamic-tools') assert.ok(!names.includes(first.name),'旧工具在目录移除后仍被声明')
      if(changed && mode==='refresh-schema') {
        assert.ok(names.includes(second.name),'目录刷新丢失当前外部工具声明')
        const declaration=body.tools.find((tool:{function:{name:string}})=>tool.function.name===second.name).function
        assert.ok(declaration.parameters.properties.revised_value)
        assert.equal(declaration.parameters.properties.value,undefined)
      }
      if(!names.includes(current.name)) return toolCall('discover_tools',JSON.stringify({query:'counter',names:[current.name]}),requests)
      return toolCall(current.name,mode==='invalid-json' ? '{"value":1 garbage}' : JSON.stringify(changed && mode==='refresh-schema' ? {revised_value:calls} : {value:calls}),requests)
    }})
  try {
    assert.equal(await agent.continue(),'completed')
    await writer.flush()
    assert.equal(calls,mode==='invalid-json' ? 0 : 12)
    assert.equal(refreshes,requests)
    if(mode==='invalid-json') assert.match(JSON.stringify(events),/arguments_error/u)
    else {assert.equal(changed,true);assert.match(JSON.stringify(events),mode==='refresh-schema' ? /fixture::counter/u : /fixture::next_counter/u)}
  } finally {agent.close();await writer.close()}
})

function complete(content:string){return response({content})}
function toolCall(name:string,args:string,id:number){return response({tool_calls:[{index:0,id:`call_${id}`,type:'function',function:{name,arguments:args}}]})}
function response(delta:Record<string,unknown>){
  const chunk={id:'fixture',object:'chat.completion.chunk',created:1,model:'test-model',choices:[{index:0,delta:{role:'assistant',...delta},finish_reason:delta.tool_calls ? 'tool_calls' : 'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}})
}
