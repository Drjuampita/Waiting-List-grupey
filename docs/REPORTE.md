# Reporte de entrega — preregistro de Grupey

Fecha: 2 oct 2026. Rama: `claude/exciting-rubin-bo371t`. Construido en `Waiting-List-grupey` (decisión de JP), no en `grupey-backend`.

## 1. Auditoría del frontend

Los 13 hallazgos de la sección 3 de la guía se confirmaron contra el boceto. Qué se cambió (diff completo en `docs/landing-diff.patch`):

| # | Cambio |
|---|---|
| 1 | Esqueleto HTML5: `lang="es-MX"`, charset, viewport, título y description reales, canonical, OG/Twitter, íconos, `theme-color`. |
| 2–4 | Formularios con `method="post" action="/api/pre-register"`, `data-waitlist="hero|cierre"`; input con `name="email" autocomplete="email" inputmode="email" maxlength="254" autocapitalize="off" spellcheck="false"`; honeypot `website`. |
| 5 | `.is-sending`, `.waitlist-error` y `--danger: #C8402E`. |
| 6 | Línea de consentimiento con link a `/privacidad` bajo ambos formularios (en el hero, sumada a la nota existente). |
| 7, 12 | Footer: "Términos" y "Legal" quitados (default), privacidad → `/privacidad`, Contacto → `mailto:hola@grupey.com`, @grupey → Instagram (`target="_blank" rel="noopener"`). Nuevos: `gracias`, `registro-error`, `404`, `privacidad`, `robots.txt`, `sitemap.xml`, íconos y `og.png`. |
| 8 | El estado oculto de `.reveal` solo aplica bajo `html.js`; sin IntersectionObserver todo se marca `.seen`. |
| 9 | JS movido a `/app.js` (`defer`); CSS inline intacto. |
| 10 | **Provisional:** "Lanzamos muy pronto" (hero) y "Muy pronto." (FAQ). |
| 11 | Footer: queda "Los montos y nombres mostrados son ilustrativos." |
| 13 | Errores con `role="alert"` y foco al mensaje o al input. |

**Hallazgo nuevo (resuelto):** el boceto no tiene `<!doctype>`, así que se renderiza en *quirks mode*. Con el doctype, dos líneas que solo contienen un `<span>` pequeño (`.hcard-goal .mini` y `.case-body .money`) crecían de 2 a 7 px. La compensación mínima es `display: block` en esos dos selectores. Con eso la página es **idéntica pixel a pixel** al boceto en 375 y 1440 px, salvo los cambios listados (prueba 26).

## 2. Arquitectura

Igual que la sección 2 de la guía (diagrama en `landing/README.md`): HTML estático + `/app.js` → `POST /api/pre-register` en el mismo origen → función de Vercel (Node 20) → `waitlist.pre_register()` en Supabase con el usuario `waitlist_writer` vía el pooler (modo transacción, 6543, SSL verificado con la CA). El navegador nunca habla con Supabase y la función no recibe la `service_role`. La landing no depende de `grupey-backend`.

## 3. Base de datos

`supabase/migrations/0026_waitlist.sql`, copiada sin cambios de la guía. Esquema propio `waitlist`, tabla `signups` con `UNIQUE (email_normalized)`, checks por columna, índice por `created_at`, RLS sin políticas, trigger de `updated_at`. La función `pre_register` (security definer, `search_path=''`) hace un solo `INSERT … ON CONFLICT` que conserva el primer contacto. `waitlist_writer` solo puede ejecutar esa función. Verificado: la migración es idempotente (se aplicó dos veces seguidas sin error).

## 4. API

`POST /api/pre-register` y `GET /api/health`, con el contrato y los códigos de la sección 4 (tabla completa en `landing/README.md`). El orden de verificación es el de la guía. Sin JS, la respuesta es 303 a `/gracias` o `/registro-error`.

## 5. Seguridad

**Implementado:**
- Consultas parametrizadas (sin prepared statements con nombre).
- `textContent` para todo texto dinámico. La API solo devuelve `code`.
- CSP estricta y headers de la sección 9 en `vercel.json`.
- Sin headers CORS. `OPTIONS` y otros métodos → 405.
- Verificación de `Origin` desde `ALLOWED_ORIGINS`, más las URLs de preview automáticas.
- Rate limit con Upstash por IP y por correo. Llaves con HMAC. Fail-open a los 500 ms con log `warn`.
- Honeypot, con conteo en los logs.
- Límite de 8 KB, revisando `Content-Length` y leyendo con tope.
- SSL verificado con CA; nunca `rejectUnauthorized: false`.
- Validación de configuración al cargar el módulo; en producción se niega a operar si es insegura.
- Logs sin datos personales: `email_hmac`/`ip_hmac` de 16 hex y solo `err_code` de Postgres.
- `.env*` en `.gitignore`. `npm audit --audit-level=high`: 0 vulnerabilidades.

