type QueryLike = { isPlaceholderData: boolean; isLoading: boolean }

/**
 * ¿Algún dato de la vista todavía es del filtro ANTERIOR (placeholder mientras
 * llega el nuevo) o aún no llega? Sirve para no mostrar cifras mezcladas de dos
 * períodos (p. ej. ingresos del mes anterior con egresos del actual). Las
 * consultas deshabilitadas no cuentan (isLoading = cargando de verdad).
 */
export function isRefreshing(...queries: QueryLike[]): boolean {
  return queries.some((q) => q.isPlaceholderData || q.isLoading)
}
