import { supabase } from '../lib/supabase'
import type { WhatsappTemplate } from '../types/db'

export async function listTemplates(): Promise<WhatsappTemplate[]> {
  const { data, error } = await supabase
    .from('whatsapp_templates')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as WhatsappTemplate[]
}

export async function createTemplate(
  name: string,
  content: string
): Promise<void> {
  const { error } = await supabase
    .from('whatsapp_templates')
    .insert({ name, content })
  if (error) throw error
}

export async function updateTemplate(
  id: string,
  name: string,
  content: string
): Promise<void> {
  const { error } = await supabase
    .from('whatsapp_templates')
    .update({ name, content })
    .eq('id', id)
  if (error) throw error
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from('whatsapp_templates')
    .delete()
    .eq('id', id)
  if (error) throw error
}
