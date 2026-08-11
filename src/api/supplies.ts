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

/** Marca/desmarca un insumo como retornable. */
export async function setSupplyReturnable(
  id: string,
  returnable: boolean
): Promise<void> {
  const { error } = await supabase
    .from('supplies')
    .update({ returnable })
    .eq('id', id)
  if (error) throw error
}

/** Renombra un insumo. */
export async function renameSupply(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('supplies')
    .update({ name: name.trim() })
    .eq('id', id)
  if (error) throw error
}
