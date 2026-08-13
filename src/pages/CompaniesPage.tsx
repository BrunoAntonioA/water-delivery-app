import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  createCompany,
  createUser,
  deleteCompany,
  isPaidCompany,
  listCompanies,
  verifyPassword,
  type CompanySummary,
} from '../api/admin'
import { useAuth } from '../lib/auth'
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
  const { session } = useAuth()
  const { data: companies, isLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: listCompanies,
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)

  // Eliminación de empresa: exige escribir la contraseña del superadmin dos
  // veces (segundo factor) antes de un borrado irreversible.
  const [deleteTarget, setDeleteTarget] = useState<CompanySummary | null>(null)
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')

  function openDelete(c: CompanySummary) {
    setDeleteTarget(c)
    setPw1('')
    setPw2('')
  }
  function closeDelete() {
    setDeleteTarget(null)
    setPw1('')
    setPw2('')
  }

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
    mutationFn: async () => {
      if (!deleteTarget) return
      if (isPaidCompany(deleteTarget)) {
        throw new Error(
          'No se puede eliminar una empresa activa (pagada). Cancela o pausa su suscripción primero.'
        )
      }
      const email = session?.user.email
      if (!email) throw new Error('No se pudo identificar tu sesión.')
      if (pw1 !== pw2) throw new Error('Las contraseñas no coinciden.')
      const ok = await verifyPassword(email, pw1)
      if (!ok) throw new Error('Contraseña incorrecta.')
      await deleteCompany(deleteTarget.id)
    },
    onSuccess: () => {
      invalidate()
      closeDelete()
    },
  })

  const canDelete = pw1.length > 0 && pw1 === pw2

  function openNew() {
    setForm(emptyForm)
    setModalOpen(true)
  }

  const canSave =
    form.name.trim() &&
    form.adminEmail.trim() &&
    form.adminPassword.length >= 8

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
                <Link to={`/empresas/${c.id}`} className="group min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 group-hover:text-sky-700">
                    {c.name}
                  </p>
                  <p className="text-sm text-slate-500">
                    👥 {c.userCount} {c.userCount === 1 ? 'usuario' : 'usuarios'}{' '}
                    · Creada {formatDate(c.created_at)}
                  </p>
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/empresas/${c.id}`}>
                    <Button variant="secondary">Ver usuarios</Button>
                  </Link>
                  <Button
                    variant="danger"
                    disabled={isPaidCompany(c)}
                    title={
                      isPaidCompany(c)
                        ? 'Empresa activa: pausa o cancela su suscripción desde el detalle de la empresa para poder eliminarla.'
                        : undefined
                    }
                    onClick={() => openDelete(c)}
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
                <Label>Contraseña * (mín. 8 caracteres)</Label>
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

          <div className="sticky bottom-0 -mx-5 -mb-4 mt-2 flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
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

      {/* --- Eliminar empresa: irreversible + doble contraseña --- */}
      <Modal
        open={deleteTarget != null}
        onClose={closeDelete}
        title="Eliminar empresa"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (canDelete) deleteMutation.mutate()
          }}
          className="space-y-4"
        >
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm font-semibold text-red-800">
              ⚠️ Esta acción es IRREVERSIBLE
            </p>
            <p className="mt-1 text-sm text-red-700">
              Se eliminará <strong>«{deleteTarget?.name}»</strong> y se perderá{' '}
              <strong>toda su información</strong>: usuarios, clientes, pedidos,
              rutas, costos, suministros y suscripción. No se puede deshacer ni
              recuperar.
            </p>
          </div>

          <p className="text-sm text-slate-600">
            Para confirmar, escribe <strong>tu contraseña de superadmin</strong>{' '}
            dos veces.
          </p>

          <div>
            <Label>Tu contraseña</Label>
            <TextInput
              type="password"
              value={pw1}
              onChange={(e) => setPw1(e.target.value)}
              autoComplete="off"
              placeholder="Contraseña"
            />
          </div>
          <div>
            <Label>Repite tu contraseña</Label>
            <TextInput
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              autoComplete="off"
              placeholder="Contraseña"
            />
            {pw2.length > 0 && pw1 !== pw2 && (
              <p className="mt-1 text-sm text-red-600">
                Las contraseñas no coinciden.
              </p>
            )}
          </div>

          {deleteMutation.isError && (
            <p className="text-sm text-red-600">
              {(deleteMutation.error as Error).message}
            </p>
          )}

          <div className="sticky bottom-0 -mx-5 -mb-4 mt-2 flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
            <Button type="button" variant="secondary" onClick={closeDelete}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={!canDelete || deleteMutation.isPending}
            >
              {deleteMutation.isPending
                ? 'Eliminando…'
                : 'Eliminar definitivamente'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
