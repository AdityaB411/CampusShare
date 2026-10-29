-- CampusShare migration 014: close nullable validation gaps in extension/resource mutations.
create or replace function public.request_booking_extension(
  p_booking_id uuid,
  p_new_end_time timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_resource public.resources%rowtype;
  v_actor_role text;
  v_clean_reason text := trim(coalesce(p_reason, ''));
  v_has_conflict boolean := false;
begin
  if v_user_id is null then raise exception 'Authentication required.'; end if;
  if length(v_clean_reason) < 3 or length(v_clean_reason) > 2000 then
    raise exception 'Extension requires a justification between 3 and 2000 characters.';
  end if;
  if p_new_end_time is null then raise exception 'A new end time is required.'; end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found.'; end if;
  if v_booking.requester_id <> v_user_id then
    raise exception 'Permission denied: only the borrower can request an extension.';
  end if;
  if v_booking.status not in ('approved', 'in_use') then
    raise exception 'Extensions can only be requested for approved or in-use bookings.';
  end if;
  if p_new_end_time <= v_booking.end_time then
    raise exception 'New end time must be later than the current scheduled end time.';
  end if;
  if v_booking.extension_status = 'pending' then
    raise exception 'There is already a pending extension request for this booking.';
  end if;

  select * into v_resource from public.resources where id = v_booking.resource_id;
  if not found then raise exception 'Resource not found.'; end if;
  if p_new_end_time > v_booking.start_time + make_interval(hours => v_resource.max_duration_hours) then
    raise exception 'Extension blocked: total booking duration cannot exceed the resource maximum of % hours.', v_resource.max_duration_hours;
  end if;

  select exists (
    select 1 from public.bookings b
     where b.resource_id = v_booking.resource_id
       and b.id <> v_booking.id
       and b.status in ('approved', 'in_use', 'return_pending')
       and b.start_time < p_new_end_time
       and b.end_time > v_booking.end_time
  ) into v_has_conflict;

  select p.primary_role into v_actor_role from public.profiles p where p.id = v_user_id;

  update public.bookings
     set extension_status = 'pending',
         extension_requested_end_time = p_new_end_time,
         extension_reason = v_clean_reason,
         extension_requested_at = now(),
         extension_decided_by = null,
         extension_decided_at = null,
         extension_decision_reason = null,
         updated_at = now()
   where id = v_booking.id;

  insert into public.activity_events (
    actor_id, actor_role_snapshot, entity_type, entity_id, action,
    previous_state, new_state, reason, metadata
  ) values (
    v_user_id, coalesce(v_actor_role, 'borrower'), 'booking', v_booking.id,
    'EXTENSION_REQUESTED', v_booking.end_time::text, p_new_end_time::text,
    v_clean_reason,
    jsonb_build_object('booking_id', v_booking.id, 'has_overlap_conflict', v_has_conflict,
                       'requested_end_time', p_new_end_time)
  );

  if v_resource.owner_id is not null then
    insert into public.notifications (
      recipient_id, type, related_entity_type, related_entity_id, message, dedupe_key
    ) values (
      v_resource.owner_id, 'general', 'booking', v_booking.id,
      'Extension requested for "' || v_resource.title || '" until ' ||
        to_char(p_new_end_time at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') || ' IST.',
      'extension_req_' || v_booking.id::text || '_' || floor(extract(epoch from now()))::bigint::text
    );
  end if;

  return jsonb_build_object(
    'success', true, 'extension_request_id', v_booking.id,
    'booking_id', v_booking.id, 'status', 'pending', 'has_conflict', v_has_conflict
  );
end;
$function$;

create or replace function public.update_resource(
  p_resource_id uuid,
  p_title text,
  p_type text,
  p_category text,
  p_summary text,
  p_location_label text,
  p_max_duration_hours integer,
  p_rules text,
  p_required_training_code text,
  p_requires_supervision boolean,
  p_new_state text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_resource public.resources%rowtype;
  v_updated public.resources%rowtype;
  v_actor_role text;
  v_training text := nullif(upper(trim(coalesce(p_required_training_code, ''))), '');
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if length(trim(coalesce(p_title, ''))) = 0
     or length(trim(coalesce(p_category, ''))) = 0
     or length(trim(coalesce(p_summary, ''))) = 0
     or length(trim(coalesce(p_location_label, ''))) = 0 then
    raise exception 'Validation error: Title, category, summary, and location are required.';
  end if;
  if p_type is null or p_type not in ('equipment', 'space') then
    raise exception 'Validation error: Resource type must be equipment or space.';
  end if;
  if p_max_duration_hours is null or p_max_duration_hours <= 0 then
    raise exception 'Validation error: Maximum duration hours must be positive.';
  end if;
  if p_new_state is null or p_new_state not in ('draft', 'published', 'paused', 'archived') then
    raise exception 'Validation error: Invalid resource state.';
  end if;

  select * into v_resource
  from public.resources
  where id = p_resource_id
  for update;
  if not found then
    raise exception 'Resource not found.';
  end if;

  if v_resource.owner_id <> v_user_id and not public.is_admin_or_manager() then
    raise exception 'Permission denied: Only the resource owner or authorised campus staff can edit this resource.';
  end if;
  if not public.is_admin_or_manager() and not public.is_verified_owner() then
    raise exception 'Permission denied: Resource owner verification is required.';
  end if;

  if p_new_state in ('paused', 'archived')
     and exists (
       select 1 from public.bookings b
       where b.resource_id = p_resource_id
         and b.status in ('in_use', 'return_pending')
         and b.actual_release_confirmed_at is null
     ) then
    raise exception 'Active custody rule: Cannot pause or archive a resource until physical hand-back is confirmed.';
  end if;

  select p.primary_role into v_actor_role
  from public.profiles p where p.id = v_user_id;

  update public.resources
  set title = trim(p_title),
      type = p_type,
      category = trim(p_category),
      summary = trim(p_summary),
      location_label = trim(p_location_label),
      max_duration_hours = p_max_duration_hours,
      rules = nullif(trim(coalesce(p_rules, '')), ''),
      required_training_code = v_training,
      requires_supervision = coalesce(p_requires_supervision, false),
      state = p_new_state,
      updated_at = now()
  where id = p_resource_id
  returning * into v_updated;

  if v_resource.state is distinct from v_updated.state then
    insert into public.activity_events (
      actor_id, actor_role_snapshot, entity_type, entity_id, action,
      previous_state, new_state, reason, metadata
    ) values (
      v_user_id, coalesce(v_actor_role, 'owner'), 'resource', p_resource_id,
      'RESOURCE_STATE_CHANGED', v_resource.state, v_updated.state,
      'Resource state updated by authorised owner or campus staff.',
      jsonb_build_object('title', v_updated.title)
    );
  end if;

  return to_jsonb(v_updated);
end;
$$;
