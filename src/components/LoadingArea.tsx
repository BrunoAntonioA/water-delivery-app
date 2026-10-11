import type { ReactNode } from 'react'

/**
 * Envuelve resultados que dependen de un filtro: mientras `loading`, los atenúa,
 * desenfoca (ilegibles) y bloquea, y muestra un aviso "Cargando…" que queda
 * visible al hacer scroll. Así nunca se lee una cifra que no corresponde al
 * período elegido (ni la del filtro anterior ni un $0 provisorio).
 */
export function LoadingArea({
  loading,
  children,
  label = 'Cargando datos del período…',
}: {
  loading: boolean
  children: ReactNode
  label?: string
}) {
  return (
    <div className="relative" aria-busy={loading}>
      {loading && (
        <div className="pointer-events-none sticky top-3 z-20 flex h-0 items-start justify-center">
          <span
            role="status"
            className="mt-2 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-lg ring-1 ring-slate-200"
          >
            <svg
              className="h-4 w-4 animate-spin text-sky-600"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
            {label}
          </span>
        </div>
      )}
      <div
        className={`transition duration-200 ${
          loading ? 'pointer-events-none select-none opacity-40 blur-[5px]' : ''
        }`}
      >
        {children}
      </div>
    </div>
  )
}
