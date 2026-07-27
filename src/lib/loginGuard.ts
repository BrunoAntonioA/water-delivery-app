// Control de intentos de inicio de sesión (por correo, en el navegador).
//
// Reglas: tras 3 contraseñas fallidas pide un captcha; da 3 intentos más y, si
// también fallan (6 en total), bloquea el formulario 15 minutos.
//
// OJO: esto vive en el navegador, así que es una capa de UX/fricción, NO la
// barrera real contra fuerza bruta. La barrera real es el rate limiting del
// servidor de Supabase + un captcha verificado en el servidor (Turnstile).

const KEY = 'login-guard-v1'
const CAPTCHA_AFTER = 3 // fallos antes de exigir captcha
const MAX_FAILS = 6 // fallos antes de bloquear
const LOCK_MS = 15 * 60 * 1000 // 15 minutos

interface Rec {
  fails: number
  lockUntil: number | null
}
type Store = Record<string, Rec>

function read(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Store
  } catch {
    return {}
  }
}
function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* almacenamiento no disponible: se ignora */
  }
}
function keyOf(email: string): string {
  return email.trim().toLowerCase()
}

/** ¿El registro tiene un bloqueo vigente? */
function isLocked(rec: Rec, now: number): boolean {
  return rec.lockUntil != null && rec.lockUntil > now
}

export type GuardStatus = 'ok' | 'captcha' | 'locked'

export interface GuardState {
  status: GuardStatus
  remainingMs: number // tiempo restante de bloqueo (status 'locked')
  triesLeft: number // intentos restantes antes del bloqueo
}

export function getGuardState(email: string, now = Date.now()): GuardState {
  const rec = read()[keyOf(email)]
  if (!rec || (rec.lockUntil != null && rec.lockUntil <= now)) {
    // Sin registro, o con un bloqueo ya expirado → empezar de cero.
    return { status: 'ok', remainingMs: 0, triesLeft: CAPTCHA_AFTER }
  }
  if (isLocked(rec, now)) {
    return { status: 'locked', remainingMs: rec.lockUntil! - now, triesLeft: 0 }
  }
  if (rec.fails >= CAPTCHA_AFTER) {
    return { status: 'captcha', remainingMs: 0, triesLeft: MAX_FAILS - rec.fails }
  }
  return { status: 'ok', remainingMs: 0, triesLeft: CAPTCHA_AFTER - rec.fails }
}

/** Registra un intento fallido y devuelve el nuevo estado. */
export function recordFailure(email: string, now = Date.now()): GuardState {
  const store = read()
  const k = keyOf(email)
  const prev = store[k]
  // Si venía de un bloqueo expirado, se reinicia el contador.
  const rec: Rec =
    prev && !(prev.lockUntil != null && prev.lockUntil <= now)
      ? { ...prev }
      : { fails: 0, lockUntil: null }
  rec.fails += 1
  if (rec.fails >= MAX_FAILS) rec.lockUntil = now + LOCK_MS
  store[k] = rec
  write(store)
  return getGuardState(email, now)
}

/** Limpia el registro tras un inicio de sesión exitoso. */
export function recordSuccess(email: string): void {
  const store = read()
  delete store[keyOf(email)]
  write(store)
}

export const LOCK_MINUTES = LOCK_MS / 60000
