-- Short English previews of each catalog voice ("Hi! This is <voice>…"), generated once by the orbi
-- function and shared by every account, so listening to a voice before choosing it costs nobody credits.
create table if not exists public.voice_samples (
  model text not null,
  voice text not null,
  mime text not null,
  audio bytea not null,
  created_at timestamptz not null default now(),
  primary key (model, voice)
);

-- Only the function (service role) reads and writes it; no policy means no client access.
alter table public.voice_samples enable row level security;
