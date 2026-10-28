/**
 * The instance segment of a Signal K path: the last segment of its node.
 * Mirrors `signalk::instance_of` in masterbus: `electrical` and `tanks` nest
 * the instance third, `propulsion` and `sails` second; other branches have
 * no per-device node.
 */
export function instanceOf(path: string): string | undefined {
  const seg = path.split('.')
  const depth =
    seg[0] === 'electrical' || seg[0] === 'tanks'
      ? 3
      : seg[0] === 'propulsion' || seg[0] === 'sails'
        ? 2
        : 0
  if (depth === 0 || seg.length <= depth) return undefined
  return seg[depth - 1]
}

/**
 * The instance most of a device's paths use, which is what its entry records.
 * A switch mapped beside a device's readings (a regulator's `Stop charge`
 * under `electrical.switches`) must not take over the instance new mappings
 * are proposed under (masterbus#47). A tie keeps `current`, and otherwise
 * goes to the alphabetically first instance. Mirrors `signalk::main_instance`.
 */
export function mainInstance(paths: string[], current: string): string | undefined {
  const counts = new Map<string, number>()
  for (const p of paths) {
    const i = instanceOf(p)
    if (i !== undefined) counts.set(i, (counts.get(i) ?? 0) + 1)
  }
  if (counts.size === 0) return undefined
  const top = Math.max(...counts.values())
  if (counts.get(current) === top) return current
  return [...counts.keys()].sort().find((i) => counts.get(i) === top)
}
