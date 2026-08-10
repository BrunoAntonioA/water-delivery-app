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
    create type payment_method as enum ('transferencia', 'efectivo', 'tarjeta');
  end if;
  if not exists (select 1 from pg_type where typname = 'user_role') then
    -- superadmin: administra empresas (tú). admin: dueño de una empresa.
    -- operador: pedidos/clientes/productos. repartidor: rutas.
    create type user_role as enum ('superadmin', 'admin', 'operador', 'repartidor');
  end if;
end$$;

-- Nuevo método de pago "tarjeta" para bases que ya tenían el enum sin él.
-- (ADD VALUE debe ir fuera del bloque DO; es idempotente con IF NOT EXISTS.)
alter type payment_method add value if not exists 'tarjeta';

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
-- Derecho de supresión (Ley 21.719): si un cliente con historial de pedidos se
-- "elimina", se anonimizan sus datos personales y se marca aquí la fecha, en vez
-- de borrar la fila (que rompería el historial por la FK on delete restrict).
alter table clients add column if not exists anonymized_at timestamptz;

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
--  Abastecimiento: registro de cada compra/reposición de insumos. Cada
--  abastecimiento tiene un PROVEEDOR y varias líneas (insumo, cantidad y precio
--  unitario). El total del abastecimiento es la suma de cantidad × precio
--  unitario de todas sus líneas. Sólo lo usan admin/operador (no repartidor).
-- ----------------------------------------------------------------------------
create table if not exists providers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  created_at timestamptz not null default now()
);

create table if not exists supply_purchases (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid references providers (id) on delete set null,
  purchase_date date not null default current_date,
  notes         text,
  total         numeric(12, 2) not null default 0 check (total >= 0),
  created_at    timestamptz not null default now()
);
create index if not exists supply_purchases_provider_id_idx on supply_purchases (provider_id);
create index if not exists supply_purchases_date_idx on supply_purchases (purchase_date);

create table if not exists supply_purchase_items (
  id          uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references supply_purchases (id) on delete cascade,
  supply_id   uuid references supplies (id) on delete set null,
  quantity    integer not null default 1 check (quantity > 0),
  unit_price  numeric(12, 2) not null default 0 check (unit_price >= 0),
  created_at  timestamptz not null default now()
);
create index if not exists supply_purchase_items_purchase_id_idx on supply_purchase_items (purchase_id);

-- ----------------------------------------------------------------------------
--  Pedidos
-- ----------------------------------------------------------------------------
create table if not exists orders (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients (id) on delete restrict,
  address_id     uuid references addresses (id) on delete set null,
  status         order_status not null default 'ordered',
  total          numeric(12, 2) not null default 0 check (total >= 0),
  payment_method payment_method,                 -- método principal (o único) del pago
  paid_amount    numeric(12, 2),                 -- monto total recibido (= total del pedido)
  payments       jsonb,                          -- desglose [{ "method": ..., "amount": ... }]
  notes          text,
  created_at     timestamptz not null default now()
);
create index if not exists orders_client_id_idx on orders (client_id);
create index if not exists orders_status_idx on orders (status);

-- Migración para bases de datos que ya tenían la tabla "orders" sin estas columnas.
alter table orders add column if not exists payment_method payment_method;
alter table orders add column if not exists paid_amount numeric(12, 2);
-- Pago dividido: hasta dos métodos por pedido. Lista JSON de { method, amount }
-- cuya suma es el total del pedido. paid_amount conserva el total pagado.
alter table orders add column if not exists payments jsonb;
-- Venta rápida: pedido con sólo un nombre (sin cliente registrado).
alter table orders add column if not exists customer_name text;
alter table orders alter column client_id drop not null;
-- Bidones que el cliente devolvió al momento de la entrega.
alter table orders add column if not exists returned_bidones integer;

-- Fecha/hora de ENTREGA: se llena al marcar el pedido como entregado. Es la
-- fecha que usan los reportes por repartidor (no la de creación).
alter table orders add column if not exists delivered_at timestamptz;
-- Migración: los pedidos ya entregados sin fecha de entrega toman la de creación.
update orders set delivered_at = created_at
  where status = 'delivered' and delivered_at is null;

