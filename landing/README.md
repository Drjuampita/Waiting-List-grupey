# Grupey — landing de preregistro

`grupey.com`: la landing estática del boceto más una función serverless que guarda correos en la lista de espera.

## Arquitectura

```text
Navegador ── grupey.com (public/index.html + /app.js)
   │  POST /api/pre-register   (mismo origen: sin CORS)
   ▼
Vercel Function (Node 20, api/pre-register.ts)
   │  método, Content-Type, tamaño, Origin, rate limit por IP,
   │  honeypot, normalización/validación, rate limit por correo
   │  SELECT waitlist.pre_register($1..$12)
   │  usuario Postgres: waitlist_writer (solo puede ejecutar esa función)
   │  conexión: pooler de Supabase (Supavisor), modo transacción, puerto 6543, SSL verificado
   ▼
Supabase Postgres (proyecto de PRODUCCIÓN de la app)
   esquema `waitlist` (no expuesto por la API REST de Supabase)
   tabla waitlist.signups  (RLS activo, sin políticas, sin permisos para anon/authenticated)
```

```text
supabase/migrations/0026_waitlist.sql   migración (en la raíz del repo)
landing/
├─ public/        index.html (boceto + cambios mínimos), app.js, gracias, registro-error, 404,
│                 privacidad (PROVISIONAL), site.css, robots.txt, sitemap.xml, íconos y og.png
├─ api/           pre-register.ts, health.ts (firma web estándar Request → Response)
├─ lib/           config, normalizeEmail, validate, rateLimit, db, log, responses, preRegister, health
├─ certs/         supabase-ca.crt (se agrega a mano; ver abajo)
├─ sql/admin/     consultas para founders (por día, por fuente, sospechosos, ARCO, retención)
├─ design/        boceto.html original (referencia para la prueba visual)
├─ scripts/       dev-server.ts, normalize.ts, make-icons.ts
├─ test/          unit/, integration/ (node --test + Postgres 16), e2e/ (Playwright)
└─ vercel.json    headers, región, redirect www → apex, cleanUrls
```

## Base de datos (0026)

- `waitlist.signups`: `UNIQUE (email_normalized)`, checks de longitud por columna, índice por `created_at`, RLS activo sin políticas, trigger de `updated_at`.
- `waitlist.pre_register(...)`: única puerta de escritura. Un solo `INSERT … ON CONFLICT`: el primer contacto (correo, form, UTMs, ref, referrer y ruta) nunca se sobrescribe; suma `attempts`; reactiva una baja con consentimiento nuevo. Es `security definer` con `search_path = ''`.
- `waitlist_writer`: solo `USAGE` del esquema y `EXECUTE` de la función. `statement_timeout = 4s`, máximo 20 conexiones. `anon`, `authenticated` y `service_role` no tienen nada en el esquema.

### Activar `waitlist_writer` (una vez por ambiente, con contraseña distinta)

```sql
alter role waitlist_writer with login password '<32+ caracteres aleatorios>';
```

En Supabase el usuario del pooler es `waitlist_writer.<project_ref>`.

### CA de Supabase

Dashboard → Project Settings → Database → SSL → descargar el certificado y guardarlo como `certs/supabase-ca.crt` (es público; se sube al repo). `vercel.json` lo incluye en la función. Sin él, cualquier base que no sea local hace que la función responda 503 (`invalid_config`). Nunca se usa `rejectUnauthorized: false`.

## Variables de entorno

| Variable | Secreta | Development | Preview (staging) | Production |
|---|---|---|---|---|
| `DATABASE_URL` | sí | Postgres local | Supabase `grupey-dev`, pooler 6543 | Supabase de producción, pooler 6543 |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | token sí | vacío (limitador en memoria) | obligatorio | obligatorio |
| `ALLOWED_ORIGINS` | no | `http://localhost:3000` | se agregan solas `VERCEL_URL` y `VERCEL_BRANCH_URL` | `https://grupey.com` |
| `PRIVACY_POLICY_VERSION` | no | cualquiera | cualquiera | fecha del aviso vigente |
| `LOG_HASH_SECRET` | sí | 32+ caracteres | **distinto** | **distinto** |
| `RATE_LIMIT_IP_PER_MINUTE` / `RATE_LIMIT_EMAIL_PER_DAY` | no | 20 / 10 | 20 / 10 | 20 / 10 (súbelo el día de un evento) |
| `DATABASE_CA_PATH` | no | — | opcional | opcional |
| `SENTRY_DSN` | no | — | opcional | recomendado |

