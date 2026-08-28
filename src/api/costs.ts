import { supabase } from '../lib/supabase'
import type { Cost, CostCategory, CostWithCategory } from '../types/db'

// --- Categorías de costo ---

export async function listCostCategories(): Promise<CostCategory[]> {
  const { data, error } = await supabase
    .from('cost_categories')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as CostCategory[]
}

/** Crea una categoría de costo y devuelve su id (para seleccionarla al vuelo). */
export async function createCostCategory(name: string): Promise<string> {
  const { data, error } = await supabase
    .from('cost_categories')
    .insert({ name })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export async function deleteCostCategory(id: string): Promise<void> {
  const { error } = await supabase.from('cost_categories').delete().eq('id', id)
  if (error) throw error
}

// --- Costos ---

export interface CostInput {
  name: string
  description: string
  issue_date: string
  category_id: string | null
  amount: number
}

type CreatorProfile = { full_name: string | null; email: string | null } | null

export async function listCosts(): Promise<CostWithCategory[]> {
  // Se pagina con .range(): Supabase corta en 1000 filas y los costos crecen a
  // diario, así que sin esto la lista (y los totales que se calculan sobre ella)
  // quedarían cortos al pasar los 1000. Orden estable con id de desempate.
  const PAGE = 1000
  const all: CostWithCategory[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('costs')
      .select(
        '*, category:cost_categories(*), creator:profiles!created_by(full_name, email)'
      )
      .order('issue_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const batch = (
      (data ?? []) as (CostWithCategory & { creator: CreatorProfile })[]
    ).map(({ creator, ...rest }) => ({
      ...rest,
      creatorName: creator?.full_name || creator?.email || null,
    }))
    all.push(...batch)
    if (batch.length < PAGE) break
  }
  return all
}

export async function createCost(input: CostInput): Promise<void> {
  const { error } = await supabase.from('costs').insert({
    name: input.name,
    description: input.description || null,
    issue_date: input.issue_date,
    category_id: input.category_id,
    amount: input.amount,
  })
  if (error) throw error
}

export async function updateCost(id: string, input: CostInput): Promise<void> {
  const { error } = await supabase
    .from('costs')
    .update({
      name: input.name,
      description: input.description || null,
      issue_date: input.issue_date,
      category_id: input.category_id,
      amount: input.amount,
    })
    .eq('id', id)
  if (error) throw error
}

export async function deleteCost(id: string): Promise<void> {
  const { error } = await supabase.from('costs').delete().eq('id', id)
  if (error) throw error
}

export type { Cost }
