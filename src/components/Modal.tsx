import type { ReactNode } from 'react'
import { useEffect } from 'react'

// Cuántos modales hay abiertos a la vez: sirve para no reactivar el scroll del
// fondo cuando se cierra un modal mientras otro sigue abierto (modales anidados).
let openModalCount = 0

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Bloquea el scroll del <body> mientras el modal está abierto. Sin esto, en
  // móvil el gesto de desplazamiento se "engancha" al fondo en vez de al
  // contenido del modal y parece que el scroll se bloqueara (no se podía bajar
  // hasta los botones). Se cuenta cuántos hay abiertos para restaurarlo bien.
  useEffect(() => {
    if (!open) return
    if (openModalCount === 0) {
      document.body.dataset.prevOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    openModalCount += 1
    return () => {
      openModalCount -= 1
      if (openModalCount === 0) {
        document.body.style.overflow = document.body.dataset.prevOverflow ?? ''
        delete document.body.dataset.prevOverflow
      }
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-slate-900/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[90dvh] w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} flex-col rounded-2xl bg-white shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <h2 className="min-w-0 truncate text-lg font-semibold text-slate-900">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Cerrar"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  )
}
