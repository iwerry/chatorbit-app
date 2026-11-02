-- Estimated cost of each video at submit time: the charge floor when OpenRouter reports no cost.
alter table public.video_jobs add column if not exists est_usd double precision not null default 0;
