import { describe, expect, it } from 'vitest'

import { instanceOf, mainInstance } from '../web/mapping.js'

describe('instanceOf', () => {
  it('is the last segment of the node', () => {
    expect(instanceOf('electrical.chargers.nav-battery.voltage')).toBe('nav-battery')
    expect(instanceOf('propulsion.port.revolutions')).toBe('port')
    expect(instanceOf('environment.outside.temperature')).toBeUndefined()
    expect(instanceOf('electrical.batteries.house')).toBeUndefined()
  })
})

describe('mainInstance', () => {
  it('is the instance most paths use, not the last one saved', () => {
    const paths = [
      'electrical.alternators.alt-110a.voltage',
      'electrical.alternators.alt-110a.current',
      'electrical.switches.alt-110a-stop-charge.state'
    ]
    expect(mainInstance(paths, 'alt-110a-stop-charge')).toBe('alt-110a')
  })

  it('keeps the current instance on a tie', () => {
    const tie = ['electrical.batteries.li-ion.voltage', 'electrical.batteries.li-ion-1.voltage']
    expect(mainInstance(tie, 'li-ion-1')).toBe('li-ion-1')
    expect(mainInstance(tie, 'other')).toBe('li-ion')
  })

  it('has nothing to say without a node', () => {
    expect(mainInstance(['environment.outside.temperature'], 'x')).toBeUndefined()
  })
})
