import { supabase } from '../lib/supabase'
import type { Provider, SupplyPurchaseDetail } from '../types/db'

// --- Proveedores ---

export async function listProviders(): Promise<Provider[]> {
  const { data, error } = await supabase
    .from('providers')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Provider[]
}

/** Crea un proveedor y lo devuelve (para seleccionarlo de inmediato). */
export async function createProvider(
  name: string,
  phone?: string
): Promise<Provider> {
  const { data, error } = await supabase
    .from('providers')
    .insert({ name: name.trim(), phone: phone?.trim() || null })
    .select('*')
    .single()
  if (error) throw error
  return data as Provider
}

export async function updateProvider(
  id: string,
  input: { name: string; phone?: string }
): Promise<void> {
  const { error } = await supabase
    .from('providers')
    .update({ name: input.name.trim(), phone: input.phone?.trim() || null })
    .eq('id', id)
  if (error) throw error
}

export async function deleteProvider(id: string): Promise<void> {
  const { error } = await supabase.from('providers').delete().eq('id', id)
  if (error) throw error
}

// --- Abastecimientos (compras de insumos) ---

export interface PurchaseItemInput {
  supply_id: string
  quantity: number
  unit_price: number
}

export interface PurchaseInput {
  provider_id: string | null
  purchase_date: string
  notes: string
  items: PurchaseItemInput[]
}

/** Total del abastecimiento = suma de cantidad × precio unitario de cada línea. */
export function purchaseTotal(items: PurchaseItemInput[]): number {
  return items.reduce(
    (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
    0
  )
}

export async function listSupplyPurchases(): Promise<SupplyPurchaseDetail[]> {
  const { data, error } = await supabase
    .from('supply_purchases')
    .select(
      '*, provider:providers(*), items:supply_purchase_items(*, supply:supplies(*))'
    )
    .order('purchase_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as SupplyPurchaseDetail[]
}

export async function createSupplyPurchase(input: PurchaseInput): Promise<void> {
  const { data, error } = await supabase
    .from('supply_purchases')
    .insert({
      provider_id: input.provider_id,
      purchase_date: input.purchase_date,
      notes: input.notes.trim() || null,
      total: purchaseTotal(input.items),
    })
    .select('id')
    .single()
  if (error) throw error

  if (input.items.length > 0) {
    const { error: itemsErr } = await supabase.from('supply_purchase_items').insert(
      input.items.map((it) => ({
        purchase_id: data.id as string,
        supply_id: it.supply_id,
        quantity: it.quantity,
        unit_price: it.unit_price,
      }))
    )
    if (itemsErr) throw itemsErr
  }
}

export async function updateSupplyPurchase(
  id: string,
  input: PurchaseInput
): Promise<void> {
  const { error } = await supabase
    .from('supply_purchases')
    .update({
      provider_id: input.provider_id,
      purchase_date: input.purchase_date,
      notes: input.notes.trim() || null,
      total: purchaseTotal(input.items),
    })
    .eq('id', id)
  if (error) throw error

  // Se reemplazan las líneas: se borran las anteriores y se insertan las nuevas.
  const { error: delErr } = await supabase
    .from('supply_purchase_items')
    .delete()
    .eq('purchase_id', id)
  if (delErr) throw delErr

  if (input.items.length > 0) {
    const { error: itemsErr } = await supabase.from('supply_purchase_items').insert(
      input.items.map((it) => ({
        purchase_id: id,
        supply_id: it.supply_id,
        quantity: it.quantity,
        unit_price: it.unit_price,
      }))
    )
    if (itemsErr) throw itemsErr
  }
}

export async function deleteSupplyPurchase(id: string): Promise<void> {
  // Las líneas se borran en cascada (FK on delete cascade).
  const { error } = await supabase.from('supply_purchases').delete().eq('id', id)
  if (error) throw error
}
