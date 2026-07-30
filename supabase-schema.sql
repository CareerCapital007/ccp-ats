-- Run this once in Supabase > SQL Editor.

create table if not exists ccp_kv (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table ccp_kv enable row level security;

-- Anyone signed in to your project can read and write the ledger.
-- This is the correct model for a small firm where the team shares one pipeline.
create policy "team reads"   on ccp_kv for select to authenticated using (true);
create policy "team inserts" on ccp_kv for insert to authenticated with check (true);
create policy "team updates" on ccp_kv for update to authenticated using (true) with check (true);
create policy "team deletes" on ccp_kv for delete to authenticated using (true);

-- Optional but recommended: restrict sign-ups to your own domain.
-- Supabase > Authentication > Providers > Email, then set the allow list there,
-- or invite users manually under Authentication > Users and disable open sign-up.
