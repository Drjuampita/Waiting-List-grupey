# Deploy checklist

## Migraciones

| Migración | grupey-dev | Producción | Notas |
|---|---|---|---|
| `0026_waitlist.sql` | ☐ aplicada · ☐ `waitlist_writer` con login | ☐ aplicada · ☐ `waitlist_writer` con login (otra contraseña) | Solo agrega objetos. Ver `landing/README.md`. |

## Landing (`grupey.com`)

- [ ] CI en verde en el PR
- [ ] `certs/supabase-ca.crt` en el repo
- [ ] `regions` de `vercel.json` = región más cercana a la base de Supabase
- [ ] Variables de Preview cargadas y preview probado a mano
- [ ] Variables de Production cargadas (secretos distintos a Preview)
- [ ] `grupey.com` y `www.grupey.com` en el proyecto; MX/SPF/DKIM intactos
- [ ] Prueba rápida en producción (registrar `qa+<fecha>@grupey.com`, confirmar fila, borrarla, `/api/health` 200)
- [ ] Monitor de uptime (`/` y `/api/health`, 5 min) y alertas
- [ ] Bloqueantes de lanzamiento resueltos (ver `docs/REPORTE.md`, sección 10)
