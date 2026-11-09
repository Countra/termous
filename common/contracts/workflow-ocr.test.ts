import assert from 'node:assert/strict'
import test from 'node:test'
import { isWorkflowDetachedMedia } from './workflow-detached.ts'
import { isWorkflowOCRQuery } from './workflow-ocr.ts'

test('OCR 媒体合同限制参数、范围和报告页，保留合法零阈值',() => {
  const query={text:'保存',text_confidence:0,ocr_max_side:640}
  assert.ok(isWorkflowOCRQuery(query))
  for (const patch of [{text_confidence:NaN},{ocr_max_side:641},{unexpected:true},{region:{x:0,y:0,width:10,height:10}},{text:'字'.repeat(1025)},{reference_width:'400'},{reference_height:-1},{reference_width:NaN},{reference_height:1.5},{reference_width:4294967296}]) assert.equal(isWorkflowOCRQuery({...query,...patch}),false)
  assert.ok(isWorkflowDetachedMedia({kind:'ocr-preview',id:'preview',request:'request',query}))
  assert.ok(isWorkflowDetachedMedia({kind:'ocr-cancel',id:'preview',request:'request'}))
  assert.equal(isWorkflowDetachedMedia({kind:'ocr-report',id:'run',index:1,offset:0,limit:101}),false)
  assert.ok(isWorkflowDetachedMedia({kind:'ocr-report',id:'run',index:1,offset:0,limit:100}))
})
