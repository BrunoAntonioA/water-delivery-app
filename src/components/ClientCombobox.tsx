import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClientWithAddresses } from '../types/db'
import { TextInput } from './ui'

/**
 * Buscador de clientes: se escribe para filtrar por nombre o por teléfono,
 * y cada resultado muestra el teléfono. Al elegir uno se muestra como chip.
 */
export function ClientCombobox({
  clients,
  value,
  onChange,
}: {
  clients: ClientWithAddresses[]
  value: string
  onChange: (clientId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = clients.find((c) => c.id === value)

  // Cerrar el menú al hacer clic fuera.
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    const qDigits = q.replace(/\D/g, '')
    return clients.filter((c) => {
      const fullName = `${c.name} ${c.surname}`.toLowerCase()
      const phone = c.phone.toLowerCase()
      const phoneDigits = c.phone.replace(/\D/g, '')
      return (
        fullName.includes(q) ||
        phone.includes(q) ||
        (qDigits.length > 0 && phoneDigits.includes(qDigits))
      )
    })
  }, [clients, query])

  // Cliente seleccionado: se muestra como chip con opción de cambiarlo.
  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
        <span className="truncate">
          <span className="font-medium text-slate-800">
            {selected.name} {selected.surname}
          </span>
          <span className="text-slate-400"> · 📞 {selected.phone}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            onChange('')
            setQuery('')
            setOpen(true)
          }}
          className="ml-2 shrink-0 rounded-lg px-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Cambiar cliente"
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <TextInput
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="Buscar por nombre o teléfono…"
        autoComplete="off"
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-400">
              Sin resultados
            </li>
          ) : (
            filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(c.id)
                    setOpen(false)
                  }}
                  className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-sky-50"
                >
                  <span className="text-sm font-medium text-slate-800">
                    {c.name} {c.surname}
                  </span>
                  <span className="text-xs text-slate-500">📞 {c.phone}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