Prefijo de Redis: `waitlist:` en producción, `waitlist-dev:` en los demás.

La configuración se valida al cargar el módulo. En producción la función **se niega a operar** (503 + log `invalid_config` con los nombres de las variables, nunca sus valores) si `DATABASE_URL` apunta a localhost, faltan Upstash o algún secreto, o `ALLOWED_ORIGINS` incluye localhost o `.vercel.app`.

Con `SENTRY_DSN`, cada 5xx y cada fallo de `/api/health` manda una alerta a Sentry (sin SDK, por la API de envelopes). Solo viajan códigos y `request_id`, nunca correo, IP ni `err.message`. Máximo una alerta por tipo y minuto por instancia.

Rate limit: 20/min por IP y 10/día por **correo + IP**. Así, un tercero que conoce un correo no puede bloquear el registro de esa persona desde otra red.

## Contrato de la API

### `POST /api/pre-register`

`Content-Type: application/json` (o `application/x-www-form-urlencoded` sin JS), máximo 8 KB.

```json
{ "email": "ana@example.com", "form": "hero", "utm_source": "instagram", "utm_medium": null,
  "utm_campaign": null, "utm_content": null, "utm_term": null, "ref": null,
  "referrer_host": "l.instagram.com", "landing_path": "/", "website": "" }
```

Solo el correo puede causar un 400; los metadatos raros se recortan o se descartan. `privacy_version` la pone el servidor. Orden del handler: método → Content-Type → tamaño → Origin → rate limit por IP → parseo → honeypot → correo → rate limit por correo → base.

| HTTP | `code` | Cuándo |
|---|---|---|
| 200 | `registered` | Nuevo, repetido u honeypot lleno (siempre igual) |
| 400 | `invalid_email` | Correo vacío, largo o mal formado |
| 400 | `invalid_request` | JSON roto, no objeto, `email` ausente o no string |
| 403 | `forbidden_origin` | `Origin` ausente o no permitido |
| 405 | `method_not_allowed` | Cualquier método salvo POST (`Allow: POST`) |
| 413 | `payload_too_large` | Más de 8 KB |
| 415 | `unsupported_media_type` | Ni JSON ni form-urlencoded |
| 429 | `rate_limited` | Límite excedido (`Retry-After`) |
| 500 | `internal_error` | Error inesperado |
| 503 | `service_unavailable` | Base inalcanzable o configuración inválida (`Retry-After: 30`) |
| 504 | `timeout` | La base no respondió a tiempo (conexión 3 s, consulta 4 s) |

Respuesta: `{ "ok": true, "code": "registered", "request_id": "…" }`, con `Cache-Control: no-store` y `X-Request-Id`. Sin JS (form-urlencoded) la respuesta es `303` a `/gracias` o `/registro-error`.

### `GET /api/health`

`select 1` con tope de 2 s, cacheado 15 s por instancia y 15 s en la CDN (`s-maxage=15`), así que abusar del endpoint no llega a la base. `{"status":"ok"}` (200) o `{"status":"degraded"}` (503).

## Desarrollo local

Requisitos: Node 20+, Postgres 16 (Docker o local).

```bash
docker run -d --name grupey-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=waitlist_test -p 5432:5432 postgres:16
cd landing && npm ci

# Pruebas unitarias e integración (crean roles anon/authenticated, aplican 0026 y activan el writer)
npm test
# E2E + visual (levanta el servidor de pruebas en :3100)
npx playwright install chromium   # una vez
npm run test:e2e

# Servidor local (http://localhost:3000) contra la base de pruebas
DATABASE_URL=postgresql://waitlist_writer:writer_test_password_0123456789@localhost:5432/waitlist_test \
ALLOWED_ORIGINS=http://localhost:3000 PRIVACY_POLICY_VERSION=dev \
LOG_HASH_SECRET=$(openssl rand -hex 32) npm run dev
```

`npm run dev` sirve `public/` con los headers de `vercel.json` y monta los handlers reales. También funciona `vercel dev`.

Otros comandos: `npm run typecheck`, `npm run normalize -- "<correo>"` (imprime el correo normalizado), `npx tsx scripts/make-icons.ts` (regenera íconos y `og.png` provisionales con el servidor en :3000).

CI (`.github/workflows/ci.yml`, job `landing`): Postgres 16 como servicio, `npm audit --audit-level=high`, typecheck, pruebas 1–18, Playwright 19–26. Las capturas de la prueba visual quedan como artefacto (`test-results/visual/`).

## Deployment

