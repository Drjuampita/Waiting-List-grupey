# Plan — Grupey pre-registro (v2)

Estado: **aprobado por JP** (2 oct 2026): construir en `Waiting-List-grupey`, Supabase recuperado, fecha provisional.

## Auditoría del boceto (verificada)

Coincide con la sección 3 de la guía: fragmento sin `<head>` (línea 1), dos `form[data-waitlist]` (428 hero, 656 cierre) sin `name`/`method`/`action`, `.reveal` oculto bajo `@media` (399–402) con IntersectionObserver sin fallback, "septiembre" en 425 y 690, cinco `href="#"` (705–711), "Boceto de diseño —" en 715, JS inline (719–747). Sin hallazgos nuevos.

## Estructura

```text
supabase/migrations/0026_waitlist.sql   tal cual la sección 7
landing/
  public/  index.html (boceto + cambios mínimos), app.js, gracias.html,
           registro-error.html, 404.html, privacidad.html (placeholder, bloquea lanzar),
           robots.txt, sitemap.xml, íconos/og (placeholders hasta aprobación)
  api/     pre-register.ts, health.ts   (Request/Response estándar, Node 20)
  lib/     config, normalizeEmail, validate, rateLimit (Upstash + memoria), db (pg), log, responses
  sql/admin/*.sql, certs/ (CA de Supabase; se agrega al tener acceso)
  test/    unit + integración (node --test, Postgres 16) + e2e (Playwright)
  vercel.json, package.json, tsconfig.json, .env.example, README.md
.github/workflows/ci.yml  job landing: Postgres service, typecheck, tests, Playwright, npm audit
```

## Orden de trabajo (por fases, cada una con commit y push)

1. Migración 0026 + pruebas de permisos (14, 16, 17) contra Postgres local.
2. `lib/` + `normalizeEmail` + unitarias (1–2) + `npm run normalize`.
3. `api/pre-register` y `api/health` + integración (3–13, 15, 18).
4. Landing: `index.html` con cambios mínimos, `app.js`, páginas estáticas, `vercel.json`.
5. Playwright (19–26), incluida comparación visual 375/1440 contra el boceto.
6. CI, README, troubleshooting, reporte final (sección 23).

Staging/producción (Supabase, Vercel, Upstash, DNS) quedan fuera de este entorno: se documentan y los ejecuta JP.

## Decisiones

- Driver `pg` con queries sin nombre (compatible con Supavisor modo transacción), pool de 1 por instancia, `connectionTimeoutMillis` 3 s, `query_timeout` 4 s, SSL con CA verificada.
- Rate limit detrás de una interfaz: Upstash en preview/prod, memoria en dev/tests; timeout 500 ms y fail-open.
- Servidor de pruebas mínimo en Node (sirve `public/` con los headers de `vercel.json` y monta los handlers) para integración y E2E; no se depende de `vercel dev` en CI.
- Copy de error y fecha de lanzamiento: se usan las propuestas de la guía y un placeholder visible para la fecha, marcado como pendiente.

## Riesgos

- **Precondición 1 (Supabase de producción en recuperación):** sin ella no se puede pasar de staging. El código no depende de ella.
- **Repo:** la guía pide todo dentro de `grupey-backend`; esta sesión solo tiene `Waiting-List-grupey` (vacío). Ver pregunta 1.
- Visual: mover el JS a `app.js` y el estado `.reveal` a `html.js` no debe cambiar el render; lo verifica la prueba 26.
- Navegador interno de Instagram: solo prueba manual.

## Preguntas abiertas para JP

1. ¿Construyo aquí (`Waiting-List-grupey`, con la misma estructura `landing/` + `supabase/migrations/`) y luego se porta a `grupey-backend`, o agrego `grupey-backend` a la sesión y trabajo allá como dice la guía?
2. ¿Ya se recuperó la cuenta de Supabase de producción?
3. Nueva fecha o texto para "Lanzamos en septiembre" y el FAQ (puedo dejar un placeholder mientras).
