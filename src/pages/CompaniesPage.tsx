import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  createCompany,
  createUser,
  deleteCompany,
  listCompanies,
} from '../api/admin'
import { formatDate } from '../lib/format'
import { Modal } from '../components/Modal'
import {
  Button,
  Card,
  EmptyState,
  Label,
  PageHeader,
  Spinner,
  TextInput,
} from '../components/ui'

interface FormState {
  name: string
  adminName: string
  adminEmail: string
  adminPassword: string
}

const emptyForm: FormState = {
  name: '',
  adminName: '',
  adminEmail: '',
  adminPassword: '',
}

export default function CompaniesPage() {
  const qc = useQueryClient()
  const { data: companies, isLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: listCompanies,
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['companies'] })

  const createMutation = useMutation({
    mutationFn: async () => {
      const companyId = await createCompany(form.name.trim())
      await createUser({
        email: form.adminEmail.trim(),
        password: form.adminPassword,
        full_name: form.adminName.trim(),
        role: 'admin',
        company_id: companyId,
      })
    },
    onSuccess: () => {
      invalidate()
      setModalOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCompany(id),
    onSuccess: invalidate,
  })

  function openNew() {
    setForm(emptyForm)
    setModalOpen(true)
  }

  const canSave =
    form.name.trim() &&
    form.adminEmail.trim() &&
    form.adminPassword.length >= 6

  return (
    <div>
      <PageHeader
        title="Empresas"
        subtitle="Crea empresas y su administrador. Cada empresa gestiona sus propios usuarios."
        action={<Button onClick={openNew}>+ Nueva empresa</Button>}
      />

      {isLoading ? (
        <Spinner />
      ) : !companies || companies.length === 0 ? (
        <EmptyState>Aún no hay empresas. Crea la primera.</EmptyState>
      ) : (
        <div className="grid gap-3">
          {companies.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">{c.name}</p>
                  <p className="text-sm text-slate-500">
                    👥 {c.userCount} {c.userCount === 1 ? 'usuario' : 'usuarios'}{' '}
                    · Creada {formatDate(c.created_at)}
                  </p>
                </div>
                <Button
                  variant="danger"
                  onClick={() => {
                    if (
                      confirm(
                        `¿Eliminar "${c.name}"? Se borrarán TODOS sus datos y usuarios.`
                      )
                    )
                      deleteMutation.mutate(c.id)
                  }}
                >
                  Eliminar
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nueva empresa"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createMutation.mutate()
          }}
          className="space-y-4"
        >
          <div>
            <Label>Nombre de la empresa *</Label>
            <TextInput
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Distribuidora XYZ"
              required
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="mb-3 text-sm font-medium text-slate-600">
              Administrador de la empresa
            </p>
            <div className="space-y-3">
              <div>
                <Label>Nombre</Label>
                <TextInput
                  value={form.adminName}
                  onChange={(e) =>
                    setForm({ ...form, adminName: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>Correo *</Label>
                <TextInput
                  type="email"
                  value={form.adminEmail}
                  onChange={(e) =>
                    setForm({ ...form, adminEmail: e.target.value })
                  }
                  required
                />
              </div>
              <div>
                <Label>Contraseña * (mín. 6 caracteres)</Label>
                <TextInput
                  type="text"
                  value={form.adminPassword}
                  onChange={(e) =>
                    setForm({ ...form, adminPassword: e.target.value })
                  }
                  required
                />
              </div>
            </div>
          </div>

          {createMutation.isError && (
            <p className="text-sm text-red-600">
              Error: {(createMutation.error as Error).message}
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
            <Button type="submit" disabled={!canSave || createMutation.isPending}>
              {createMutation.isPending ? 'Creando…' : 'Crear empresa'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