Proyecto de Vercel con **Root Directory = `landing`**. Toda la configuración está en `vercel.json`. Ajusta `regions` a la región de Vercel más cercana a la base de Supabase (hoy `iad1`, confirmar).

1. **PR** con CI en verde.
2. **Staging:** aplica `0026_waitlist.sql` en `grupey-dev` (SQL Editor o CLI) y anótala en `DEPLOY_CHECKLIST.md`; activa `waitlist_writer` con su contraseña; carga las variables de Preview; abre el preview (Deployment Protection: usa tu sesión de Vercel o un token de bypass) y prueba a mano.
3. **Producción** (la dispara JP con OK explícito): aplica 0026 en producción; activa `waitlist_writer` con **otra** contraseña; carga las variables de Production; agrega `grupey.com` y `www.grupey.com` al proyecto (al tocar el DNS **no borres** MX, SPF ni DKIM); deploy.
4. **Verificación:** `curl -sI https://grupey.com` muestra los headers; `www` redirige con 308; `/api/health` da 200; registra `qa+<fecha>@grupey.com`, confirma la fila en producción y **bórrala**. Configura el monitor de uptime (`/` y `/api/health` cada 5 min).

### Rollback

- Código: "Instant Rollback" de Vercel.
- Base: nunca se edita una migración aplicada. Se corrige con una nueva (0027…). Deshacer 0026 sin datos reales: `drop schema waitlist cascade; drop role waitlist_writer;` como migración nueva. Con datos reales, exporta primero.

## Operación

- **Admin:** dashboard de Supabase (Table Editor → esquema `waitlist`) con 2FA obligatorio. Consultas en `sql/admin/`. Exportar: CSV desde el Table Editor o `\copy` en psql.
- **ARCO:** `npm run normalize -- "<correo>"` y luego `sql/admin/arco.sql`. Registra cada solicitud (fecha, tipo, resultado) sin el correo.
- **Retención:** `sql/admin/retencion.sql` cada mes (propuesta; la confirma el abogado).
- **Respaldo semanal** (pooler en modo sesión, 5432, o host directo; no el host de la API):

  ```bash
  pg_dump "postgresql://postgres.<project_ref>:<password>@<pooler-host>:5432/postgres" \
    --data-only --schema=waitlist -f waitlist_$(date +%F).sql
  age -r <llave-publica> -o waitlist_$(date +%F).sql.age waitlist_$(date +%F).sql && rm waitlist_$(date +%F).sql
  ```

  Guarda los archivos cifrados con acceso restringido, 8 semanas. Restaurar: descifra y `psql "<url de grupey-dev>" -f waitlist_<fecha>.sql` sobre una base con 0026 aplicada. Haz el simulacro una vez en `grupey-dev` y anota pasos y tiempo.

- **Logs:** una línea JSON por request (`msg: "pre_register"`) con `status`, `code`, `inserted`, `form`, `utm_source`, `email_hmac`, `ip_hmac`, `honeypot`, `duration_ms`, `db_ms`. Nunca correo, IP en claro, cuerpo, headers ni `err.message` de Postgres (solo `err_code`). Mira: registros por día, tasa de 4xx/5xx, 429 y honeypots, latencia p95.

## Al lanzar la app

El botón "Únete a la lista" pasa a "Crear mi grupo" y apunta a la app. Elementos de `public/index.html` que cambian:

1. Nav: `a.btn` "Únete a la lista" (`href="#lista"`).
2. Hero: `form[data-waitlist="hero"]` y su `.waitlist-note`.
3. Cierre: `form[data-waitlist="cierre"]` y su nota de consentimiento.

El endpoint sigue vivo para páginas en caché.

## Troubleshooting

| Síntoma | Causa probable |
|---|---|
| 403 en un preview | `ALLOWED_ORIGINS` o la URL del preview (`VERCEL_URL`/`VERCEL_BRANCH_URL`) |
| 503 en todo | Configuración inválida: busca `invalid_config` en los logs (lista qué falta) |
| `password authentication failed` (`err_code: 28P01`) | El usuario del pooler es `waitlist_writer.<project_ref>` |
| Error de certificado SSL | Falta o no corresponde `certs/supabase-ca.crt` |
| Violación de CSP en consola | Algo nuevo carga de otro origen; la CSP solo permite `'self'` y `data:` para fuentes e imágenes |
| Muchos 429 en un evento | Sube `RATE_LIMIT_IP_PER_MINUTE` ese día |
| 504 frecuentes | Base lenta o región de Vercel lejos de Supabase (`regions` en `vercel.json`) |
