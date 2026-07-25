-- ============================================================================
--  Water Delivery App — esquema de base de datos (Supabase / PostgreSQL)
-- ----------------------------------------------------------------------------
--  Cómo usar:
--    1. Entra a tu proyecto de Supabase → SQL Editor → New query
--    2. Pega TODO este archivo y ejecútalo.
--    3. Crea el bucket de imágenes (ver el bloque de Storage al final).
-- ============================================================================

-- Extensión para generar UUIDs
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
--  Tipos
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type order_status as enum ('ordered', 'delivered', 'paid');
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_method') then
    create type payment_method as enum ('transferencia', 'efectivo');
  end if;
  if not exists (select 1 from pg_type where typname = 'user_role') then
    -- superadmin: administra empresas (tú). admin: dueño de una empresa.
    -- operador: pedidos/clientes/productos. repartidor: rutas.
    create type user_role as enum ('superadmin', 'admin', 'operador', 'repartidor');
  end if;
end$$;

-- ----------------------------------------------------------------------------
--  Clientes
-- ----------------------------------------------------------------------------
create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  surname     text not null,
  national_id text,                       -- opcional (cédula / DNI / RUT)
  phone       text not null,              -- en formato internacional, ej: +50688887777
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
--  Direcciones (un cliente puede tener varias)
-- ----------------------------------------------------------------------------
create table if not exists addresses (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients (id) on delete cascade,
  label       text,                       -- ej: "Casa", "Oficina"
  address     text not null,
  comuna      text,                       -- comuna / distrito
  observation text,                       -- observaciones extra de la entrega
  created_at  timestamptz not null default now()
);
create index if not exists addresses_client_id_idx on addresses (client_id);

-- Migración para bases de datos que ya tenían la tabla "addresses".
alter table addresses add column if not exists comuna text;
alter table addresses add column if not exists observation text;

-- ----------------------------------------------------------------------------
--  Insumos: el "recurso físico" que representan varios productos. Ej: varios
--  productos ("oferta 5 gal", "normal 5 gal") comparten el insumo "Agua 5 gal".
--  La carga inicial de la ruta se define por insumo, no por producto.
-- ----------------------------------------------------------------------------
create table if not exists supplies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
--  Productos
-- ----------------------------------------------------------------------------
create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  price       numeric(12, 2) not null default 0 check (price >= 0),
  image_url   text,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
--  Insumos que componen un producto (relación N:N con cantidad). Ej: "Pack 4
--  bidones 20L" = insumo "Bidón 20L" x4; "Dispensador + bidón" = 2 insumos x1.
--  Al entregar un producto se descuenta quantity por cada insumo de la carga.
-- ----------------------------------------------------------------------------
create table if not exists product_supplies (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  supply_id  uuid not null references supplies (id) on delete cascade,
  quantity   integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (product_id, supply_id)
);
create index if not exists product_supplies_product_id_idx on product_supplies (product_id);

-- ----------------------------------------------------------------------------
--  Plantillas de mensajes de WhatsApp (contenido con variables: {cliente},
--  {empresa}, {total}, {detalle}, {direccion}, {telefono})
-- ----------------------------------------------------------------------------
create table if not exists whatsapp_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  content    text not null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
--  Costos: categorías y costos individuales
-- ----------------------------------------------------------------------------
create table if not exists cost_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists costs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  issue_date  date not null default current_date,
  category_id uuid references cost_categories (id) on delete set null,
  amount      numeric(12, 2) not null default 0 check (amount >= 0),
  created_at  timestamptz not null default now()
);
create index if not exists costs_category_id_idx on costs (category_id);
create index if not exists costs_issue_date_idx on costs (issue_date);

-- ----------------------------------------------------------------------------
--  Pedidos
-- ----------------------------------------------------------------------------
create table if not exists orders (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients (id) on delete restrict,
  address_id     uuid references addresses (id) on delete set null,
  status         order_status not null default 'ordered',
  total          numeric(12, 2) not null default 0 check (total >= 0),
  payment_method payment_method,                 -- se llena al marcar como pagado
  paid_amount    numeric(12, 2),                 -- monto recibido al pagar
  notes          text,
  created_at     timestamptz not null default now()
);
create index if not exists orders_client_id_idx on orders (client_id);
create index if not exists orders_status_idx on orders (status);

