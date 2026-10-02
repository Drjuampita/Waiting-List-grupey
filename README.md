# Waiting-List-grupey

Landing de preregistro de `grupey.com` y su lista de espera.

- `landing/`: página estática + funciones de Vercel (`/api/pre-register`, `/api/health`). Ver [landing/README.md](landing/README.md).
- `supabase/migrations/0026_waitlist.sql`: esquema `waitlist` en la base de producción de la app.
- `docs/PLAN.md`: plan aprobado; `docs/REPORTE.md`: reporte de entrega; `docs/landing-diff.patch`: diff HTML/CSS contra el boceto para revisión de diseño.

Este repo se construyó aparte de `grupey-backend`. Al portarlo, la migración entra como `0026` en la historia de migraciones del backend y `landing/` como carpeta propia con su job de CI.
