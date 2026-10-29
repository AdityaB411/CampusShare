-- CampusShare migration 015: avoid recursive RLS evaluation in identity helper functions.
-- These helpers return only the caller's own authorization booleans. SECURITY
-- DEFINER is required here because they are invoked from policies on profiles;
-- SECURITY INVOKER would recursively evaluate the profiles policy itself.
create or replace function public.is_admin_or_manager()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.primary_role in ('admin', 'manager')
  );
$function$;

create or replace function public.is_verified_owner()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.primary_role in ('owner', 'manager', 'admin')
       and p.owner_verification_status = 'verified'
  );
$function$;

revoke all on function public.is_admin_or_manager() from public, anon;
revoke all on function public.is_verified_owner() from public, anon;
grant execute on function public.is_admin_or_manager() to authenticated;
grant execute on function public.is_verified_owner() to authenticated;

comment on function public.is_admin_or_manager() is
  'Returns only whether the current caller is a manager or administrator; SECURITY DEFINER avoids recursive profile RLS evaluation.';
comment on function public.is_verified_owner() is
  'Returns only whether the current caller is an eligible verified custodian; SECURITY DEFINER avoids recursive profile RLS evaluation.';
