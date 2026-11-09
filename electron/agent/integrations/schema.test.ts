import assert from 'node:assert/strict'
import test from 'node:test'
import { validateIntegrationSchema } from './schema.ts'

test('外部 Schema 保留组合、内部引用与条件约束',()=>{
  const schema=validateIntegrationSchema({type:'object',$defs:{value:{anyOf:[{type:'string',minLength:2},{type:'integer',minimum:1}]}},
    properties:{value:{$ref:'#/$defs/value'},email:{type:'string',format:'email'}},required:['value'],additionalProperties:false})
  assert.equal(schema.Check({value:'ok',email:'user@example.test'}),true)
  for (const value of [{value:0},{value:'x'},{value:'ok',email:'invalid'},{value:'ok',other:true}]) assert.equal(schema.Check(value),false)
})

test('不兼容约束只隔离该项工具，不能静默丢弃限制或联网读取引用',()=>{
  for (const property of [{type:'string',format:'custom-format'},{$ref:'https://schema.test/value'}, {type:'string',unknownConstraint:1},{type:'string',minLength:'two'}]) {
    assert.throws(()=>validateIntegrationSchema({type:'object',properties:{value:property}}),/SCHEMA_UNSUPPORTED/u)
  }
  assert.equal(validateIntegrationSchema({type:'object',properties:{nullable:{type:['string','null']}}}).Check({nullable:null}),true)
})
