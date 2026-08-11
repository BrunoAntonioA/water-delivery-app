import { useState } from 'react'
import { Modal } from './Modal'

/**
 * Ícono de nota clickeable. Aparece SÓLO si hay nota del pedido o una
 * observación de la dirección; al tocarlo abre un modal con el texto (un modal
 * para que no se recorte dentro de las tablas con overflow). Se usa en la lista
 * de Pedidos y en las paradas de una ruta.
 */
export function NoteButton({
  note,
  observation,
  className = '',
}: {
  note?: string | null
  observation?: string | null
  className?: string
}) {
  const n = (note ?? '').trim()
  const o = (observation ?? '').trim()
  const [open, setOpen] = useState(false)

  if (!n && !o) return null

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        aria-label="Ver nota"
        title="Ver nota"
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-amber-500 transition-colors hover:bg-amber-50 ${className}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M6 3h9l4 4v14H6z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M9 11h6M9 15h4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Nota">
        <div className="space-y-2 text-sm leading-relaxed text-slate-700">
          {o && (
            <p className="flex items-start gap-1.5 break-words">
              <span aria-hidden>📍</span>
              <span className="min-w-0">{o}</span>
            </p>
          )}
          {n && (
            <p className="flex items-start gap-1.5 break-words">
              <span aria-hidden>📝</span>
              <span className="min-w-0">{n}</span>
            </p>
          )}
        </div>
      </Modal>
    </>
  )
}

/**
 * Nota/observación mostrada SIEMPRE como texto (para la vista de teléfono).
 * Devuelve null si no hay nada que mostrar.
 */
export function NoteInline({
  note,
  observation,
  className = '',
}: {
  note?: string | null
  observation?: string | null
  className?: string
}) {
  const n = (note ?? '').trim()
  const o = (observation ?? '').trim()
  if (!n && !o) return null
  return (
    <div
      className={`space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 ${className}`}
    >
      {o && (
        <p className="flex items-start gap-1.5">
          <span aria-hidden>📍</span>
          <span className="min-w-0 break-words">{o}</span>
        </p>
      )}
      {n && (
        <p className="flex items-start gap-1.5">
          <span aria-hidden>📝</span>
          <span className="min-w-0 break-words">{n}</span>
        </p>
      )}
    </div>
  )
}