-- El PAGO ahora es independiente del estado de entrega: un pedido puede estar
-- pagado sin haber sido entregado (y viceversa). "status" queda sólo para la
-- entrega ('ordered' | 'delivered'); el valor 'paid' del enum se deja de usar.
alter table orders add column if not exists paid boolean not null default false;
-- Migración: los pedidos que estaban en estado 'paid' pasan a paid=true y su
-- estado de entrega a 'delivered' (estaban pagados => habían sido entregados).
update orders set paid = true where status = 'paid';
update orders set status = 'delivered' where status = 'paid';

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

-- ----------------------------------------------------------------------------
--  Retiros de la ruta: paradas donde el repartidor RECOGE insumos (ej: pasar por
--  la planta o un cliente a buscar bidones). Es una parada más de la ruta (como
--  una venta rápida) con nombre, dirección e insumos, pero sin cobro.
--  items: [{"supply_id": "uuid", "quantity": 2}, ...]
-- ----------------------------------------------------------------------------
create table if not exists route_pickups (
  id            uuid primary key default gen_random_uuid(),
  route_id      uuid not null references routes (id) on delete cascade,
  customer_name text,
  address       text,
  items         jsonb not null default '[]',
  done          boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists route_pickups_route_id_idx on route_pickups (route_id);
-- Migración desde la versión anterior (una fila = un insumo) a esta (cabecera
-- con nombre/dirección/insumos). Idempotente.
alter table route_pickups add column if not exists customer_name text;
alter table route_pickups add column if not exists address text;
alter table route_pickups add column if not exists items jsonb not null default '[]';
alter table route_pickups add column if not exists done boolean not null default false;
alter table route_pickups drop column if exists supply_id;
alter table route_pickups drop column if exists quantity;
alter table route_pickups drop column if exists location;
alter table route_pickups drop column if exists note;

-- Cliente opcional asociado al retiro (si hay uno involucrado).
alter table route_pickups add column if not exists client_id uuid references clients (id) on delete set null;

-- Una parada de ruta puede ser un PEDIDO (order_id) o un RETIRO (pickup_id).
alter table route_stops alter column order_id drop not null;
alter table route_stops add column if not exists pickup_id uuid references route_pickups (id) on delete cascade;

-- Los retiros dejan de estar atados a una ruta: pueden quedar PENDIENTES (sin
-- ruta) y reasignarse a otra. route_id pasa a ser opcional y, si se elimina la
-- ruta, el retiro SOBREVIVE (route_id -> null) en vez de borrarse. La asignación
-- real a una ruta se maneja por route_stops.pickup_id (igual que los pedidos).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.route_pickups'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) ilike '%references routes%'
  loop
    execute format('alter table route_pickups drop constraint %I', c.conname);
  end loop;
end$$;
alter table route_pickups alter column route_id drop not null;
alter table route_pickups
  add constraint route_pickups_route_id_fkey
  foreign key (route_id) references routes (id) on delete set null;

-- Bandera: la carga inicial ya fue registrada. Hasta entonces, al repartidor se
-- le ocultan los pedidos (debe registrar qué cargó primero).
alter table routes add column if not exists load_confirmed boolean not null default false;
-- Cierre de ruta: fecha/hora en que se cerró (null = abierta). Una ruta cerrada
-- ya no admite cambios de pedidos y muestra el estado "Cerrada".
alter table routes add column if not exists closed_at timestamptz;

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
-- Módulos habilitados para la empresa (los gestiona sólo el superadmin). Por
-- defecto, todos. 'empresas' no se incluye (es exclusivo del superadmin).
alter table companies add column if not exists modules text[] not null default array[
  'pedidos', 'reportes', 'entregas', 'rutas', 'clientes',
  'productos', 'costos', 'plantillas', 'usuarios', 'abastecimiento'
];
-- Habilita "abastecimiento" en las empresas que ya existían (idempotente). Se
-- desactiva antes el trigger guard_company_modules (si ya existe de una corrida
-- previa) porque en el SQL Editor no hay auth.uid() y el guard lo bloquearía; el
-- trigger se vuelve a crear más abajo.
drop trigger if exists companies_guard_modules on companies;
update companies
set modules = array_append(modules, 'abastecimiento')
where not ('abastecimiento' = any(modules));
-- Datos comerciales de la empresa (se capturan en el registro público).
alter table companies add column if not exists rut text;
alter table companies add column if not exists razon_social text;
alter table companies add column if not exists phone text;
alter table companies add column if not exists email text;

-- ----------------------------------------------------------------------------
--  Planes comerciales (catálogo) y suscripción por empresa.
--  El PLAN define qué módulos y límites tiene la empresa; la SUSCRIPCIÓN define
--  si la empresa tiene acceso vigente (prueba, activa, vencida, cancelada…).
-- ----------------------------------------------------------------------------
create table if not exists plans (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,             -- 'inicial' | 'pro' | 'full'
  name        text not null,
  description text,
  price       numeric(12, 2) not null default 0,  -- CLP por período
  interval    text not null default 'month',
  modules     text[] not null default '{}',     -- módulos incluidos en el plan
  max_users   integer,                          -- null = ilimitado
  max_clients integer,                          -- null = ilimitado
  trial_days  integer not null default 10,
  sort        integer not null default 0,       -- orden de despliegue
  is_public   boolean not null default true,    -- visible en la landing
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Semilla/actualización de los tres planes (idempotente por "key").
insert into plans (key, name, description, price, modules, max_users, max_clients, trial_days, sort)
values
  ('inicial', 'Inicial',
   'Para partir a ordenar tu reparto sin complicaciones.',
   25000, array['rutas','pedidos','clientes','productos'], 3, 500, 10, 1),
  ('pro', 'Pro',
   'La opción completa para distribuidoras que están creciendo.',
   40000, array['rutas','pedidos','clientes','productos','costos','entregas','reportes','plantillas','abastecimiento'],
   8, 5000, 10, 2),
  ('full', 'Full',
   'Sin límites, para operaciones grandes con varios camiones.',
   50000, array['rutas','pedidos','clientes','productos','costos','entregas','reportes','plantillas','usuarios','abastecimiento'],
   null, null, 10, 3)
-- Sólo inserta los planes si faltan. NO sobrescribe (do nothing) para no pisar
-- las ediciones que el superadmin haga desde el módulo "Planes" al re-ejecutar
-- este archivo.
on conflict (key) do nothing;

create table if not exists subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null unique references companies (id) on delete cascade,
  plan_id                  uuid references plans (id),
  status                   text not null default 'trialing'
    check (status in ('trialing','active','past_due','paused','canceled','manual')),
  access_until             timestamptz,   -- fin de acceso (prueba/período). null = sin vencimiento
  trial_end                timestamptz,   -- informativo
  activated_at             timestamptz,
  canceled_at              timestamptz,
  notes                    text,
  provider_customer_id     text,          -- Flow (fase posterior)
  provider_subscription_id text,          -- Flow (fase posterior)
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists subscriptions_company_id_idx on subscriptions (company_id);
-- Precio especial negociado para esta empresa (lo fija el superadmin). Si está
-- definido, la empresa paga ESTE monto con Flow en vez del precio del plan.
alter table subscriptions add column if not exists custom_price numeric(12, 2);

-- Pagos de la suscripción (registro manual mientras no está integrado Flow). La
-- empresa los ve en su módulo "Suscripción"; sólo el superadmin los registra.
create table if not exists subscription_payments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies (id) on delete cascade,
  amount       numeric(12, 2) not null default 0,
  paid_at      date not null default current_date,
  method       text,           -- 'transferencia' | 'efectivo' | 'tarjeta' | 'flow' | ...
  period_start date,
  period_end   date,
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists subscription_payments_company_id_idx
  on subscription_payments (company_id);

-- Intentos de pago con Flow: un registro por cada cobro iniciado. Los escriben
-- SÓLO las Edge Functions con service role (flow-create-payment / flow-confirm);
-- la empresa puede LEER los suyos aunque su suscripción esté vencida (por eso el
-- policy usa my_company_id(), no current_company_id()). company_id NO usa el
-- default current_company_id() a propósito: quien paga suele estar vencido (esa
-- función devolvería null); la Edge Function lo setea explícitamente.
create table if not exists payment_intents (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies (id) on delete cascade,
  plan_id        uuid references plans (id),
  amount         numeric(12, 2) not null,
  currency       text not null default 'CLP',
  months         integer not null default 1,        -- período que cubre el pago
  status         text not null default 'pending'
    check (status in ('pending','paid','failed','canceled')),
  commerce_order text not null unique,               -- commerceOrder enviado a Flow
  flow_token     text,                               -- token que devuelve Flow
  flow_order     text,                               -- flowOrder (nº de orden Flow)
  paid_at        timestamptz,
  created_by     uuid references profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists payment_intents_company_id_idx
  on payment_intents (company_id);
create index if not exists payment_intents_commerce_order_idx
  on payment_intents (commerce_order);

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
-- Empresa del usuario SIN condicionar a la suscripción. Se usa para leer su
-- propia empresa/suscripción aunque esté vencida (y así poder mostrar el aviso
-- de pago). NO usar para aislar datos del negocio: para eso está current_company_id().
create or replace function public.my_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid() and active
$$;

-- ¿La empresa tiene acceso vigente? Una empresa SIN fila de suscripción se
-- considera "legado" y mantiene acceso (no rompe empresas ya existentes). Con
-- suscripción, sólo tienen acceso los estados vigentes y no vencidos.
create or replace function public.company_has_access(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select cid is not null and (
    not exists (select 1 from public.subscriptions s where s.company_id = cid)
    or exists (
      select 1 from public.subscriptions s
      where s.company_id = cid
        and s.status in ('trialing', 'active', 'manual')
        and (s.access_until is null or s.access_until > now())
    )
  )
$$;

-- Empresa "efectiva" para aislar los datos del negocio: la del usuario, pero
-- sólo si su suscripción está vigente. Si venció/canceló, devuelve null y las
-- políticas de todas las tablas del negocio dejan de calzar (bloqueo real, no
-- sólo visual).
create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.company_id
  from public.profiles p
  where p.id = auth.uid()
    and p.active
    and public.company_has_access(p.company_id)
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

-- Retiro: crea un route_pickup y su parada (route_stop) en una sola operación.
-- SECURITY DEFINER (evita RLS del repartidor) pero valida empresa/ruta propia.
-- p_items: [{"supply_id": "uuid", "quantity": 2}, ...]
drop function if exists public.add_route_pickup(uuid, text, text, jsonb);
create or replace function public.add_route_pickup(
  p_route_id uuid,
  p_customer_name text,
  p_address text,
  p_items jsonb,
  p_client_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_driver  uuid;
  v_pickup  uuid;
  v_pos     int;
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
  -- El cliente (si se envía) debe ser de la misma empresa.
  if p_client_id is not null
     and not exists (
       select 1 from clients c where c.id = p_client_id and c.company_id = v_company
     ) then
    raise exception 'Cliente inválido';
  end if;

  insert into route_pickups (company_id, route_id, client_id, customer_name, address, items)
  values (
    v_company,
    p_route_id,
    p_client_id,
    nullif(trim(p_customer_name), ''),
    nullif(trim(p_address), ''),
    coalesce(p_items, '[]'::jsonb)
  )
  returning id into v_pickup;

  select count(*) into v_pos from route_stops where route_id = p_route_id;
  insert into route_stops (company_id, route_id, pickup_id, position)
  values (v_company, p_route_id, v_pickup, v_pos);

  return v_pickup;
end$$;

grant execute on function public.add_route_pickup(uuid, text, text, jsonb, uuid) to authenticated;

-- Cerrar una ruta. Los pedidos NO entregados y los retiros NO recogidos son
-- "pendientes"; los entregados/recogidos quedan como historial en la ruta.
--  - p_target_route_id no nulo: mueve los pendientes a esa ruta.
--  - p_target_route_id nulo: desasigna los pendientes (los pedidos quedan sin
--    ruta y los retiros quedan pendientes para reasignar).
-- Luego marca la ruta como cerrada (closed_at = now()).
create or replace function public.close_route(
  p_route_id uuid,
  p_target_route_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_pos     int := 0;
  r         record;
begin
  select company_id into v_company from routes where id = p_route_id;
  if v_company is null then raise exception 'Ruta no encontrada'; end if;
  if v_company <> current_company_id() then raise exception 'No autorizado'; end if;

  if p_target_route_id is not null then
    if not exists (
      select 1 from routes where id = p_target_route_id and company_id = v_company
    ) then
      raise exception 'Ruta destino inválida';
    end if;
    select count(*) into v_pos from route_stops where route_id = p_target_route_id;
  end if;

  for r in
    select rs.id as stop_id, rs.order_id, rs.pickup_id
    from route_stops rs
    left join orders o        on o.id = rs.order_id
    left join route_pickups p on p.id = rs.pickup_id
    where rs.route_id = p_route_id
      and (
        (rs.order_id is not null and o.status = 'ordered')
        or (rs.pickup_id is not null and p.done = false)
      )
  loop
    if p_target_route_id is not null then
      update route_stops
        set route_id = p_target_route_id, position = v_pos
        where id = r.stop_id;
      v_pos := v_pos + 1;
      if r.pickup_id is not null then
        update route_pickups set route_id = p_target_route_id where id = r.pickup_id;
      end if;
    else
      delete from route_stops where id = r.stop_id;
      if r.pickup_id is not null then
        update route_pickups set route_id = null, done = false where id = r.pickup_id;
      end if;
    end if;
  end loop;

  update routes set closed_at = now() where id = p_route_id;
end$$;

grant execute on function public.close_route(uuid, uuid) to authenticated;

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
    and o.status = 'delivered'
    and (current_user_role() <> 'repartidor' or r.driver_id = auth.uid())
    and (p_driver_id is null or r.driver_id = p_driver_id)
    -- Se filtra por la FECHA DE ENTREGA (delivered_at), en hora local de Chile
    -- para que coincida con las fechas que elige el usuario.
    and (p_from is null
         or (o.delivered_at at time zone 'America/Santiago')::date >= p_from)
    and (p_to is null
         or (o.delivered_at at time zone 'America/Santiago')::date <= p_to)
  group by r.driver_id, pf.full_name, pf.email, pr.id, pr.name
  order by driver_name, pr.name;
$$;

grant execute on function public.delivery_summary(uuid, date, date) to authenticated;

-- ----------------------------------------------------------------------------
--  Búsqueda paginada de pedidos (lista de Pedidos). Filtra EN EL SERVIDOR por
--  texto (nombre del cliente registrado o de la venta rápida), cliente, rango de
--  fechas de creación (hora de Chile), estado, pago y método; devuelve sólo la
--  página de ids (más recientes primero) y el total de coincidencias
--  (count(*) over(), calculado antes del LIMIT). La UI luego trae únicamente esos
--  pedidos con sus columnas mínimas → mucho menos egress que descargar todo.
--  SECURITY INVOKER: se apoya en RLS (sólo ve los pedidos de su empresa).
-- ----------------------------------------------------------------------------
create or replace function public.search_order_ids(
  p_query   text    default null,
  p_client  uuid    default null,
  p_from    date    default null,
  p_to      date    default null,
  p_status  text    default null,
  p_paid    boolean default null,
  p_method  text    default null,
  p_limit   int     default 10,
  p_offset  int     default 0
)
returns table (id uuid, total bigint)
language sql stable security invoker set search_path = public as $$
  select o.id, count(*) over() as total
  from orders o
  left join clients c on c.id = o.client_id
  where o.company_id = current_company_id()
    and (p_client is null or o.client_id = p_client)
    and (p_status is null or o.status = p_status::order_status)
    and (p_paid   is null or o.paid = p_paid)
    and (p_method is null or o.payment_method = p_method::payment_method)
    and (p_from is null
         or (o.created_at at time zone 'America/Santiago')::date >= p_from)
    and (p_to is null
         or (o.created_at at time zone 'America/Santiago')::date <= p_to)
    and (
      p_query is null
      or coalesce(
           nullif(btrim(coalesce(c.name, '') || ' ' || coalesce(c.surname, '')), ''),
           o.customer_name,
           ''
         ) ilike '%' || p_query || '%'
    )
  order by o.created_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0)
$$;

grant execute on function public.search_order_ids(text, uuid, date, date, text, boolean, text, int, int) to authenticated;

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
alter table route_pickups add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table whatsapp_templates add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table cost_categories add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table costs add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
-- Quién registró el costo (para atribuirlo y filtrarlo por usuario).
alter table costs add column if not exists created_by uuid references profiles (id) on delete set null default auth.uid();
alter table providers add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table supply_purchases add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();
alter table supply_purchase_items add column if not exists company_id uuid references companies (id) on delete cascade default current_company_id();

-- ----------------------------------------------------------------------------
--  Auditoría: quién creó/modificó y cuándo (orders, costs, profiles). Lo llena
--  automáticamente un trigger, así el frontend no puede falsear el autor.
-- ----------------------------------------------------------------------------
alter table orders   add column if not exists created_by uuid references profiles (id) on delete set null default auth.uid();
alter table orders   add column if not exists updated_at timestamptz;
alter table orders   add column if not exists updated_by uuid references profiles (id) on delete set null;
alter table costs    add column if not exists updated_at timestamptz;
alter table costs    add column if not exists updated_by uuid references profiles (id) on delete set null;
alter table profiles add column if not exists created_by uuid references profiles (id) on delete set null;
alter table profiles add column if not exists updated_at timestamptz;
alter table profiles add column if not exists updated_by uuid references profiles (id) on delete set null;

create or replace function public.set_audit_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end$$;

drop trigger if exists audit_orders on orders;
create trigger audit_orders before insert or update on orders
  for each row execute function public.set_audit_fields();
drop trigger if exists audit_costs on costs;
create trigger audit_costs before insert or update on costs
  for each row execute function public.set_audit_fields();
drop trigger if exists audit_profiles on profiles;
create trigger audit_profiles before insert or update on profiles
  for each row execute function public.set_audit_fields();

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
  update route_pickups set company_id = cid where company_id is null;
  update providers set company_id = cid where company_id is null;
  update supply_purchases set company_id = cid where company_id is null;
  update supply_purchase_items set company_id = cid where company_id is null;
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
      where rs.route_id = routes.id and o.status = 'delivered'
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
--  entre empresas. El frontend NO necesita filtrar por company_id: la BD lo
--  garantiza para TODA consulta, actual o futura.
--
--  ▶ CHECKLIST AL AGREGAR UNA TABLA NUEVA (obligatorio para no filtrar datos):
--     1. Agrega la columna `company_id ... default current_company_id()`
--        (en la sección de ALTERs de company_id, y en el backfill de datos).
--     2. `alter table <tabla> enable row level security;` (lista de abajo).
--     3. Agrégala al arreglo del loop que limpia políticas viejas.
--     4. Crea una política `tenant_<tabla>` con
--        `using/with check (company_id = current_company_id())`
--        (más restricciones por rol si aplica, como en routes/route_stops).
--  Verifica luego con la consulta de diagnóstico de supabase/verify-rls.sql.
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
alter table route_pickups enable row level security;
alter table whatsapp_templates enable row level security;
alter table cost_categories enable row level security;
alter table costs       enable row level security;
alter table providers   enable row level security;
alter table supply_purchases enable row level security;
alter table supply_purchase_items enable row level security;
alter table companies   enable row level security;
alter table profiles    enable row level security;

-- Tablas simples: acceso a cualquier fila de la empresa del usuario.
do $$
declare
  t text;
begin
  foreach t in array array['clients', 'addresses', 'products', 'supplies', 'product_supplies', 'whatsapp_templates', 'cost_categories', 'costs', 'providers', 'supply_purchases', 'supply_purchase_items', 'orders', 'order_items', 'routes', 'route_stops', 'route_loads', 'route_pickups']
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

-- Abastecimiento (proveedores y compras de insumos): sólo admin/operador de la
-- empresa; el repartidor no tiene acceso.
create policy "tenant_providers" on providers for all
  using (company_id = current_company_id() and current_user_role() <> 'repartidor')
  with check (company_id = current_company_id() and current_user_role() <> 'repartidor');
create policy "tenant_supply_purchases" on supply_purchases for all
  using (company_id = current_company_id() and current_user_role() <> 'repartidor')
  with check (company_id = current_company_id() and current_user_role() <> 'repartidor');
create policy "tenant_supply_purchase_items" on supply_purchase_items for all
  using (company_id = current_company_id() and current_user_role() <> 'repartidor')
  with check (company_id = current_company_id() and current_user_role() <> 'repartidor');

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
-- Retiros: el repartidor sólo ve/gestiona los de sus rutas asignadas.
create policy "tenant_route_pickups" on route_pickups for all
  using (
    company_id = current_company_id()
    and (current_user_role() <> 'repartidor' or is_my_route(route_id))
  )
  with check (
    company_id = current_company_id()
    and (current_user_role() <> 'repartidor' or is_my_route(route_id))
  );

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
--  - Escritura: admin/operador siempre; el repartidor puede registrar y AGREGAR
--    carga en las rutas asignadas a él (aunque ya esté confirmada, para poder
--    sumar carga durante el día). Nunca en rutas que no son suyas.
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
    and (current_user_role() <> 'repartidor' or is_my_route(route_id))
  )
  with check (
    company_id = current_company_id()
    and (current_user_role() <> 'repartidor' or is_my_route(route_id))
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
  using (is_superadmin() or id = my_company_id());

-- Planes: catálogo de lectura pública (para la landing y el selector interno);
-- sólo el superadmin los modifica.
alter table plans enable row level security;
drop policy if exists "plans_read" on plans;
create policy "plans_read" on plans for select using (true);
drop policy if exists "plans_superadmin" on plans;
create policy "plans_superadmin" on plans for all
  using (is_superadmin()) with check (is_superadmin());

-- Suscripciones: cada empresa lee la suya (aunque esté vencida, vía
-- my_company_id()); sólo el superadmin las crea/edita (fase manual).
alter table subscriptions enable row level security;
drop policy if exists "subscriptions_read" on subscriptions;
create policy "subscriptions_read" on subscriptions for select
  using (is_superadmin() or company_id = my_company_id());
drop policy if exists "subscriptions_superadmin" on subscriptions;
create policy "subscriptions_superadmin" on subscriptions for all
  using (is_superadmin()) with check (is_superadmin());

-- Pagos de suscripción: la empresa lee los suyos (aunque esté vencida); sólo el
-- superadmin los registra.
alter table subscription_payments enable row level security;
drop policy if exists "sub_payments_read" on subscription_payments;
create policy "sub_payments_read" on subscription_payments for select
  using (is_superadmin() or company_id = my_company_id());
drop policy if exists "sub_payments_superadmin" on subscription_payments;
create policy "sub_payments_superadmin" on subscription_payments for all
  using (is_superadmin()) with check (is_superadmin());

-- Intentos de pago: la empresa lee los suyos (aunque esté vencida); las Edge
-- Functions escriben con service role (saltan RLS). Sólo el superadmin gestiona.
alter table payment_intents enable row level security;
drop policy if exists "payment_intents_read" on payment_intents;
create policy "payment_intents_read" on payment_intents for select
  using (is_superadmin() or company_id = my_company_id());
drop policy if exists "payment_intents_superadmin" on payment_intents;
create policy "payment_intents_superadmin" on payment_intents for all
  using (is_superadmin()) with check (is_superadmin());

drop policy if exists "companies_superadmin" on companies;
create policy "companies_superadmin" on companies for all
  using (is_superadmin()) with check (is_superadmin());

drop policy if exists "companies_admin_update" on companies;
create policy "companies_admin_update" on companies for update
  using (is_company_admin() and id = current_company_id())
  with check (is_company_admin() and id = current_company_id());

-- Sólo el superadmin puede cambiar los módulos de una empresa (aunque el admin
-- pueda renombrarla). Trigger de defensa: bloquea el cambio de "modules" si el
-- que actualiza no es superadmin.
create or replace function public.guard_company_modules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.modules is distinct from old.modules) and not is_superadmin() then
    raise exception 'Sólo el superadmin puede cambiar los módulos de la empresa';
  end if;
  return new;
end$$;
drop trigger if exists companies_guard_modules on companies;
create trigger companies_guard_modules before update on companies
  for each row execute function public.guard_company_modules();

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
    -- Un admin de empresa sólo gestiona perfiles de SU empresa y NUNCA puede
    -- crear/ascender a 'superadmin' (eso rompería el aislamiento entre empresas).
    -- Sólo un superadmin puede otorgar el rol superadmin.
    is_superadmin()
    or (
      is_company_admin()
      and company_id = current_company_id()
      and role <> 'superadmin'
    )
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

-- Límite de tamaño (5 MB) y tipos permitidos (sólo imágenes).
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id = 'product-images';

drop policy if exists "product_images_all" on storage.objects;
drop policy if exists "product_images_read" on storage.objects;
-- Lectura pública: las imágenes de producto se muestran sin login.
create policy "product_images_read" on storage.objects for select
  using (bucket_id = 'product-images');

-- Escritura/borrado: sólo usuarios autenticados y SÓLO dentro de la "carpeta"
-- de SU empresa (los objetos se guardan como "<company_id>/<archivo>"). Así un
-- usuario no puede subir, pisar ni borrar imágenes de otra empresa.
drop policy if exists "product_images_write" on storage.objects;
create policy "product_images_write" on storage.objects for all
  to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (current_company_id())::text
  )
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (current_company_id())::text
  );

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
