import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Aviso "hay una versión nueva" (Service Worker). Se usa `registerType: 'prompt'`
 * para NO recargar sola y evitar que a alguien se le corte una acción a medias;
 * el usuario decide cuándo actualizar.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] flex flex-wrap items-center justify-center gap-3 border-t border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 shadow-lg">
      <span className="font-medium">Hay una versión nueva de la app.</span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="rounded-lg bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-700"
        >
          Actualizar
        </button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className="rounded-lg px-3 py-1.5 font-medium text-sky-700 hover:bg-sky-100"
        >
          Ahora no
        </button>
      </div>
    </div>
  )
}
