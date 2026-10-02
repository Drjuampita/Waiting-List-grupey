-- Por fuente y campaña
select coalesce(utm_source, '(directo)') as fuente, coalesce(utm_campaign, '') as campana, count(*)
from waitlist.signups group by 1, 2 order by 3 desc;
