import { describe, expect, it } from 'vitest'

import { DEFAULTS, SCHEMA, withDefaults } from '../src/config.js'

describe('withDefaults', () => {
  it('fills an empty or partial config', () => {
    expect(withDefaults(undefined)).toEqual(DEFAULTS)
    expect(withDefaults({})).toEqual(DEFAULTS)
    const c = withDefaults({
      mode: 'external',
      external: { host: 'pi.local' },
      installerCode: 1234
    })
    expect(c.mode).toBe('external')
    expect(c.external).toEqual({ ...DEFAULTS.external, host: 'pi.local' })
    expect(c.bundled).toEqual(DEFAULTS.bundled)
    expect(c.installerCode).toBe(1234)
  })

  it('normalises junk', () => {
    const c = withDefaults({ mode: 'banana', installerCode: 'abc' })
    expect(c.mode).toBe('bundled')
    expect(c.installerCode).toBeNull()
  })

  it('has a default in the schema for every defaulted field', () => {
    const props = SCHEMA.properties
    expect(props.mode.default).toBe(DEFAULTS.mode)
    for (const [k, v] of Object.entries(DEFAULTS.bundled)) {
      expect((props.bundled.properties as Record<string, { default: unknown }>)[k].default).toBe(v)
    }
    for (const [k, v] of Object.entries(DEFAULTS.external)) {
      expect((props.external.properties as Record<string, { default: unknown }>)[k].default).toBe(v)
    }
  })
})
