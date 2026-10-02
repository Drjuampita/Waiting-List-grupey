-- Sospechosos: picos por hora en los últimos 7 días
select date_trunc('hour', created_at) as hora, count(*)
from waitlist.signups where created_at > now() - interval '7 days'
group by 1 having count(*) > 50 order by 1 desc;

-- Sospechosos: dominios con muchos registros en 24 h
select split_part(email_normalized, '@', 2) as dominio, count(*)
from waitlist.signups where created_at > now() - interval '1 day'
group by 1 order by 2 desc limit 20;
