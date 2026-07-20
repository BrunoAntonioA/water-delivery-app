import { PRODUCT_IMAGES_BUCKET, supabase } from '../lib/supabase'
import type { Product } from '../types/db'

export interface ProductInput {
  name: string
  description: string
  price: number
  image_url: string | null
}

export async function listProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Product[]
}

export async function createProduct(input: ProductInput): Promise<void> {
  const { error } = await supabase.from('products').insert({
    name: input.name,
    description: input.description || null,
    price: input.price,
    image_url: input.image_url,
  })
  if (error) throw error
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
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) throw error
}

/** Sube una imagen al bucket y devuelve su URL pública. */
export async function uploadProductImage(file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg'
  // Nombre único sin depender de Math.random / Date en tiempo de render.
  const path = `${crypto.randomUUID()}.${ext}`

  const { error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type })
  if (error) throw error

  const { data } = supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .getPublicUrl(path)
  return data.publicUrl
}
