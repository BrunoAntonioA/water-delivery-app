-- ============================================================================
--  Diagnóstico de aislamiento por empresa (RLS).
--  Ejecuta cada bloque en el SQL Editor de Supabase y revisa el resultado.
--  NOTA: en el SQL Editor corres como rol 'postgres' (dueño), que IGNORA RLS.
--  Estas consultas inspeccionan la CONFIGURACIÓN de RLS, no la evalúan como
--  usuario. La prueba real de fuga se hace desde la app, logueado.
-- ============================================================================

-- 1) ¿Está RLS ACTIVADO en cada tabla? rowsecurity debe ser TRUE en todas las
--    tablas de datos. Si alguna aparece en false, esa tabla filtra datos.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'clients','addresses','products','supplies','product_supplies',
    'whatsapp_templates','cost_categories','costs','orders','order_items',
    'routes','route_stops','route_loads','companies','profiles'
  )
order by rowsecurity, tablename;  -- las que estén en false salen primero

-- 2) Políticas existentes. Busca cualquier política cuyo `qual` sea `true` o
--    NULL (acceso abierto) o un nombre 'allow_all_*' sobrante: eso es una fuga.
select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 3) Tablas de datos SIN ninguna política (con RLS activado y 0 políticas nadie
--    ve nada; con RLS desactivado, todos ven todo). No debería devolver filas.
select t.tablename
from pg_tables t
where t.schemaname = 'public'
  and t.tablename in (
    'clients','addresses','products','supplies','product_supplies',
    'whatsapp_templates','cost_categories','costs','orders','order_items',
    'routes','route_stops','route_loads'
  )
  and not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = t.tablename
  );
