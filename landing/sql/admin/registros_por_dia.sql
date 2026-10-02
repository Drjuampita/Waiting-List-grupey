-- Registros por día (hora de CDMX)
select (created_at at time zone 'America/Mexico_City')::date as dia, count(*)
from waitlist.signups group by 1 order by 1 desc;
