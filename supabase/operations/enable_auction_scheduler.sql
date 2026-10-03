-- Run after migration 005, once the deployment is verified, as the database owner.
-- Supabase Cron must be enabled. No service key or browser is required.
-- Safe to rerun: replace only this application's existing job.
create extension if not exists pg_cron with schema pg_catalog;
do $$
declare existing_job bigint;
begin
  for existing_job in select jobid from cron.job where jobname = 'nonstop-auction-lifecycle' loop
    perform cron.unschedule(existing_job);
  end loop;
end;
$$;
select cron.schedule('nonstop-auction-lifecycle', '1 second',
  'select public.advance_all_auction_rooms();');

-- Verify: select * from cron.job where jobname = 'nonstop-auction-lifecycle';
-- Observe failures: select * from cron.job_run_details order by start_time desc limit 20;
-- Pause: select cron.unschedule('nonstop-auction-lifecycle');
