-- Solicitudes ARCO. Normaliza el correo antes: npm run normalize -- "<correo>"
-- Registra cada solicitud (fecha, tipo, resultado) en el registro interno SIN el correo.

-- Acceso
select email, created_at, form, utm_source, consented_at, privacy_version, status
from waitlist.signups where email_normalized = '<correo normalizado>';

-- Oposición (baja)
update waitlist.signups set status = 'unsubscribed' where email_normalized = '<correo normalizado>';

-- Cancelación: se BORRA la fila (no se "enmascara" dejando email_normalized)
delete from waitlist.signups where email_normalized = '<correo normalizado>';