-- Migración para bases de datos que ya tenían la tabla "orders" sin estas columnas.
alter table orders add column if not exists payment_method payment_method;
alter table orders add column if not exists paid_amount numeric(12, 2);
-- Venta rápida: pedido con sólo un nombre (sin cliente registrado).
alter table orders add column if not exists customer_name text;
alter table orders alter column client_id drop not null;
-- Bidones que el cliente devolvió al momento de la entrega.
alter table orders add column if not exists returned_bidones integer;

-- ----------------------------------------------------------------------------
--  Ítems del pedido (un pedido tiene varios productos)
-- ----------------------------------------------------------------------------
create table if not exists order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders (id) on delete cascade,
  product_id uuid not null references products (id) on delete restrict,
  quantity   integer not null default 1 check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0)  -- precio congelado al momento del pedido
);
create index if not exists order_items_order_id_idx on order_items (order_id);

-- ----------------------------------------------------------------------------
--  Rutas de reparto
-- ----------------------------------------------------------------------------
create table if not exists routes (
  id         uuid primary key default gen_random_uuid(),
  name       text,                         -- ej: "Ruta Norte"
  route_date date not null,                -- día de reparto
  driver     text,                         -- nombre del repartidor
  notes      text,
  created_at timestamptz not null default now()
);
create index if not exists routes_date_idx on routes (route_date);

-- ----------------------------------------------------------------------------
--  Paradas de la ruta (pedidos ordenados por "position").
--  Un pedido sólo puede estar en una ruta (order_id es único).
-- ----------------------------------------------------------------------------
create table if not exists route_stops (
  id         uuid primary key default gen_random_uuid(),
  route_id   uuid not null references routes (id) on delete cascade,
  order_id   uuid not null references orders (id) on delete cascade,
  position   integer not null default 0,   -- orden de entrega dentro de la ruta
  created_at timestamptz not null default now(),
  unique (order_id)
);
create index if not exists route_stops_route_id_idx on route_stops (route_id);

-- ----------------------------------------------------------------------------
--  Carga inicial de la ruta: cuántas unidades de cada producto salieron en el
--  camión. Sirve para saber cuánto se vendió y cuánto reponer.
-- ----------------------------------------------------------------------------
create table if not exists route_loads (
  id         uuid primary key default gen_random_uuid(),
  route_id   uuid not null references routes (id) on delete cascade,
  supply_id  uuid not null references supplies (id) on delete cascade,
  quantity   integer not null default 0 check (quantity >= 0),
  created_at timestamptz not null default now(),
  unique (route_id, supply_id)
);
create index if not exists route_loads_route_id_idx on route_loads (route_id);

-- Migración: si route_loads era por producto (versión anterior), se convierte a
-- por insumo. Las cargas viejas por producto se descartan (aún no había insumos).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'route_loads'
      and column_name = 'product_id'
  ) then
    delete from route_loads;
    alter table route_loads drop constraint if exists route_loads_route_id_product_id_key;
    alter table route_loads drop column if exists product_id;
    alter table route_loads add column if not exists supply_id uuid references supplies (id) on delete cascade;
    alter table route_loads add constraint route_loads_route_id_supply_id_key unique (route_id, supply_id);
  end if;
end$$;

-- Bandera: la carga inicial ya fue registrada. Hasta entonces, al repartidor se
-- le ocultan los pedidos (debe registrar qué cargó primero).
alter table routes add column if not exists load_confirmed boolean not null default false;

-- ============================================================================
--  MULTI-EMPRESA (multi-tenant): empresas, usuarios y aislamiento de datos
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Empresas (cada empresa es un cliente tuyo / un tenant)
-- ----------------------------------------------------------------------------
create table if not exists companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
--  Perfiles: enlaza cada usuario de Supabase Auth con su empresa y rol.
--  El id es el mismo que auth.users.id.
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  company_id uuid references companies (id) on delete cascade, -- null = superadmin
  role       user_role not null default 'operador',
  full_name  text,
  email      text,
  active     boolean not null default true, -- false = usuario desactivado (sin acceso)
  created_at timestamptz not null default now()
);
create index if not exists profiles_company_id_idx on profiles (company_id);
alter table profiles add column if not exists active boolean not null default true;

