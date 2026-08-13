import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  createUser,
  deactivateUser,
  deleteUser,
  listUsersByCompany,
  reactivateUser,
  updateUser,
  updateUserRole,
} from '../api/admin'
import { useAuth } from '../lib/auth'
import {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  type Profile,
  type Role,
} from '../types/auth'
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
  // Aviso tras crear un usuario (p. ej. "se envió un correo de confirmación").
  const [notice, setNotice] = useState<string | null>(null)

  // Edición (contraseña / nombre) de un usuario existente.
  const [editUser, setEditUser] = useState<Profile | null>(null)
  const [editForm, setEditForm] = useState({ full_name: '', password: '' })

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
    onSuccess: (result) => {
      const email = form.email.trim()
      // El mensaje del correo SÓLO cuando realmente se envió la verificación.
      if (result.emailSent) {
        setNotice(
          `Usuario creado. Se envió un correo de confirmación a ${email}; debe abrir el enlace para activar su cuenta.`
        )
      } else if (result.status === 'reactivated') {
        setNotice(`Usuario reactivado (${email}).`)
      } else {
        setNotice(`Usuario creado (${email}).`)
      }
      invalidate()
      setModalOpen(false)
    },
  })

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      updateUserRole(id, role),
    onSuccess: invalidate,
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      updateUser(editUser!.id, {
        full_name: editForm.full_name.trim(),
        password: editForm.password || undefined,
      }),
    onSuccess: () => {
      invalidate()
      setEditUser(null)
    },
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

  function openEdit(u: Profile) {
    setEditUser(u)
    setEditForm({ full_name: u.full_name ?? '', password: '' })
  }

  const canSave = form.email.trim() && form.password.length >= 8 && form.role

  const pwOk = editForm.password === '' || editForm.password.length >= 8
  const nameChanged =
    editUser != null && editForm.full_name.trim() !== (editUser.full_name ?? '')
  const canSaveEdit =
    pwOk && (editForm.password.length >= 8 || nameChanged)

  return (
    <div>
      {notice && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <span>📧 {notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Cerrar aviso"
            className="shrink-0 text-emerald-600 hover:text-emerald-800"
          >
            ✕
          </button>
        </div>
      )}
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
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 break-words">
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
                    <p className="text-sm text-slate-500 break-all">{u.email}</p>
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
                    <Button variant="secondary" onClick={() => openEdit(u)}>
                      Editar
                    </Button>
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
            <Label>Contraseña * (mín. 8 caracteres)</Label>
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

          <div className="sticky bottom-0 -mx-5 -mb-4 mt-2 flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
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

      <Modal
        open={editUser != null}
        onClose={() => setEditUser(null)}
        title={`Editar ${editUser?.full_name || editUser?.email || 'usuario'}`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (canSaveEdit) updateMutation.mutate()
          }}
          className="space-y-4"
        >
          <div>
            <Label>Nombre</Label>
            <TextInput
              value={editForm.full_name}
              onChange={(e) =>
                setEditForm({ ...editForm, full_name: e.target.value })
              }
            />
          </div>
          <div>
            <Label>Nueva contraseña (mín. 8; deja vacío para no cambiarla)</Label>
            <TextInput
              type="text"
              value={editForm.password}
              onChange={(e) =>
                setEditForm({ ...editForm, password: e.target.value })
              }
              placeholder="Nueva contraseña"
            />
            {editForm.password !== '' && editForm.password.length < 8 && (
              <p className="mt-1 text-sm text-red-600">
                La contraseña debe tener al menos 8 caracteres.
              </p>
            )}
          </div>

          {updateMutation.isError && (
            <p className="text-sm text-red-600">
              Error: {(updateMutation.error as Error).message}
            </p>
          )}

          <div className="sticky bottom-0 -mx-5 -mb-4 mt-2 flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditUser(null)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!canSaveEdit || updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
