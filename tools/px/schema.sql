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
