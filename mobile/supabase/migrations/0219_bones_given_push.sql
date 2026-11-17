-- Hound: a push when an admin gives a member Bones (Steve, Nov 2026).
--
-- admin_give_bones (0218), now also sending the member "Hound sent you
-- 250 Bones 🦴 Spend them in Your look or the Kennel." through
-- send-social-push (kind 'bones_given'); tapping it opens Your look.
-- It goes even if they've turned social pushes off: it's from Hound, not
-- another member. The note stays for Admin only.
--
-- Run this once, after 0001-0218, in the SQL Editor; then deploy
-- send-social-push (supabase functions deploy send-social-push).

create or replace function public.admin_give_bones(p_user uuid, p_bones integer, p_note text default null)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  clean_note text := nullif(btrim(coalesce(p_note, '')), '');
  balance integer;
begin
  perform public.admin_require();
  if p_bones is null or p_bones < 1 or p_bones > 10000 then
    raise exception 'Give between 1 and 10,000 Bones.';
  end if;
  if clean_note is not null and char_length(clean_note) > 140 then
    raise exception 'Keep the note to 140 characters.';
  end if;
  -- The spendable balance only: not bones_earned_total.
  update public.profiles p
    set bones_balance = coalesce(p.bones_balance, 0) + p_bones
    where p.id = p_user
    returning p.bones_balance into balance;
  if not found then
    raise exception 'No such member.';
  end if;
  insert into public.admin_bones_grants (admin_id, user_id, bones, note)
    values (auth.uid(), p_user, p_bones, clean_note);
  -- "Hound sent you 250 Bones" (send-social-push 'bones_given'). A
  -- failed push never undoes the grant: social_notify swallows errors.
  perform public.social_notify(jsonb_build_object(
    'kind', 'bones_given',
    'from_user', auth.uid(),
    'to_user', p_user,
    'bones', p_bones,
    'challenge_id', null
  ));
  return balance;
end;
$$;

