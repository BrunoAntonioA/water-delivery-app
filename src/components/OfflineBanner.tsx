import { useOnlineStatus } from '../lib/useOnlineStatus'

/**
 * Barra fija arriba que aparece SOLO sin conexión. Deja claro que se están
 * viendo datos guardados y que no se puede guardar hasta que vuelva el internet.
 */
export function OfflineBanner() {
  const online = useOnlineStatus()
  if (online) return null
  return (
    <div className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white shadow-md">
      <span aria-hidden>📴</span>
      Sin conexión — estás viendo datos guardados. No puedes guardar cambios
      hasta que vuelva el internet.
    </div>
  )
}
