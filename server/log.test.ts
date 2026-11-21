/**
 * Server logs must never leak secrets or raw IPs.
 */
import { expect, it } from 'vitest'
import { createLogger, hashIp } from './log.js'

it('masks secret-looking fields at any depth, and reduces buffers and errors to a summary', () => {
  const lines: Record<string, unknown>[] = []
  const L = createLogger({ sid: 's1' }, { level: 'info', sink: (_lv, line) => lines.push(JSON.parse(line)) })
  L.info('cfg', { apiKey: 'sk-123', nested: { authorization: 'Bearer x', token: 't', ok: 1 }, pcm: Buffer.alloc(640), error: new Error('boom') })
  expect(lines[0]).toMatchObject({ sid: 's1', apiKey: '***', nested: { authorization: '***', token: '***', ok: 1 }, pcm: '<640 bytes>', error: 'boom' })
})

it('IP addresses are logged as a stable hash, never in the clear', () => {
  expect(hashIp('1.2.3.4')).toBe(hashIp('1.2.3.4'))
  expect(hashIp('1.2.3.4')).not.toBe(hashIp('1.2.3.5'))
  expect(hashIp('1.2.3.4')).not.toContain('1.2.3.4')
})
