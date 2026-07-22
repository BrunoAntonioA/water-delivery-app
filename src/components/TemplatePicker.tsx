import { useQuery } from '@tanstack/react-query'
import { listTemplates } from '../api/templates'
import type { WhatsappTemplate } from '../types/db'
import { openWhatsApp } from '../lib/whatsapp'
import { Modal } from './Modal'
import { Spinner } from './ui'

/**
 * Modal para elegir una plantilla de WhatsApp (o el mensaje por defecto) y
 * abrir wa.me con el mensaje ya construido. Reutilizado en Cobrar y Contactar.
 */
export function TemplatePicker({
  open,
  onClose,
  phone,
  buildMessage,
  title = 'Elegir mensaje',
}: {
  open: boolean
  onClose: () => void
  phone: string
  // Recibe la plantilla elegida (o null para el mensaje por defecto) y
  // devuelve el texto final del mensaje.
  buildMessage: (template: WhatsappTemplate | null) => string
  title?: string
}) {
  const { data: templates, isLoading } = useQuery({
    queryKey: ['whatsapp_templates'],
    queryFn: listTemplates,
    enabled: open,
  })

  function send(template: WhatsappTemplate | null) {
    const ok = openWhatsApp(phone, buildMessage(template))
    if (!ok) {
      alert('El cliente no tiene un número de teléfono válido.')
      return
    }
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="mb-3 text-sm text-slate-500">
        Elige una plantilla. Se abrirá WhatsApp con el mensaje listo para enviar.
      </p>

      {isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => send(null)}
            className="flex w-full flex-col items-start rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-sky-400 hover:bg-sky-50"
          >
            <span className="text-sm font-medium text-slate-800">
              Mensaje por defecto
            </span>
            <span className="text-xs text-slate-500">
              El mensaje estándar del sistema
            </span>
          </button>

          {templates?.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => send(t)}
              className="flex w-full flex-col items-start rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-sky-400 hover:bg-sky-50"
            >
              <span className="text-sm font-medium text-slate-800">
                {t.name}
              </span>
              <span className="line-clamp-2 whitespace-pre-wrap text-xs text-slate-500">
                {t.content}
              </span>
            </button>
          ))}

          {templates && templates.length === 0 && (
            <p className="pt-1 text-xs text-slate-400">
              No tienes plantillas. Créalas en el módulo “Plantillas”.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
