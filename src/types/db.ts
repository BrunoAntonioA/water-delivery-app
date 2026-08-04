// Estado de ENTREGA (el pago va aparte, en el booleano `paid`).
export type OrderStatus = 'ordered' | 'delivered'

export type PaymentMethod = 'transferencia' | 'efectivo' | 'tarjeta'

/** Un tramo de pago: un método y el monto pagado con ese método. */
export interface OrderPayment {
  method: PaymentMethod
  amount: number
}

export interface Client {
  id: string
  name: string
  surname: string
  national_id: string | null
  phone: string
  created_at: string
}

export interface Address {
  id: string
  client_id: string
  label: string | null
  address: string
  comuna: string | null
  observation: string | null
  created_at: string
}

export interface Supply {
  id: string
  name: string
  created_at: string
}

/** Un insumo que compone un producto, con su cantidad. */
export interface ProductSupplyLink {
  supply_id: string
  quantity: number
}

export interface Product {
  id: string
  name: string
  description: string | null
  price: number
  image_url: string | null
  supplies: ProductSupplyLink[]
  created_at: string
}

export interface WhatsappTemplate {
  id: string
  name: string
  content: string
  created_at: string
}

export interface CostCategory {
  id: string
  name: string
  created_at: string
}

export interface Cost {
  id: string
  name: string
  description: string | null
  issue_date: string
  category_id: string | null
  amount: number
  created_by: string | null
  created_at: string
}

export interface CostWithCategory extends Cost {
  category: CostCategory | null
  creatorName: string | null
}

export interface Order {
  id: string
  client_id: string | null
  customer_name: string | null
  address_id: string | null
  status: OrderStatus // entrega
  paid: boolean // pago (independiente de la entrega)
  total: number
  payment_method: PaymentMethod | null
  paid_amount: number | null
  // Desglose del pago: 1 elemento (método único) o 2 (pago dividido). La suma de
  // los montos es igual al total del pedido. Null en pedidos sin pago o antiguos.
  payments: OrderPayment[] | null
  returned_bidones: number | null
  // Fecha de ENTREGA (se llena al marcar entregado; null si aún no se entrega).
  delivered_at: string | null
  notes: string | null
  created_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  quantity: number
  unit_price: number
}

// --- Tipos "enriquecidos" que devuelven las consultas con joins ---

export interface ClientWithAddresses extends Client {
  addresses: Address[]
}

export interface OrderItemWithProduct extends OrderItem {
  product: Product | null
}

export interface OrderDetail extends Order {
  client: Client | null
  address: Address | null
  items: OrderItemWithProduct[]
  // Repartidor de la ruta a la que pertenece el pedido (si está en una).
  driverId?: string | null
  driverName?: string | null
}

// --- Rutas de reparto ---

export interface Route {
  id: string
  name: string | null
  route_date: string
  driver: string | null
  driver_id: string | null
  notes: string | null
  load_confirmed: boolean
  created_at: string
}

export interface RouteLoad {
  id: string
  route_id: string
  supply_id: string
  quantity: number
}

export interface RoutePickup {
  id: string
  route_id: string
  client_id: string | null
  client: Client | null
  customer_name: string | null
  address: string | null
  items: { supply_id: string; quantity: number }[]
  done: boolean
  created_at: string
}

export interface RouteStop {
  id: string
  route_id: string
  order_id: string | null
  pickup_id: string | null
  position: number
  created_at: string
}

export interface RouteStopWithOrder extends RouteStop {
  order: OrderDetail | null
  pickup: RoutePickup | null
}

export interface RouteDetail extends Route {
  stops: RouteStopWithOrder[]
  loads: RouteLoad[]
  driverName?: string | null
}
