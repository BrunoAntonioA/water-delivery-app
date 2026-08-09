import { useState } from 'react'

/**
 * Logo de la marca (public/logo.png). Si el archivo no existe todavía, muestra
 * un respaldo con el emoji 💧 y el nombre, para no dejar un ícono roto.
 */
export function Logo({ className = '' }: { className?: string }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <span className="text-5xl leading-none" aria-hidden>
          💧
        </span>
      </div>
    )
  }

  return (
    <img
      src="/logo.png"
      alt="Gestiona Agua"
      className={className}
      onError={() => setFailed(true)}
    />
  )
}
