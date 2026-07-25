import { supabase } from '../lib/supabase'
import type { Supply } from '../types/db'

export async function listSupplies(): Promise<Supply[]> {
  const { data, error } = await supabase
    .from('supplies')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Supply[]
}

/** Crea un insumo y devuelve su id. */
export async function createSupply(name: string): Promise<string> {
  const { data, error } = await supabase
    .from('supplies')
    .insert({ name: name.trim() })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}
