export type Role = 'superadmin' | 'admin' | 'operador' | 'repartidor'

export interface Profile {
  id: string
  company_id: string | null
  role: Role
  full_name: string | null
  email: string | null
  active: boolean
  created_at: string
}

export interface Company {
  id: string
  name: string
  created_at: string
}

export type ModuleKey =
  | 'pedidos'
  | 'reportes'
  | 'rutas'
  | 'clientes'
  | 'productos'
  | 'costos'
  | 'plantillas'
  | 'usuarios'
  | 'empresas'

// Qué módulos puede ver cada rol.
export const ROLE_MODULES: Record<Role, ModuleKey[]> = {
  superadmin: ['empresas'],
  admin: [
    'pedidos',
    'reportes',
    'rutas',
    'clientes',
    'productos',
    'costos',
    'plantillas',
    'usuarios',
  ],
  operador: ['pedidos', 'reportes', 'clientes', 'productos'],
  repartidor: ['rutas'],
}

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Superadmin',
  admin: 'Administrador',
  operador: 'Operador',
  repartidor: 'Repartidor',
}

// Roles que un admin de empresa puede asignar a sus usuarios (no superadmin).
export const ASSIGNABLE_ROLES: Role[] = ['admin', 'operador', 'repartidor']

export function canAccess(role: Role, module: ModuleKey): boolean {
  return ROLE_MODULES[role].includes(module)
}
