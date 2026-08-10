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
  modules?: ModuleKey[]
  created_at: string
}

export type ModuleKey =
  | 'pedidos'
  | 'reportes'
  | 'entregas'
  | 'rutas'
  | 'clientes'
  | 'productos'
  | 'costos'
  | 'abastecimiento'
  | 'plantillas'
  | 'usuarios'
  | 'suscripcion'
  | 'empresas'
  | 'planes'

// Módulos "de cuenta": siempre visibles para quien tenga el rol, sin depender
// del plan de la empresa (p. ej. ver y pagar la suscripción).
export const ALWAYS_ON_MODULES: ModuleKey[] = ['suscripcion']

// Qué módulos puede ver cada rol.
export const ROLE_MODULES: Record<Role, ModuleKey[]> = {
  superadmin: ['empresas', 'planes'],
  admin: [
    'pedidos',
    'reportes',
    'entregas',
    'rutas',
    'clientes',
    'productos',
    'costos',
    'abastecimiento',
    'plantillas',
    'usuarios',
    'suscripcion',
  ],
  operador: [
    'pedidos',
    'reportes',
    'clientes',
    'productos',
    'costos',
    'abastecimiento',
  ],
  repartidor: ['rutas', 'entregas', 'costos'],
}

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Superadmin',
  admin: 'Administrador',
  operador: 'Operador',
  repartidor: 'Repartidor',
}

// Roles que un admin de empresa puede asignar a sus usuarios (no superadmin).
export const ASSIGNABLE_ROLES: Role[] = ['admin', 'operador', 'repartidor']

// Módulos que el superadmin puede habilitar/deshabilitar por empresa.
// ('empresas' no se incluye: es exclusivo del superadmin.)
export const COMPANY_MODULES: ModuleKey[] = [
  'rutas',
  'entregas',
  'pedidos',
  'clientes',
  'productos',
  'costos',
  'abastecimiento',
  'reportes',
  'plantillas',
  'usuarios',
]

export const MODULE_LABELS: Record<ModuleKey, string> = {
  pedidos: 'Pedidos',
  reportes: 'Reportes',
  entregas: 'Entregas',
  rutas: 'Rutas',
  clientes: 'Clientes',
  productos: 'Productos',
  costos: 'Costos',
  abastecimiento: 'Suministros',
  plantillas: 'Plantillas',
  usuarios: 'Usuarios',
  suscripcion: 'Suscripción',
  empresas: 'Empresas',
  planes: 'Planes',
}

/**
 * Módulos efectivos de un usuario: los de su rol, limitados a los que su empresa
 * tiene habilitados. El superadmin no depende de empresa. Si la empresa no trae
 * lista de módulos (dato viejo), no se bloquea nada.
 */
export function effectiveModules(
  role: Role,
  companyModules: ModuleKey[] | undefined | null
): ModuleKey[] {
  const roleModules = ROLE_MODULES[role]
  if (role === 'superadmin' || !companyModules) return roleModules
  return roleModules.filter(
    (m) => companyModules.includes(m) || ALWAYS_ON_MODULES.includes(m)
  )
}
