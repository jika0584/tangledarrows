-- Curated campaign table. The mobile app reads this in batches of 25.
-- Run once in the Supabase SQL editor. PX (this tool) writes rows; the
-- app only needs the SELECT policy.

create table if not exists levels (
  level_number int primary key,
  payload jsonb not null
);

alter table levels enable row level security;

drop policy if exists "levels are readable" on levels;
create policy "levels are readable" on levels
  for select using (true);

-- Per-level high scores uploaded from player devices.
create table if not exists level_high_scores (
  id uuid primary key default gen_random_uuid(),
  level_id text not null,
  player_name text not null,
  score int not null check (score >= 0),
  achieved_at timestamptz not null default now()
);

create index if not exists level_high_scores_level_score_idx
  on level_high_scores (level_id, score desc, achieved_at asc);

alter table level_high_scores enable row level security;

drop policy if exists "high scores are readable" on level_high_scores;
create policy "high scores are readable" on level_high_scores
  for select using (true);

drop policy if exists "high scores are insertable" on level_high_scores;
create policy "high scores are insertable" on level_high_scores
  for insert with check (true);
