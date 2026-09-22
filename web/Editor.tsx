import { useEffect, useRef, useState } from 'react'

import type { Device, Field, FieldMapping, NotifyState, Validation } from '../src/types.js'
import { api } from './api.js'

const TIER_TEXT: Record<string, string> = {
  existing: 'the current mapping',
  modelFirmware: 'known for this model and firmware',
  model: 'known for this model',
  name: 'guessed from the device class and field name'
}

/**
 * The per-field editor: a path, validated by the daemon on every change so
 * the conversion (°C → K) or the refusal is visible before saving; a truth
 * table for an enum on a boolean leaf; a notification table for an enum with
 * alarm-like labels; invert; and the PUT flag on a writable field.
 */
export function Editor(props: {
  device: Device
  field: Field
  existing: FieldMapping | undefined
  notifyStates: NotifyState[]
  onCancel: () => void
  onSave: (entry: FieldMapping) => void
}) {
  const { device, field, existing, notifyStates, onCancel, onSave } = props
  const [path, setPath] = useState(existing?.path ?? '')
  const [invert, setInvert] = useState(existing?.invert ?? false)
  const [truth, setTruth] = useState<Record<string, boolean>>(existing?.truth ?? {})
  const [notify, setNotify] = useState<Record<string, NotifyState>>(existing?.notify ?? {})
  const [put, setPut] = useState(existing?.put ?? false)
  const [origin, setOrigin] = useState<string>(existing ? 'the current mapping' : '')
  const [validation, setValidation] = useState<Validation | null>(null)
  const [loading, setLoading] = useState(!existing)
  const seq = useRef(0)

  // A suggestion for a field that is not mapped yet.
  useEffect(() => {
    if (existing) return
    let live = true
    api
      .suggest(device.serial, field.id)
      .then((s) => {
        if (!live) return
        setPath(s.path)
        setInvert(s.invert)
        setOrigin(s.tier ? (TIER_TEXT[s.tier] ?? '') : 'nothing known; type the path')
        if (s.truthDefault) setTruth(s.truthDefault)
        if (Object.keys(s.notifyDefault).length > 0) setNotify(s.notifyDefault)
      })
      .catch(() => {
        if (live) setOrigin('no suggestion available')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [device.serial, field.id, existing])

  const entry = (): FieldMapping => {
    const e: FieldMapping = { path: path.trim() }
    if (invert) e.invert = true
    if (Object.keys(truth).length > 0) e.truth = truth
    if (Object.keys(notify).length > 0) e.notify = notify
    if (put) e.put = true
    return e
  }

  // Validate on every change, keeping only the latest answer.
  useEffect(() => {
    const mine = ++seq.current
    const t = setTimeout(() => {
      api
        .validate(device.serial, field.id, entry())
        .then((v) => {
          if (mine === seq.current) setValidation(v)
        })
        .catch(() => {
          if (mine === seq.current) setValidation(null)
        })
    }, 150)
    return () => {
      clearTimeout(t)
    }
  }, [path, invert, truth, notify, put, device.serial, field.id])

  const isEnum = field.options.length > 0
  const needsTruth =
    isEnum &&
    (validation?.ok === false
      ? validation.refusal.kind === 'truth'
      : validation?.ok && validation.boolean)
  const showTruth = isEnum && (needsTruth || Object.keys(truth).length > 0)
  const canSave = validation?.ok === true && path.trim() !== ''

  const hint = () => {
    if (!validation) return null
    if (!validation.ok) {
      return <div className="hint err">{validation.refusal.message}</div>
    }
    const bits: string[] = []
    if (validation.boolean || Object.keys(validation.truth).length > 0) {
      bits.push(
        `publishes true/false: ${Object.entries(validation.truth)
          .map(([k, v]) => `${k}→${v}`)
          .join(', ')}`
      )
    } else if (validation.unit) {
      bits.push(`${field.unit || 'no unit'} → ${validation.unit}, ${validation.conversion}`)
    } else if (isEnum) {
      bits.push('publishes the label, lowercased')
    } else {
      bits.push('published as is, without unit metadata')
    }
    if (Object.keys(validation.notify).length > 0) {
      bits.push(
        `notifies on ${Object.entries(validation.notify)
          .map(([k, v]) => `${k} (${v})`)
          .join(', ')}`
      )
    }
    const cls = validation.warnings.length > 0 ? 'warn' : 'ok'
    return (
      <div className={`hint ${cls}`}>
        {bits.join('; ')}
        {validation.warnings.map((w, i) => (
          <div key={i}>⚠ {w}</div>
        ))}
      </div>
    )
  }

  return (
    <div className="modal-bg" onClick={onCancel}>
      <div
        className="modal"
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        <h2>
          {field.name} <span className="mono">{field.id}</span>
        </h2>
        <div className="sub">
          {device.name} · {field.group} ·{' '}
          {field.unit || (isEnum ? field.options.join(' / ') : 'no unit')}
          {origin ? ` · pre-filled from ${origin}` : ''}
        </div>
        <label className="row">
          Signal K path
          <input
            className="path"
            type="text"
            value={path}
            disabled={loading}
            autoFocus
            spellCheck={false}
            onChange={(e) => {
              setPath(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSave) onSave(entry())
              if (e.key === 'Escape') onCancel()
            }}
          />
        </label>
        {hint()}
        {(field.options.length === 0 || showTruth) && (
          <label className="row">
            <input
              type="checkbox"
              checked={invert}
              onChange={(e) => {
                setInvert(e.target.checked)
              }}
            />
            invert (publish the boolean negated: a charger's Standby is enabled=false)
          </label>
        )}
        {showTruth && (
          <>
            <div>
              Which labels mean <code>true</code>?
            </div>
            <div className="table-edit">
              {field.options.map((label) => (
                <label key={label} className="row">
                  <input
                    type="checkbox"
                    checked={truth[label] ?? false}
                    onChange={(e) => {
                      setTruth({ ...truth, [label]: e.target.checked })
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </>
        )}
        {isEnum && (
          <>
            <div>Labels that raise a Signal K notification</div>
            <div className="table-edit">
              {field.options.map((label) => (
                <label key={label} className="row">
                  {label}
                  <select
                    value={notify[label] ?? ''}
                    onChange={(e) => {
                      const next = Object.fromEntries(
                        Object.entries(notify).filter(([k]) => k !== label)
                      )
                      if (e.target.value !== '') next[label] = e.target.value as NotifyState
                      setNotify(next)
                    }}
                  >
                    <option value="">normal</option>
                    {notifyStates.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </>
        )}
        {field.writable && (
          <label className="row">
            <input
              type="checkbox"
              checked={put}
              onChange={(e) => {
                setPut(e.target.checked)
              }}
            />
            accept PUTs from Signal K on this path (a switch in Signal K sets this field)
          </label>
        )}
        <div className="actions">
          <button onClick={onCancel}>Cancel</button>
          <button
            className="primary"
            disabled={!canSave}
            onClick={() => {
              onSave(entry())
            }}
          >
            {existing ? 'Update' : 'Map'}
          </button>
        </div>
      </div>
    </div>
  )
}
