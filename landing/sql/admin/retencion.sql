-- Retención (propuesta; la confirma el abogado). Correr a mano cada mes hasta automatizarlo.
delete from waitlist.signups where last_attempt_at < now() - interval '24 months';
