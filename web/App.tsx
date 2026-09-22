import { useCallback, useEffect, useMemo, useState } from 'react'

import type { Device, Diagnostic, Field, FieldMapping, Mapping, NotifyState } from '../src/types.js'
import { api, type Summary } from './api.js'
import { Editor } from './Editor.js'

const NOTIFY_STATES: NotifyState[] = ['alert', 'warn', 'alarm', 'emergency']

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

/** A deep-enough copy so edits never touch the last-saved mapping. */
function clone(m: Mapping): Mapping {
  return JSON.parse(JSON.stringify(m)) as Mapping
}

export function App() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [saved, setSaved] = useState<Mapping | null>(null)
  const [mapping, setMapping] = useState<Mapping | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [editing, setEditing] = useState<Field | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const dirty = useMemo(
    () => saved !== null && mapping !== null && JSON.stringify(saved) !== JSON.stringify(mapping),
    [saved, mapping]
  )

  const load = useCallback(async () => {
    try {
      const s = await api.summary()
      setSummary(s)
      if (!s.connected) return
      const [d, m, diag] = await Promise.all([api.devices(), api.mapping(), api.diagnostics()])
      setDevices(d)
      setSaved(m)
      setMapping((cur) => (cur === null ? clone(m) : cur))
      setDiagnostics(diag)
      setSelected((cur) => cur ?? d[0]?.serial ?? null)
      setError(null)
    } catch (e) {
      setError(errMsg(e))
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => {
      void load()
    }, 5000)
    return () => {
      clearInterval(t)
    }
  }, [load])

  const device = devices.find((d) => d.serial === selected) ?? null
  const dm = device && mapping ? mapping.devices[device.serial] : undefined

  const entryOf = (f: Field): FieldMapping | undefined => dm?.fields[f.id]

  const setEntry = (serial: string, field: string, entry: FieldMapping | null) => {
    setMapping((cur) => {
      if (!cur) return cur
      const next = clone(cur)
      const dev = devices.find((d) => d.serial === serial)
      const existing = next.devices[serial] ?? {
        article: dev?.article ?? '',
        firmware: dev?.firmware ?? '',
        name: dev?.name ?? '',
        instance: dev?.instance ?? '',
        fields: {}
      }
      if (entry === null) {
        existing.fields = Object.fromEntries(
          Object.entries(existing.fields).filter(([k]) => k !== field)
        )
      } else {
        existing.fields[field] = entry
        // Record the instance the path actually uses, as the TUI does, so a
        // later "apply to article" substitutes the right segment.
        const seg = entry.path.split('.')
        if (seg[0] === 'electrical' && seg.length > 3)
          existing.instance = seg[2] ?? existing.instance
      }
      if (Object.keys(existing.fields).length === 0) {
        next.devices = Object.fromEntries(
          Object.entries(next.devices).filter(([k]) => k !== serial)
        )
      } else {
        next.devices[serial] = existing
      }
      return next
    })
  }

  const save = async () => {
    if (!mapping) return
    setBusy('Saving…')
    try {
      const r = await api.putMapping(mapping)
      setSaved(clone(mapping))
      setDiagnostics(r.diagnostics)
      const errors = r.diagnostics.filter((d) => d.severity === 'error').length
      setNotice(
        `Saved: ${r.streaming} field${r.streaming === 1 ? '' : 's'} streaming` +
          (errors ? `, ${errors} skipped (see below)` : '')
      )
      setError(null)
      await load()
    } catch (e) {
      setError(`Save failed: ${errMsg(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const discard = () => {
    if (saved) setMapping(clone(saved))
  }

  const applyArticle = async () => {
    if (!device) return
    setBusy('Copying…')
    try {
      const r = await api.applyArticle(device.serial)
      setNotice(
        r.targets === 0
          ? `No other device with article ${device.article}`
          : `Copied ${r.copied} field${r.copied === 1 ? '' : 's'} to ${r.targets} device${r.targets === 1 ? '' : 's'}` +
              (r.skipped ? `, ${r.skipped} skipped` : '')
      )
      setDiagnostics(r.diagnostics)
      const m = await api.mapping()
      setSaved(m)
      setMapping(clone(m))
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  const loadMenu = async (menu: 'configuration' | 'service') => {
    if (!device) return
    setBusy(`Discovering ${menu}…`)
    try {
      const d = await api.device(device.serial, menu)
      setDevices((cur) => cur.map((x) => (x.serial === d.serial ? d : x)))
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  const readValue = async (f: Field) => {
    if (!device) return
    try {
      const { value } = await api.readValue(device.serial, f.id)
      setDevices((cur) =>
        cur.map((x) =>
          x.serial === device.serial
            ? { ...x, fields: x.fields.map((y) => (y.id === f.id ? { ...y, value } : y)) }
            : x
        )
      )
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const statusText = (): string => {
    if (!summary) return 'Connecting to the plugin…'
    if (summary.error) return summary.error
    const s = summary.status
    if (!summary.connected || !s) return 'The plugin is not connected to a MasterBus daemon'
    return (
      `${summary.mode === 'bundled' ? 'Bundled daemon' : 'External daemon'} on ${s.transport}: ` +
      `${s.devices} device${s.devices === 1 ? '' : 's'}, ${s.mapped.fields} mapped, ` +
      `${s.streaming} streaming, ${s.clients} stream client${s.clients === 1 ? '' : 's'}`
    )
  }

  const menus: Array<Field['menu']> = ['monitoring', 'configuration', 'service']
  const fieldsByMenu = (d: Device) =>
    menus
      .map((m) => [m, d.fields.filter((f) => f.menu === m)] as const)
      .filter(([, fs]) => fs.length)

  return (
    <div className="app">
      <header className="top">
        <h1>MasterBus mapping</h1>
        <div className={`status${summary?.error ? ' err' : ''}`}>{busy ?? statusText()}</div>
        {dirty && <span className="dirty">unsaved changes</span>}
        <button onClick={discard} disabled={!dirty}>
          Discard
        </button>
        <button className="primary" onClick={() => void save()} disabled={!dirty || busy !== null}>
          Save mapping
        </button>
      </header>
      <div className="body">
        <aside className="devices">
          {devices.length === 0 && <div className="empty">No devices yet</div>}
          {devices.map((d) => {
            const mapped = mapping?.devices[d.serial]
              ? Object.keys(mapping.devices[d.serial]?.fields ?? {}).length
              : 0
            return (
              <button
                key={d.serial || d.id}
                className={`dev${d.serial === selected ? ' sel' : ''}`}
                onClick={() => {
                  setSelected(d.serial)
                }}
              >
                <div className="name">{d.name || `(unnamed ${d.id})`}</div>
                <div className="meta">
                  {d.serial || 'no serial'} · {d.article} · fw {d.firmware} · {mapped}/
                  {d.fields.length} mapped
                </div>
              </button>
            )
          })}
        </aside>
        <main className="fields">
          {error && (
            <div className="hint err">
              {error}{' '}
              <button
                onClick={() => {
                  setError(null)
                }}
              >
                dismiss
              </button>
            </div>
          )}
          {notice && (
            <div className="hint ok">
              {notice}{' '}
              <button
                onClick={() => {
                  setNotice(null)
                }}
              >
                ok
              </button>
            </div>
          )}
          {!device && <div className="empty">Select a device</div>}
          {device && (
            <>
              <div className="toolbar">
                <strong>{device.name}</strong>
                <span className="mono">
                  {device.serial} · {device.id}
                </span>
                <span className="spacer" />
                {!device.menus.includes('configuration') && (
                  <button onClick={() => void loadMenu('configuration')} disabled={busy !== null}>
                    Load configuration fields
                  </button>
                )}
                <button
                  onClick={() => void applyArticle()}
                  disabled={busy !== null || dirty || !dm || Object.keys(dm.fields).length === 0}
                  title={
                    dirty
                      ? 'Save first; copying works on the saved mapping'
                      : `Copy this mapping to every other device with article ${device.article}`
                  }
                >
                  Apply to same article
                </button>
              </div>
              {!device.serial && (
                <div className="hint warn">
                  This device has not reported a serial number, so it cannot be mapped.
                </div>
              )}
              <table className="fields">
                <thead>
                  <tr>
                    <th>Id</th>
                    <th>Group</th>
                    <th>Field</th>
                    <th>Unit</th>
                    <th>Value</th>
                    <th>Signal K path</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {fieldsByMenu(device).map(([menu, fs]) => (
                    <FieldRows
                      key={menu}
                      menu={menu}
                      fields={fs}
                      entryOf={entryOf}
                      canMap={device.serial !== ''}
                      onMap={(f) => {
                        setEditing(f)
                      }}
                      onUnmap={(f) => {
                        setEntry(device.serial, f.id, null)
                      }}
                      onRead={(f) => void readValue(f)}
                    />
                  ))}
                </tbody>
              </table>
            </>
          )}
          {diagnostics.length > 0 && (
            <div className="diag">
              <strong>Mapping diagnostics</strong> (of the saved mapping)
              <ul>
                {diagnostics.map((d, i) => (
                  <li key={i} className={`sev-${d.severity}`}>
                    {d.device || d.serial}
                    {d.field ? ` ${d.field}` : ''}
                    {d.path ? ` → ${d.path}` : ''}: {d.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </main>
      </div>
      {editing && device && (
        <Editor
          device={device}
          field={editing}
          existing={entryOf(editing)}
          notifyStates={NOTIFY_STATES}
          onCancel={() => {
            setEditing(null)
          }}
          onSave={(entry) => {
            setEntry(device.serial, editing.id, entry)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function FieldRows(props: {
  menu: Field['menu']
  fields: Field[]
  entryOf: (f: Field) => FieldMapping | undefined
  canMap: boolean
  onMap: (f: Field) => void
  onUnmap: (f: Field) => void
  onRead: (f: Field) => void
}) {
  const { menu, fields, entryOf, canMap, onMap, onUnmap, onRead } = props
  return (
    <>
      <tr className="menu">
        <td colSpan={7}>{menu.charAt(0).toUpperCase() + menu.slice(1)}</td>
      </tr>
      {fields.map((f) => {
        const e = entryOf(f)
        return (
          <tr key={f.id}>
            <td className="mono">{f.id}</td>
            <td>{f.group}</td>
            <td>
              {f.name}
              {f.options.length > 0 && <span className="tag">enum</span>}
              {f.writable && <span className="tag">writable</span>}
            </td>
            <td>{f.unit}</td>
            <td className="num">
              {f.value !== null && f.value !== undefined ? (
                fmt(f.value)
              ) : (
                <button
                  onClick={() => {
                    onRead(f)
                  }}
                  title="Read the value from the bus"
                >
                  read
                </button>
              )}
            </td>
            <td className="path">
              {e?.path ?? <span className="sev-info">—</span>}
              {e?.invert && <span className="tag">invert</span>}
              {e?.put && <span className="tag">put</span>}
              {e && Object.keys(e.notify ?? {}).length > 0 && <span className="tag">notify</span>}
            </td>
            <td>
              {canMap && (
                <button
                  onClick={() => {
                    onMap(f)
                  }}
                >
                  {e ? 'Edit' : 'Map'}
                </button>
              )}{' '}
              {e && (
                <button
                  onClick={() => {
                    onUnmap(f)
                  }}
                >
                  Unmap
                </button>
              )}
            </td>
          </tr>
        )
      })}
    </>
  )
}
