-- Activation process status vocabulary: six fixed states with published meanings.
update public.sim_activations set status = case status
  when 'running' then 'IN_PROGRESS'
  when 'waiting_ip' then 'RETRYING'
  when 'needs_retry' then 'RETRYING'
  when 'terminating' then 'UNFINISHED'
  when 'complete' then 'COMPLETED'
  when 'failed' then 'UNFINISHED'
  when 'unfinished' then 'UNFINISHED'
  else status end
  where status in ('running','waiting_ip','needs_retry','terminating','complete','failed','unfinished');

alter table public.sim_activations alter column status set default 'INITIATED';

alter table public.sim_activations drop constraint if exists sim_activations_status_check;
alter table public.sim_activations add constraint sim_activations_status_check
  check (status in ('INITIATED','IN_PROGRESS','RETRYING','COMPLETED','UNFINISHED','TERMINATED'));