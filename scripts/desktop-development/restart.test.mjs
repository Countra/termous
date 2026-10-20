import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { stopDevelopmentProcess } from './restart.mjs'

test('主进程重启等待旧开发进程退出，移除插件自动退出回调', async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill() { queueMicrotask(() => this.emit('exit', 0)) } })
  child.on('exit', process.exit)
  await stopDevelopmentProcess(child)
  assert.equal(child.listenerCount('exit'), 0)
})

test('开发进程拒绝退出时报告错误，不启动另一个实例', async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill() {} })
  await assert.rejects(stopDevelopmentProcess(child, 5), /尚未退出/)
  assert.equal(child.listenerCount('exit'), 0)
})

test('开发进程终止产生异步错误时向上报告并移除监听', async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null,
    kill() { queueMicrotask(() => this.emit('error', new Error('fixture denied'))); return false } })
  await assert.rejects(stopDevelopmentProcess(child), /fixture denied/)
  assert.equal(child.listenerCount('exit'), 0)
  assert.equal(child.listenerCount('error'), 0)
})
