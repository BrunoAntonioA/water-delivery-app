import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  createUser,
  deactivateUser,
  deleteUser,
  listUsersByCompany,
  reactivateUser,
  updateUserRole,
} from '../api/admin'
import { useAuth } from '../lib/auth'
import { ASSIGNABLE_ROLES, ROLE_LABELS, type Role } from '../types/auth'
import { Modal } from './Modal'
import { Button, Card, EmptyState, Label, Spinner, TextInput } from './ui'

interface FormState {
  full_name: string
  email: string
  password: string
  role: Role
}

const emptyForm: FormState = {
  full_name: '',
  email: '',
  password: '',
  role: 'operador',
}

/**
 * Gestión de usuarios de una empresa (listar, crear, cambiar rol, desactivar,
 * reactivar y eliminar). Se usa en el módulo Usuarios (empresa del admin) y en
 * el detalle de Empresas del superadmin.
 */
export function CompanyUsers({ companyId }: { companyId: string }) {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const key = ['users', companyId]

  const { data: users, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => listUsersByCompany(companyId),
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)

  const invalidate = () => qc.invalidateQueries({ queryKey: key })

  const createMutation = useMutation({
    mutationFn: () =>
      createUser({
        email: form.email.trim(),
        password: form.password,
        full_name: form.full_name.trim(),
        role: form.role,
        company_id: companyId,
      }),
    onSuccess: () => {
      invalidate()
      setModalOpen(false)
    },
  })

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      updateUserRole(id, role),
    onSuccess: invalidate,
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateUser(id),
    onSuccess: invalidate,
  })

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => reactivateUser(id),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: invalidate,
  })

  function openNew() {
    setForm(emptyForm)
    setModalOpen(true)
  }

  const canSave = form.email.trim() && form.password.length >= 6 && form.role

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-slate-500">
          {users?.length ?? 0} {(users?.length ?? 0) === 1 ? 'usuario' : 'usuarios'}
        </span>
        <Button onClick={openNew}>+ Nuevo usuario</Button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : !users || users.length === 0 ? (
        <EmptyState>Aún no hay usuarios.</EmptyState>
      ) : (
        <div className="grid gap-3">
          {users.map((u) => {
            const isSelf = u.id === profile?.id
            return (
              <Card key={u.id} className={`p-4 ${u.active ? '' : 'opacity-60'}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {u.full_name || u.email}
                      {isSelf && (
                        <span className="ml-2 text-xs text-slate-400">(tú)</span>
                      )}
                      {!u.active && (
                        <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                          Desactivado
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-slate-500">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={u.role}
                      disabled={isSelf || !u.active || roleMutation.isPending}
                      onChange={(e) =>
                        roleMutation.mutate({
                          id: u.id,
                          role: e.target.value as Role,
                        })
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 disabled:bg-slate-50"
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    {!isSelf && u.active && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          if (
                            confirm(
                              `¿Desactivar a ${u.full_name || u.email}? Perderá el acceso, pero puedes reactivarlo luego.`
                            )
                          )
                            deactivateMutation.mutate(u.id)
                        }}
                      >
                        Desactivar
                      </Button>
                    )}
                    {!isSelf && !u.active && (
                      <Button
                        variant="success"
                        onClick={() => reactivateMutation.mutate(u.id)}
                      >
                        Reactivar
                      </Button>
                    )}
                    {!isSelf && (
                      <Button
                        variant="danger"
                        onClick={() => {
                          if (
                            confirm(
                              `¿Eliminar definitivamente a ${u.full_name || u.email}? Se quitará de la lista y perderá el acceso. Esta acción no se puede deshacer.`
                            )
                          )
                            deleteMutation.mutate(u.id)
                        }}
                      >
                        Eliminar
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nuevo usuario"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            createMutation.mutate()
          }}
          className="space-y-4"
        >
          <div>
            <Label>Nombre</Label>
            <TextInput
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </div>
          <div>
            <Label>Correo *</Label>
            <TextInput
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>
          <div>
            <Label>Contraseña * (mín. 6 caracteres)</Label>
            <TextInput
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="La compartes con el usuario"
              required
            />
          </div>
          <div>
            <Label>Rol *</Label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
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
              {createMutation.isPending ? 'Creando…' : 'Crear usuario'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
