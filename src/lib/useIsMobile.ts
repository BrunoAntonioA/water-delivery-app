import { useEffect, useState } from 'react'

/**
 * true en pantallas de teléfono (< 640px por defecto). Sirve para mostrar
 * tarjetas en vez de tabla y evitar el scroll horizontal.
 */
export function useIsMobile(query = '(max-width: 639px)'): boolean {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.matchMedia(query).matches
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    setIsMobile(mq.matches)
    return () => mq.removeEventListener('change', handler)
  }, [query])
  return isMobile
}
