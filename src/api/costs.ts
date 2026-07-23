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

export async function createCostCategory(name: string): Promise<void> {
  const { error } = await supabase.from('cost_categories').insert({ name })
  if (error) throw error
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

export async function listCosts(): Promise<CostWithCategory[]> {
  const { data, error } = await supabase
    .from('costs')
    .select('*, category:cost_categories(*)')
    .order('issue_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as CostWithCategory[]
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
