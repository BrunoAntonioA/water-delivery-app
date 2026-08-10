import { useState } from 'react'
import { exportCompanyData } from '../api/admin'
import {
  downloadBlob,
  toCsv,
  zipTextFiles,
} from '../lib/exportFiles'
import { Button, Card } from './ui'

function todayStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Categorías de datos (cada una agrupa varias tablas) que se pueden exportar.
const GROUPS: { key: string; label: string; tables: string[] }[] = [
  { key: 'clientes', label: 'Clientes y direcciones', tables: ['clients', 'addresses'] },
  { key: 'productos', label: 'Productos e insumos', tables: ['products', 'supplies', 'product_supplies'] },
  { key: 'pedidos', label: 'Pedidos', tables: ['orders', 'order_items'] },
  { key: 'rutas', label: 'Rutas', tables: ['routes', 'route_stops', 'route_loads', 'route_pickups'] },
  { key: 'costos', label: 'Costos', tables: ['cost_categories', 'costs'] },
  { key: 'abastecimiento', label: 'Suministros', tables: ['providers', 'supply_purchases', 'supply_purchase_items'] },
  { key: 'plantillas', label: 'Plantillas de WhatsApp', tables: ['whatsapp_templates'] },
  { key: 'suscripcion', label: 'Suscripción y pagos', tables: ['subscriptions', 'subscription_payments', 'payment_intents'] },
  { key: 'usuarios', label: 'Usuarios', tables: ['profiles'] },
]

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'empresa'
  )
}

/**
 * Respaldo de datos de una empresa (sólo superadmin). Descarga toda su
 * información en JSON (copia fiel, para restaurar) o CSV (un archivo por tabla,
 * empaquetados en un ZIP, para abrir en Excel/Sheets).
 */
export function CompanyBackup({
  companyId,
  companyName,
}: {
  companyId: string
  companyName: string
}) {
  const [busy, setBusy] = useState<'json' | 'csv' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Categorías seleccionadas (por defecto todas).
  const [selected, setSelected] = useState<Set<string>>(
    new Set(GROUPS.map((g) => g.key))
  )

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function run(format: 'json' | 'csv') {
    setError(null)
    setBusy(format)
    try {
      // Tablas de las categorías elegidas. Si no hay ninguna, se exporta TODO.
      const tables = GROUPS.filter((g) => selected.has(g.key)).flatMap(
        (g) => g.tables
      )
      const bundle = await exportCompanyData(
        companyId,
        tables.length > 0 ? tables : undefined
      )
      const base = `gestiona-agua_${slug(companyName)}_${todayStamp()}`

      if (format === 'json') {
        const blob = new Blob([JSON.stringify(bundle, null, 2)], {
          type: 'application/json',
        })
        downloadBlob(blob, `${base}.json`)
      } else {
        const files = Object.entries(bundle.tables).map(([name, rows]) => ({
          name: `${name}.csv`,
          // BOM (﻿) para que Excel abra los acentos correctamente.
          content: '\uFEFF' + toCsv(rows),
        }))
        files.push({
          name: 'LEEME.txt',
          content:
            `Respaldo de ${companyName}\n` +
            `Generado: ${bundle.exported_at}\n\n` +
            `Cada archivo .csv es una tabla. Para restaurar el sistema usa el ` +
            `respaldo en JSON (conserva relaciones y tipos). Las imágenes de ` +
            `producto (Storage) no se incluyen en este archivo.\n`,
        })
        downloadBlob(zipTextFiles(files), `${base}_csv.zip`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="mb-6 p-4">
      <h2 className="mb-1 font-semibold text-slate-900">Respaldo de datos</h2>
      <p className="mb-3 text-sm text-slate-500">
        Descarga la información de esta empresa para guardarla como copia de
        seguridad.
      </p>

      {/* Selección de qué exportar (por defecto, todo) */}
      <div className="mb-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">
            ¿Qué quieres exportar?
          </span>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setSelected(new Set(GROUPS.map((g) => g.key)))}
              className="font-medium text-sky-600 hover:underline"
            >
              Todo
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="font-medium text-slate-500 hover:underline"
            >
              Ninguno
            </button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {GROUPS.map((g) => {
            const on = selected.has(g.key)
            return (
              <label
                key={g.key}
                className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
              >
                <span className="text-sm font-medium text-slate-700">
                  {g.label}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => toggle(g.key)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                    on ? 'bg-sky-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      on ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </label>
            )
          })}
        </div>
        {selected.size === 0 && (
          <p className="mt-2 text-xs text-slate-400">
            No hay categorías seleccionadas: se exportará <strong>todo</strong>.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => run('json')} disabled={busy !== null}>
          {busy === 'json' ? 'Generando…' : '⬇️ Descargar JSON'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => run('csv')}
          disabled={busy !== null}
        >
          {busy === 'csv' ? 'Generando…' : '⬇️ Descargar CSV (ZIP)'}
        </Button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">Error: {error}</p>}

      <p className="mt-3 text-xs text-slate-400">
        <strong>JSON</strong>: copia fiel para restaurar (conserva relaciones y
        tipos). <strong>CSV</strong>: un archivo por tabla en un ZIP, para abrir
        en Excel/Sheets. Las imágenes de producto no se incluyen. Guarda el
        archivo en un lugar seguro y privado.
      </p>
    </Card>
  )
}