**Pendiente:**
- Sentry: no está integrado. Hoy los 5xx quedan solo en Vercel Runtime Logs.
- `includeSubDomains` de HSTS: se agrega cuando se confirme HTTPS en todos los subdominios.
- Turnstile: plan B, no implementado.

## 6. Manejo de fallos

Todos los escenarios de la tabla de la sección 10 tienen prueba automática, salvo dos. Uno es el deploy roto, que se cubre con el caso "respuesta no JSON" de la prueba 20. El otro es el navegador interno de Instagram, que es manual.

**Desviación justificada:** la guía asigna 503 a "base caída", pero su prueba 13 pide 504 para un servidor que acepta TCP y no contesta. Quedó así:

| Caso | Respuesta |
|---|---|
| Conexión rechazada o host inalcanzable | 503 |
| Timeout de conexión (3 s) o de consulta (4 s) | 504 |

## 7. Pruebas (resultado real, local, 2 oct 2026)

- `npm run typecheck`: ok.
- `npm test`: **23/23** en verde. Pruebas 1–2 (unitarias) y 3–18 (integración contra Postgres 16 real), más `/api/health`.
- `npm run test:e2e`: **17/17** en verde. Pruebas 19–26 en Chromium; la 20 en 7 variantes y la 22 en 375 y 390 px.
- Prueba 26: 0 píxeles distintos. Las capturas se generan en `test-results/visual/` y CI las sube como artefacto.
- CI (`.github/workflows/ci.yml`) todavía no ha corrido en GitHub: el repo no tiene PR abierto.

Notas:
- En la prueba 25, los links externos (Instagram) se validan por formato y `rel="noopener"`, no con una petición HTTP: Instagram bloquea peticiones automáticas y la prueba sería inestable.
- En la prueba 22, "textos legibles" se verifica como tamaño mínimo de 10 px.

**Pendiente manual:** navegador interno de Instagram (iOS y Android) y prueba rápida en producción.

## 8. Deployment

Development, staging, producción y rollback están en `landing/README.md`. La lista de pasos está en `DEPLOY_CHECKLIST.md`. Nada de staging ni producción se ejecutó desde aquí, porque no hay acceso a Vercel, Supabase ni Upstash en este entorno.

## 9. Future-proofing

- Misma base que la app: dar prioridad a la lista al lanzar es una consulta.
- Se puede agregar `user_id` sin tocar los datos.
- `source`, `status` y `ref` ya existen para importaciones, bajas y referidos.
- El contrato por `code` es estable.
- El cambio de botón al lanzar está documentado.

## 10. Pendientes antes de producción

**Bloquean publicar `grupey.com`**
1. Texto del aviso de privacidad y correo ARCO. `/privacidad` hoy es un placeholder con `noindex`.
2. Fecha de lanzamiento definitiva. Hoy dice "muy pronto" (provisional).
3. Confirmar que `hola@grupey.com` existe y alguien lo lee, y el handle real de Instagram.
4. Aprobar íconos y `og.png`. Los actuales son provisionales, generados desde la landing con `scripts/make-icons.ts`.
5. `certs/supabase-ca.crt` y región de Vercel cercana a la base (`regions` en `vercel.json`; hoy `iad1`).
6. Infraestructura: proyecto de Vercel (Root Directory `landing`), Upstash, `grupey-dev`, variables por ambiente, DNS.

**Antes de tráfico pagado**
7. Verificar las promesas de pago de la landing contra el backend y Stripe.
8. SPF, DKIM y DMARC, y el link de baja para el correo del lanzamiento.
9. Respaldos del plan de Supabase y simulacro de restauración.
10. Sentry y monitor de uptime.
11. Analytics de visitas sin cookies (decisión de JP).
12. `grupey-backend` `/v1/health` en 503.

**Al portar a `grupey-backend`**
- Agregar 0026 a `scripts/verify_migrations.ts`, que no existe en este repo.
- Mover el job `landing` al `ci.yml` del backend.
