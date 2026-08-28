import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { get, set, del } from 'idb-keyval'

// Clave donde se guarda la caché de React Query en IndexedDB del dispositivo.
export const PERSIST_KEY = 'gestiona-agua-query-cache'

// Persister en IndexedDB (soporta datasets grandes; localStorage se queda corto
// con 1000+ pedidos). Guarda la caché de consultas para verla sin conexión.
export const queryPersister = createAsyncStoragePersister({
  key: PERSIST_KEY,
  storage: {
    getItem: (k) => get(k),
    setItem: (k, v) => set(k, v),
    removeItem: (k) => del(k),
  },
  throttleTime: 1000,
})

/**
 * Borra la caché persistida del dispositivo. Se llama al cerrar sesión o al
 * cambiar de cuenta, para no dejar datos de clientes de una cuenta guardados en
 * el teléfono (privacidad / aislamiento entre empresas).
 */
export async function clearPersistedCache(): Promise<void> {
  try {
    await del(PERSIST_KEY)
  } catch {
    /* IndexedDB no disponible (p. ej. modo privado): no hay nada que borrar. */
  }
}