-- Repartidor asignado a la ruta (un usuario con rol 'repartidor').
-- Se agrega aquí, ANTES de las funciones que lo usan (is_my_route), porque
-- PostgreSQL valida el cuerpo de las funciones SQL al momento de crearlas.
alter table routes add column if not exists driver_id uuid references profiles (id) on delete set null;
create index if not exists routes_driver_id_idx on routes (driver_id);

-- ----------------------------------------------------------------------------
--  Funciones auxiliares (SECURITY DEFINER: leen profiles sin gatillar RLS,
--  evitando recursión en las políticas).
-- ----------------------------------------------------------------------------
create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and role = 'superadmin'
  )
$$;

create or replace function public.is_company_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and role = 'admin'
  )
$$;

create or replace function public.current_user_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- ¿La ruta está asignada al usuario actual? (para repartidores)
create or replace function public.is_my_route(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.routes where id = rid and driver_id = auth.uid()
  )
$$;

-- ¿El pedido pertenece a una ruta asignada al usuario actual?
create or replace function public.order_in_my_route(oid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.route_stops rs
    join public.routes r on r.id = rs.route_id
    where rs.order_id = oid and r.driver_id = auth.uid()
  )
$$;

-- Venta rápida: crea un pedido (sin cliente registrado, sólo un nombre) con los
-- productos indicados y lo agrega como parada de la ruta, en una sola operación.
-- SECURITY DEFINER evita las restricciones de RLS del repartidor, pero valida
-- que la ruta sea de su empresa (y suya si es repartidor).
-- p_items: [{"product_id": "uuid", "quantity": 2}, ...]
create or replace function public.add_quick_sale(
  p_route_id uuid,
  p_customer_name text,
  p_items jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_driver  uuid;
  v_order   uuid;
  v_total   numeric := 0;
  v_pos     int;
  it        jsonb;
  v_price   numeric;
  v_qty     int;
  v_pid     uuid;
begin
  select company_id, driver_id into v_company, v_driver
    from routes where id = p_route_id;
  if v_company is null then
    raise exception 'Ruta no encontrada';
  end if;
  if v_company <> current_company_id() then
    raise exception 'No autorizado';
  end if;
  if current_user_role() = 'repartidor'
     and v_driver is distinct from auth.uid() then
    raise exception 'No autorizado';
  end if;

  insert into orders (company_id, client_id, customer_name, status, total)
  values (v_company, null, nullif(trim(p_customer_name), ''), 'ordered', 0)
  returning id into v_order;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_pid := (it ->> 'product_id')::uuid;
    v_qty := greatest(1, coalesce((it ->> 'quantity')::int, 1));
    select price into v_price
      from products where id = v_pid and company_id = v_company;
    if v_price is null then
      raise exception 'Producto inválido';
    end if;
    insert into order_items (company_id, order_id, product_id, quantity, unit_price)
    values (v_company, v_order, v_pid, v_qty, v_price);
    v_total := v_total + v_qty * v_price;
  end loop;

  update orders set total = v_total where id = v_order;

  select count(*) into v_pos from route_stops where route_id = p_route_id;
  insert into route_stops (company_id, route_id, order_id, position)
  values (v_company, p_route_id, v_order, v_pos);

  return v_order;
end$$;

grant execute on function public.add_quick_sale(uuid, text, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
--  Resumen de entregas por repartidor: cantidad entregada de cada producto en
--  un rango de fechas (por fecha de la ruta). Un pedido cuenta como entregado
--  si su estado es 'delivered' o 'paid'.
--  - admin/operador: pueden filtrar por cualquier repartidor (o todos).
--  - repartidor: sólo ve lo suyo (se fuerza r.driver_id = auth.uid()).
-- ----------------------------------------------------------------------------
create or replace function public.delivery_summary(
  p_driver_id uuid default null,
  p_from date default null,
  p_to date default null
)
returns table (
  driver_id uuid,
  driver_name text,
  product_id uuid,
  product_name text,
  total_quantity bigint
)
language sql stable security definer set search_path = public as $$
  select
    r.driver_id,
    coalesce(pf.full_name, pf.email, 'Sin nombre') as driver_name,
    pr.id   as product_id,
    pr.name as product_name,
    sum(oi.quantity)::bigint as total_quantity
  from routes r
  join route_stops rs on rs.route_id = r.id
  join orders o       on o.id = rs.order_id
  join order_items oi on oi.order_id = o.id
  join products pr    on pr.id = oi.product_id
  left join profiles pf on pf.id = r.driver_id
  where r.company_id = current_company_id()
    and r.driver_id is not null
    and o.status in ('delivered', 'paid')
    and (current_user_role() <> 'repartidor' or r.driver_id = auth.uid())
    and (p_driver_id is null or r.driver_id = p_driver_id)
    and (p_from is null or r.route_date >= p_from)
    and (p_to   is null or r.route_date <= p_to)
  group by r.driver_id, pf.full_name, pf.email, pr.id, pr.name
  order by driver_name, pr.name;
$$;

grant execute on function public.delivery_summary(uuid, date, date) to authenticated;

-- ----------------------------------------------------------------------------
--  Agregar company_id a todas las tablas de datos. El default lo llena solo
--  con la empresa del usuario que inserta, así el frontend no tiene que enviarlo.
-- ----------------------------------------------------------------------------
alter table clients     add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table addresses   add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table products    add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table supplies    add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table product_supplies add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table orders      add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table order_items add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table routes      add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table route_stops add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table route_loads add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table whatsapp_templates add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table cost_categories add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table costs add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
-- Quién registró el costo (para atribuirlo y filtrarlo por usuario).
alter table costs add column if not exists created_by uuid references profiles (id) on delete set null default auth.uid();

-- ----------------------------------------------------------------------------
--  Migración de datos existentes: crea una empresa inicial y asigna a ella
--  todos los registros que aún no tengan empresa.
-- ----------------------------------------------------------------------------
do $$
declare
  cid uuid;
begin
  select id into cid from companies order by created_at limit 1;
  if cid is null then
    insert into companies (name) values ('Mi Empresa') returning id into cid;
  end if;
  update clients     set company_id = cid where company_id is null;
  update addresses   set company_id = cid where company_id is null;
  update products    set company_id = cid where company_id is null;
  update supplies    set company_id = cid where company_id is null;
  update product_supplies set company_id = cid where company_id is null;
  update orders      set company_id = cid where company_id is null;
  update order_items set company_id = cid where company_id is null;
  update routes      set company_id = cid where company_id is null;
  update route_stops set company_id = cid where company_id is null;
  update route_loads set company_id = cid where company_id is null;
end$$;

-- Migración: si products tenía un único insumo (products.supply_id, versión
-- anterior), se traslada a product_supplies con cantidad 1 y se elimina la
-- columna. Guardado tras un IF para que sea idempotente en re-ejecuciones.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products'
      and column_name = 'supply_id'
  ) then
    insert into product_supplies (company_id, product_id, supply_id, quantity)
    select p.company_id, p.id, p.supply_id, 1
    from products p
    where p.supply_id is not null
    on conflict (product_id, supply_id) do nothing;
    alter table products drop column supply_id;
  end if;
end$$;

-- Rutas que ya existían (o que ya tienen entregas) se consideran iniciadas: no
-- se les bloquean los pedidos por falta de carga inicial. Las rutas nuevas
-- quedan en false y pedirán registrar la carga antes de mostrar los pedidos.
-- Idempotente: sólo toca filas aún en false que cumplen la condición histórica.
update routes
set load_confirmed = true
where load_confirmed = false
  and (
    created_at < '2026-07-25'::date
    or exists (
      select 1 from route_stops rs
      join orders o on o.id = rs.order_id
      where rs.route_id = routes.id and o.status in ('delivered', 'paid')
    )
  );

-- ----------------------------------------------------------------------------
--  Backfill: enlaza rutas antiguas (que guardaban el repartidor sólo como texto
--  en "driver") con la cuenta del repartidor, para que el "Resumen de entregas"
--  incluya TODO el histórico y no se pierda el rastro de esos pedidos.
--  Sólo actúa cuando driver_id está vacío y existe UN único repartidor de la
--  misma empresa cuyo nombre coincide (ignorando mayúsculas/espacios).
--  Idempotente: al re-ejecutar el esquema no pisa asignaciones existentes.
-- ----------------------------------------------------------------------------
update routes r
set driver_id = (
  select p.id from profiles p
  where p.role = 'repartidor'
    and p.company_id = r.company_id
    and lower(btrim(p.full_name)) = lower(btrim(r.driver))
  limit 1
)
where r.driver_id is null
  and coalesce(btrim(r.driver), '') <> ''
  and (
    select count(*) from profiles p
    where p.role = 'repartidor'
      and p.company_id = r.company_id
      and lower(btrim(p.full_name)) = lower(btrim(r.driver))
  ) = 1;

-- ============================================================================
--  Row Level Security (RLS) — AISLAMIENTO POR EMPRESA
-- ----------------------------------------------------------------------------
--  Cada usuario sólo puede ver/editar datos de SU empresa. Esto se aplica en
--  la base de datos, así que ningún error del frontend puede filtrar datos
--  entre empresas.
-- ============================================================================
alter table clients     enable row level security;
alter table addresses   enable row level security;
alter table products    enable row level security;
alter table supplies    enable row level security;
alter table product_supplies enable row level security;
alter table orders      enable row level security;
alter table order_items enable row level security;
alter table routes      enable row level security;
alter table route_stops enable row level security;
alter table route_loads enable row level security;
alter table whatsapp_templates enable row level security;
alter table cost_categories enable row level security;
alter table costs       enable row level security;
alter table companies   enable row level security;
alter table profiles    enable row level security;

-- Tablas simples: acceso a cualquier fila de la empresa del usuario.
do $$
declare
  t text;
begin
  foreach t in array array['clients', 'addresses', 'products', 'supplies', 'product_supplies', 'whatsapp_templates', 'cost_categories', 'costs', 'orders', 'order_items', 'routes', 'route_stops', 'route_loads']
  loop
    execute format('drop policy if exists "allow_all_%1$s" on %1$s;', t);       -- limpia política antigua
    execute format('drop policy if exists "tenant_%1$s" on %1$s;', t);
  end loop;
end$$;

create policy "tenant_clients" on clients for all
  using (company_id = current_company_id())
  with check (company_id = current_company_id());
create policy "tenant_addresses" on addresses for all
  using (company_id = current_company_id())
  with check (company_id = current_company_id());
create policy "tenant_products" on products for all
  using (company_id = current_company_id())
  with check (company_id = current_company_id());
create policy "tenant_supplies" on supplies for all
  using (company_id = current_company_id())
  with check (company_id = current_company_id());
create policy "tenant_product_supplies" on product_supplies for all
  using (company_id = current_company_id())
  with check (company_id = current_company_id());
create policy "tenant_whatsapp_templates" on whatsapp_templates for all
  using (company_id = current_company_id())
  with check (company_id = current_company_id());
create policy "tenant_cost_categories" on cost_categories for all
  using (company_id = current_company_id())
  with check (company_id = current_company_id());
-- Costos: admin/operador ven y gestionan todos los de la empresa; el repartidor
-- sólo ve/gestiona los que él mismo registró.
create policy "tenant_costs" on costs for all
  using (
    company_id = current_company_id()
    and (current_user_role() <> 'repartidor' or created_by = auth.uid())
  )
  with check (
    company_id = current_company_id()
    and (current_user_role() <> 'repartidor' or created_by = auth.uid())
  );

-- Rutas: admin/operador ven todas las de la empresa; el repartidor sólo las suyas.
create policy "tenant_routes" on routes for all
  using (
    company_id = current_company_id()
    and (current_user_role() <> 'repartidor' or driver_id = auth.uid())
  )
  with check (
    company_id = current_company_id()
    and (current_user_role() <> 'repartidor' or driver_id = auth.uid())
  );

-- Paradas: el repartidor sólo ve las de sus rutas asignadas.
create policy "tenant_route_stops" on route_stops for all
  using (
    company_id = current_company_id()
    and (current_user_role() <> 'repartidor' or is_my_route(route_id))
  )
  with check (
    company_id = current_company_id()
    and (current_user_role() <> 'repartidor' or is_my_route(route_id))
  );

-- Carga de la ruta.
--  - Lectura: el repartidor ve la carga de sus rutas asignadas.
--  - Escritura: admin/operador siempre; el repartidor SÓLO mientras la carga
--    aún no está confirmada (registro inicial). Una vez confirmada, sólo un
--    administrador puede modificarla.
drop policy if exists "route_loads_select" on route_loads;
drop policy if exists "route_loads_write" on route_loads;
create policy "route_loads_select" on route_loads for select
  using (
    company_id = current_company_id()
    and (current_user_role() <> 'repartidor' or is_my_route(route_id))
  );
create policy "route_loads_write" on route_loads for all
  using (
    company_id = current_company_id()
    and (
      current_user_role() <> 'repartidor'
      or (
        is_my_route(route_id)
        and not coalesce(
          (select r.load_confirmed from routes r where r.id = route_loads.route_id),
          false
        )
      )
    )
  )
  with check (
    company_id = current_company_id()
    and (
      current_user_role() <> 'repartidor'
      or (
        is_my_route(route_id)
        and not coalesce(
          (select r.load_confirmed from routes r where r.id = route_loads.route_id),
          false
        )
      )
    )
  );

-- Pedidos: el repartidor sólo ve los pedidos que están en sus rutas.
create policy "tenant_orders" on orders for all
  using (
    company_id = current_company_id()
    and (current_user_role() <> 'repartidor' or order_in_my_route(id))
  )
  with check (
    company_id = current_company_id()
    and (current_user_role() <> 'repartidor' or order_in_my_route(id))
  );
create policy "tenant_order_items" on order_items for all
  using (
    company_id = current_company_id()
    and (current_user_role() <> 'repartidor' or order_in_my_route(order_id))
  )
  with check (
    company_id = current_company_id()
    and (current_user_role() <> 'repartidor' or order_in_my_route(order_id))
  );

-- Empresas: el superadmin administra todas; cada usuario lee la suya; el admin
-- puede renombrar la suya.
drop policy if exists "companies_read" on companies;
create policy "companies_read" on companies for select
  using (is_superadmin() or id = current_company_id());

drop policy if exists "companies_superadmin" on companies;
create policy "companies_superadmin" on companies for all
  using (is_superadmin()) with check (is_superadmin());

drop policy if exists "companies_admin_update" on companies;
create policy "companies_admin_update" on companies for update
  using (is_company_admin() and id = current_company_id())
  with check (is_company_admin() and id = current_company_id());

-- Perfiles: cada quien lee el suyo; superadmin y admin (de su empresa) gestionan.
drop policy if exists "profiles_read" on profiles;
create policy "profiles_read" on profiles for select
  using (
    id = auth.uid()
    or is_superadmin()
    or (is_company_admin() and company_id = current_company_id())
    -- El operador puede leer los perfiles de su empresa (para ver quién registró
    -- cada costo, asignar repartidores, etc.).
    or (current_user_role() = 'operador' and company_id = current_company_id())
  );

drop policy if exists "profiles_write" on profiles;
create policy "profiles_write" on profiles for all
  using (
    is_superadmin()
    or (is_company_admin() and company_id = current_company_id())
  )
  with check (
    is_superadmin()
    or (is_company_admin() and company_id = current_company_id())
  );

-- ============================================================================
--  Storage: bucket para imágenes de productos
-- ----------------------------------------------------------------------------
--  Lectura pública (las URLs de imagen deben abrir sin login); escritura sólo
--  para usuarios autenticados.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "product_images_all" on storage.objects;
drop policy if exists "product_images_read" on storage.objects;
create policy "product_images_read" on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists "product_images_write" on storage.objects;
create policy "product_images_write" on storage.objects for all
  to authenticated
  using (bucket_id = 'product-images')
  with check (bucket_id = 'product-images');

-- ============================================================================
--  BOOTSTRAP — crea tu primer usuario superadmin (una sola vez)
-- ----------------------------------------------------------------------------
--  1. Supabase → Authentication → Providers → Email: desactiva "Confirm email"
--     (para que los usuarios creados por un admin puedan entrar de inmediato) y
--     deja "Allow new users to sign up" ACTIVADO (el frontend crea usuarios con
--     signUp). Ver nota de seguridad en el README.
--  2. Supabase → Authentication → Users → "Add user": crea tu cuenta con email
--     y contraseña. Copia el UUID del usuario creado.
--  3. Corre (reemplazando el UUID y tus datos):
--       insert into profiles (id, company_id, role, full_name, email)
--       values ('TU-UUID-AQUI', null, 'superadmin', 'Tu Nombre', 'tu@correo.com');
--  4. Entra al app con ese email/contraseña. Desde "Empresas" podrás crear
--     empresas y sus administradores. Para ver los datos que ya tenías en
--     "Mi Empresa", crea (o asígnate) un usuario admin de esa empresa.
-- ============================================================================
