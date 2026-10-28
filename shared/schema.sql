-- Run once in a NEW Supabase project via SQL Editor. One shared OctoCert registry.
-- No users are granted membership or sent email by this migration.
begin;
create table public.octocert_members (
  user_id uuid primary key references auth.users(id),
  active boolean not null default true
);
create table public.octocert_certificates (
  id uuid primary key default gen_random_uuid(),
  client text not null check (char_length(btrim(client)) between 1 and 120),
  facility text not null check (char_length(btrim(facility)) between 1 and 160),
  number text not null check (char_length(btrim(number)) between 1 and 80),
  issued date not null,
  due date not null check (due >= issued),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id)
);
create unique index octocert_certificate_number on public.octocert_certificates (lower(btrim(number)));
create table public.octocert_history (
  id bigint generated always as identity primary key,
  certificate_id uuid not null references public.octocert_certificates(id),
  actor_id uuid not null references auth.users(id),
  actor_email text not null,
  changed_at timestamptz not null default now(),
  action text not null check (action in ('INSERT','UPDATE')),
  before_data jsonb,
  after_data jsonb not null
);
create index octocert_history_certificate on public.octocert_history (certificate_id, changed_at desc);
alter table public.octocert_members enable row level security;
alter table public.octocert_certificates enable row level security;
alter table public.octocert_history enable row level security;

create function public.octocert_is_member() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.octocert_members where user_id = (select auth.uid()) and active); $$;
revoke all on function public.octocert_is_member() from public, anon;
grant execute on function public.octocert_is_member() to authenticated;

create policy own_membership on public.octocert_members for select to authenticated using (user_id = (select auth.uid()));
create policy member_read on public.octocert_certificates for select to authenticated using ((select public.octocert_is_member()));
create policy member_insert on public.octocert_certificates for insert to authenticated with check ((select public.octocert_is_member()));
create policy member_update on public.octocert_certificates for update to authenticated using ((select public.octocert_is_member())) with check ((select public.octocert_is_member()));
create policy member_history on public.octocert_history for select to authenticated using ((select public.octocert_is_member()));

-- Author/version fields are assigned by the database, never trusted from the browser.
create function public.octocert_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authenticated user required'; end if;
  new.client := btrim(new.client); new.facility := btrim(new.facility); new.number := btrim(new.number);
  new.updated_at := clock_timestamp(); new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.created_at := new.updated_at; new.created_by := auth.uid(); new.version := 1;
  else
    new.id := old.id; new.created_at := old.created_at; new.created_by := old.created_by; new.version := old.version + 1;
  end if;
  return new;
end; $$;
create trigger octocert_stamp before insert or update on public.octocert_certificates for each row execute function public.octocert_stamp();

-- This trigger logs both the previous and resulting values in the SAME transaction.
create function public.octocert_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.octocert_history(certificate_id, actor_id, actor_email, action, before_data, after_data)
  values (new.id, auth.uid(), coalesce(auth.jwt()->>'email',''), tg_op, case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end; $$;
create trigger octocert_audit after insert or update on public.octocert_certificates for each row execute function public.octocert_audit();
revoke all on function public.octocert_stamp() from public, anon, authenticated;
revoke all on function public.octocert_audit() from public, anon, authenticated;

revoke all on public.octocert_members, public.octocert_certificates, public.octocert_history from public, anon, authenticated;
grant select on public.octocert_members, public.octocert_certificates, public.octocert_history to authenticated;
grant insert (id, client, facility, number, issued, due) on public.octocert_certificates to authenticated;
grant update (client, facility, number, issued, due) on public.octocert_certificates to authenticated;
commit;
