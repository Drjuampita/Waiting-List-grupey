# Waiting-List-grupey

Landing de preregistro de `grupey.com` y su lista de espera.

- `landing/`: página estática + funciones de Vercel (`/api/pre-register`, `/api/health`). Ver [landing/README.md](landing/README.md).
- `supabase/migrations/0026_waitlist.sql`: esquema `waitlist` en la base de producción de la app.
- `docs/PLAN.md`: plan aprobado; `docs/REPORTE.md`: reporte de entrega; `docs/landing-diff.patch`: diff HTML/CSS contra el boceto para revisión de diseño.

Este repo se construyó aparte de `grupey-backend`. Al portarlo, la migración entra como `0026` en la historia de migraciones del backend y `landing/` como carpeta propia con su job de CI.

## Estado para lanzar (2 oct 2026)

**El código está listo y probado** (43 pruebas en verde), pero **todavía no está publicado** en `grupey.com`.

### Qué hace y qué no hace

- **Sí:** guarda correos en la lista de espera (`waitlist.signups`), con atribución (UTM, formulario) y consentimiento.
- **No crea cuentas de Grupey.** Nadie tiene usuario ni contraseña todavía. A propósito: sin verificar el correo, cualquiera podría crearle una cuenta a otra persona.
- **Plan para el lanzamiento:** a cada correo activo de la lista se le manda una invitación de Supabase Auth (enlace mágico). Al hacer clic, la persona crea su cuenta ya verificada. Como la lista vive en la misma base que la app, dar prioridad a los de la lista es una consulta.

### Pendientes para publicar

**Decisiones de los founders**
- [ ] Aviso de privacidad (texto revisado por abogado). En proceso: `docs/aviso-privacidad/`.
- [ ] Fecha de lanzamiento real (hoy dice "muy pronto").
- [ ] Confirmar `hola@grupey.com` y el Instagram real.
- [ ] Aprobar favicon e imagen para redes (hoy provisionales).

**Técnico**
- [ ] Aplicar `0026_waitlist.sql` en Supabase de producción y activar `waitlist_writer`.
- [ ] Guardar la CA de Supabase en `landing/certs/supabase-ca.crt`.
- [ ] Crear el proyecto en Vercel (Root Directory `landing`) y la base de Upstash; cargar variables.
- [ ] Conectar `grupey.com` sin borrar los registros de correo (MX, SPF, DKIM).
- [ ] Prueba real en producción, monitor de uptime y `SENTRY_DSN`.

Detalle completo en `docs/REPORTE.md` (sección 10) y `DEPLOY_CHECKLIST.md`.
