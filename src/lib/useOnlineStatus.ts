import { useSyncExternalStore } from 'react'

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

/**
 * true si el navegador tiene conexión. Se actualiza con los eventos
 * `online`/`offline`. Sirve para avisar del estado offline y bloquear las
 * acciones de guardar mientras no haya internet.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true
  )
}
