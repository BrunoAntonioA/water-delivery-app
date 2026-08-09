// Edge Function: destino de `urlReturn` de Flow.
//
// Flow devuelve el navegador a urlReturn mediante POST (con el token en el
// cuerpo). Un host estático (SPA) responde 405 a un POST sobre una ruta HTML,
// por eso urlReturn apunta aquí: esta función acepta el POST y responde con un
// 303 (See Other) hacia la app por GET, para que el SPA cargue normalmente.
//
// Deploy (PÚBLICO, Flow no envía JWT):
//   supabase functions deploy flow-return --no-verify-jwt
Deno.serve(() => {
  const appUrl = (
    Deno.env.get('APP_URL') ?? 'https://app.gestionaagua.cl'
  ).replace(/\/$/, '')
  return new Response(null, {
    status: 303,
    headers: { Location: `${appUrl}/suscripcion?flow=return` },
  })
})
