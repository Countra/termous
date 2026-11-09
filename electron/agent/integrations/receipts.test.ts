import assert from 'node:assert/strict'
import test from 'node:test'
import type { IntegrationCorePort } from '../contracts/integrations.ts'
import { executeIntegrationCall, receiptResult } from './receipts.ts'

const context={run_id:'run',session_id:'session',generation:1,bearer:'fixture'}
const receipt={id:'call',state:'dispatched' as const,may_dispatch:true}

test('持久化响应丢失只重试同一份回执，不再次调用业务工具',async()=>{
  let calls=0
  const persisted:string[]=[]
  const core={settle:async (_id:string,_state:string,value:unknown)=>{persisted.push(JSON.stringify(value));if (persisted.length===1) throw new Error('response lost')}} as IntegrationCorePort
  const result=await executeIntegrationCall(core,context,receipt,'generation',async mark=>{mark();calls++;return {content:[{type:'text',text:'done'}]} })
  assert.equal(calls,1)
  assert.equal(persisted.length,2)
  assert.equal(persisted[0],persisted[1])
  assert.equal(result.content[0].text,'done')
})

test('传输断开登记为不确定，禁止通过同身份重新派发',async()=>{
  const states:string[]=[]
  const core={settle:async (_id:string,state:string)=>{states.push(state)}} as IntegrationCorePort
  let calls=0
  await assert.rejects(executeIntegrationCall(core,context,receipt,'generation',async mark=>{mark();calls++;throw new Error('lost')}),/RESULT_UNCERTAIN/u)
  assert.deepEqual(states,['uncertain'])
  const replay=await executeIntegrationCall(core,context,{...receipt,state:'uncertain',may_dispatch:false},'generation',async()=>{calls++;throw new Error('must not run')})
  assert.equal(calls,1)
  assert.equal(replay.isError,true)
  assert.match(replay.content[0].text,/query_original_operation/u)
})

test('排队取消或派发前校验失败明确登记为未派发，原身份仍不可重放',async()=>{
  const states:string[]=[]
  const core={settle:async (_id:string,state:string)=>{states.push(state)}} as IntegrationCorePort
  await assert.rejects(executeIntegrationCall(core,context,receipt,'generation',async()=>{throw new Error('revoked')}),/NOT_DISPATCHED/u)
  assert.deepEqual(states,['not_dispatched'])
  const result=await executeIntegrationCall(core,context,{...receipt,state:'not_dispatched',may_dispatch:false},'generation',async()=>{throw new Error('must not run')})
  assert.match(result.content[0].text,/not_dispatched/u)
})

test('已完成外部失败仍保留错误语义和结果',()=>{
  assert.deepEqual(receiptResult({...receipt,state:'completed',may_dispatch:false,result:{content:[{type:'text',text:'rejected'}],isError:true}}),{content:[{type:'text',text:'rejected'}],isError:true})
})
