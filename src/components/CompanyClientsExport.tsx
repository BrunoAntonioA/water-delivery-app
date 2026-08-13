import { useState } from 'react'
import { exportCompanyData } from '../api/admin'
import { downloadBlob, toCsv } from '../lib/exportFiles'
import { Button, CollapsibleCard } from './ui'

function todayStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

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

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

/**
 * Descarga una planilla legible con todos los clientes de una empresa y sus
 * direcciones juntas (una fila por dirección), pensada para ENTREGAR a la
 * empresa. Reutiliza la exportación (clientes + direcciones) y arma un CSV.
 */
export function CompanyClientsExport({
  companyId,
  companyName,
}: {
  companyId: string
  companyName: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setError(null)
    setBusy(true)
    try {
      const bundle = await exportCompanyData(companyId, ['clients', 'addresses'])
      const clients = bundle.tables['clients'] ?? []
      const addresses = bundle.tables['addresses'] ?? []

      // Direcciones agrupadas por cliente.
      const byClient = new Map<string, Record<string, unknown>[]>()
      for (const a of addresses) {
        const cid = str(a.client_id)
        const list = byClient.get(cid) ?? []
        list.push(a)
        byClient.set(cid, list)
      }

      const sorted = [...clients].sort((a, b) =>
        `${str(a.name)} ${str(a.surname)}`.localeCompare(
          `${str(b.name)} ${str(b.surname)}`,
          'es'
        )
      )

      const rows: Record<string, string>[] = []
      for (const c of sorted) {
        const base = {
          Nombre: str(c.name),
          Apellido: str(c.surname),
          Teléfono: str(c.phone),
          'RUT / Cédula': str(c.national_id),
        }
        const addrs = byClient.get(str(c.id)) ?? []
        if (addrs.length === 0) {
          rows.push({
            ...base,
            Dirección: '',
            Comuna: '',
            Etiqueta: '',
            Observación: '',
          })
        } else {
          for (const a of addrs) {
            rows.push({
              ...base,
              Dirección: str(a.address),
              Comuna: str(a.comuna),
              Etiqueta: str(a.label),
              Observación: str(a.observation),
            })
          }
        }
      }

      if (rows.length === 0) {
        setError('Esta empresa aún no tiene clientes.')
        return
      }

      // BOM para que Excel/Sheets lea bien los acentos.
      const csv = '\uFEFF' + toCsv(rows)
      downloadBlob(
        new Blob([csv], { type: 'text/csv;charset=utf-8' }),
        `clientes_${slug(companyName)}_${todayStamp()}.csv`
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <CollapsibleCard
      title="Lista de clientes"
      subtitle="Descarga una planilla con todos los clientes y sus direcciones juntas, fácil de leer y de entregar a la empresa."
    >

      <Button onClick={run} disabled={busy}>
        {busy ? 'Generando…' : '⬇️ Descargar clientes (CSV)'}
      </Button>

      {error && <p className="mt-3 text-sm text-red-600">Error: {error}</p>}

      <p className="mt-3 text-xs text-slate-400">
        Se abre en Excel o Google Sheets. Un cliente con varias direcciones
        aparece en varias filas.
      </p>
    </CollapsibleCard>
  )
}
