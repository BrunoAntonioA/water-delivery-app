import { useEffect, useLayoutEffect, useRef } from 'react'

const KEY_PREFIX = 'scroll:'

/**
 * Guarda y restaura la posición de scroll de la ventana para una vista.
 *
 * Pensado para el flujo móvil de WhatsApp: al volver desde otra app el navegador
 * suele recargar la página. Como la lista llega vacía y recién después se llena
 * con los datos del servidor, la altura real no existe al montar; por eso
 * restauramos cuando `ready` es true (el contenido ya ocupa su alto).
 *
 * La posición se guarda en sessionStorage (sobrevive la recarga de la pestaña).
 *
 * @param key   identificador de la vista (p. ej. 'pedidos').
 * @param ready true cuando el contenido ya está pintado (la lista cargó).
 */
export function useScrollRestoration(key: string, ready: boolean) {
  const storageKey = KEY_PREFIX + key
  const restored = useRef(false)

  // Guardar: mientras se hace scroll (con requestAnimationFrame para no saturar)
  // y justo antes de que la pestaña se oculte o descargue, que es el momento en
  // que se va a WhatsApp. Sólo guardamos al ocultar (no al volver), para no pisar
  // el valor bueno con el 0 del inicio de la recarga.
  useEffect(() => {
    let frame = 0
    const save = () => {
      try {
        sessionStorage.setItem(storageKey, String(window.scrollY))
      } catch {
        // sessionStorage puede fallar (modo privado); no es crítico.
      }
    }
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        save()
      })
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') save()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [storageKey])

  // Restaurar una sola vez, cuando el contenido ya está listo. useLayoutEffect
  // corre antes del pintado, así no se ve el salto desde arriba.
  useLayoutEffect(() => {
    if (restored.current || !ready) return
    restored.current = true
    let saved: string | null = null
    try {
      saved = sessionStorage.getItem(storageKey)
    } catch {
      saved = null
    }
    if (saved == null) return
    const y = Number.parseInt(saved, 10)
    if (Number.isFinite(y) && y > 0) window.scrollTo(0, y)
  }, [ready, storageKey])
}
