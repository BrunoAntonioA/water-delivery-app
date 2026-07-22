import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate,
} from '../api/templates'
import type { WhatsappTemplate } from '../types/db'
import { TEMPLATE_PLACEHOLDERS } from '../lib/whatsapp'
import { Modal } from '../components/Modal'
import {
  Button,
  Card,
  EmptyState,
  Label,
  PageHeader,
  Spinner,
  TextArea,
  TextInput,
} from '../components/ui'

interface FormState {
  name: string
  content: string
}

const emptyForm: FormState = { name: '', content: '' }

export default function TemplatesPage() {
  const qc = useQueryClient()
  const { data: templates, isLoading } = useQuery({
    queryKey: ['whatsapp_templates'],
    queryFn: listTemplates,
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<WhatsappTemplate | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['whatsapp_templates'] })

  const saveMutation = useMutation({
    mutationFn: () =>
      editing
        ? updateTemplate(editing.id, form.name.trim(), form.content)
        : createTemplate(form.name.trim(), form.content),
    onSuccess: () => {
      invalidate()
      setModalOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: invalidate,
  })

  function openNew() {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  function openEdit(t: WhatsappTemplate) {
    setEditing(t)
    setForm({ name: t.name, content: t.content })
    setModalOpen(true)
  }

  const canSave = form.name.trim() && form.content.trim()

  return (
    <div>
      <PageHeader
        title="Plantillas"
        subtitle="Mensajes de WhatsApp reutilizables para cobrar y contactar clientes."
        action={<Button onClick={openNew}>+ Nueva plantilla</Button>}
      />

      {isLoading ? (
        <Spinner />
      ) : !templates || templates.length === 0 ? (
        <EmptyState>
          Aún no tienes plantillas. Crea la primera con “Nueva plantilla”.
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {templates.map((t) => (
            <Card key={t.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{t.name}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                    {t.content}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => openEdit(t)}>
                    Editar
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (confirm(`¿Eliminar la plantilla "${t.name}"?`))
                        deleteMutation.mutate(t.id)
                    }}
                  >
                    Eliminar
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar plantilla' : 'Nueva plantilla'}
        wide
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            saveMutation.mutate()
          }}
          className="space-y-4"
        >
          <div>
            <Label>Nombre *</Label>
            <TextInput
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ej: Cobro amable"
              required
            />
          </div>
          <div>
            <Label>Contenido *</Label>
            <TextArea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={7}
              placeholder={
                'Hola {cliente}, le saluda {empresa}.\n\n{detalle}\n\nTotal a pagar: {total}\n\n¡Gracias!'
              }
              required
            />
          </div>

          <div className="rounded-lg bg-slate-50 p-3">
            <p className="mb-2 text-xs font-medium text-slate-600">
              Variables disponibles (se reemplazan al enviar):
            </p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_PLACEHOLDERS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  title={p.label}
                  onClick={() =>
                    setForm((f) => ({ ...f, content: f.content + p.key }))
                  }
                  className="rounded-full bg-white px-2 py-0.5 font-mono text-xs text-sky-700 ring-1 ring-slate-200 hover:ring-sky-400"
                >
                  {p.key}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {'{detalle}'} y {'{total}'} sólo se llenan al cobrar un pedido; al
              contactar un cliente quedan vacíos.
            </p>
          </div>

          {saveMutation.isError && (
            <p className="text-sm text-red-600">
              Error al guardar: {(saveMutation.error as Error).message}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSave || saveMutation.isPending}>
              {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
