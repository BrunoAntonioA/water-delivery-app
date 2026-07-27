import { PRODUCT_IMAGES_BUCKET, supabase } from '../lib/supabase'
import type { Product } from '../types/db'

export interface ProductInput {
  name: string
  description: string
  price: number
  image_url: string | null
  supplies: { supply_id: string; quantity: number }[]
}

export async function listProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*, supplies:product_supplies(supply_id, quantity)')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Product[]
}

/** Combina insumos repetidos sumando cantidades y descarta los inválidos. */
function normalizeSupplies(
  supplies: { supply_id: string; quantity: number }[]
): { supply_id: string; quantity: number }[] {
  const m = new Map<string, number>()
  for (const s of supplies) {
    if (!s.supply_id) continue
    const q = Math.max(1, Math.trunc(Number(s.quantity) || 0))
    m.set(s.supply_id, (m.get(s.supply_id) ?? 0) + q)
  }
  return Array.from(m, ([supply_id, quantity]) => ({ supply_id, quantity }))
}

async function replaceProductSupplies(
  productId: string,
  supplies: { supply_id: string; quantity: number }[]
): Promise<void> {
  const { error: delErr } = await supabase
    .from('product_supplies')
    .delete()
    .eq('product_id', productId)
  if (delErr) throw delErr

  const rows = normalizeSupplies(supplies).map((s) => ({
    product_id: productId,
    supply_id: s.supply_id,
    quantity: s.quantity,
  }))
  if (rows.length > 0) {
    const { error: insErr } = await supabase
      .from('product_supplies')
      .insert(rows)
    if (insErr) throw insErr
  }
}

export async function createProduct(input: ProductInput): Promise<void> {
  const { data, error } = await supabase
    .from('products')
    .insert({
      name: input.name,
      description: input.description || null,
      price: input.price,
      image_url: input.image_url,
    })
    .select('id')
    .single()
  if (error) throw error
  await replaceProductSupplies(data.id as string, input.supplies)
}

export async function updateProduct(
  id: string,
  input: ProductInput
): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update({
      name: input.name,
      description: input.description || null,
      price: input.price,
      image_url: input.image_url,
    })
    .eq('id', id)
  if (error) throw error
  await replaceProductSupplies(id, input.supplies)
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) throw error
}

/**
 * Sube una imagen al bucket y devuelve su URL pública. Se guarda bajo la
 * "carpeta" de la empresa ("<companyId>/<uuid>.<ext>") para que la política de
 * Storage sólo permita a cada empresa escribir en la suya.
 */
export async function uploadProductImage(
  file: File,
  companyId: string
): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg'
  // Nombre único sin depender de Math.random / Date en tiempo de render.
  const path = `${companyId}/${crypto.randomUUID()}.${ext}`

  const { error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type })
  if (error) throw error

  const { data } = supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .getPublicUrl(path)
  return data.publicUrl
}
