/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

// Id de build inyectado por Vite (define) — se usa como "buster" para invalidar
// la caché persistida en cada deploy (evita mezclar datos con formatos viejos).
declare const __BUILD_ID__: string
