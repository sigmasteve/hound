-- 0094: index the foreign keys that point at profiles and challenges.
--
-- Postgres does not index a foreign key's own column. Without an index,
-- deleting a profile or a challenge (delete-my-account, admin delete, a
-- cascade) has to scan every referencing table in full, and RLS checks
-- that filter on these columns do the same. A check on production and on
-- staging listed 39 foreign keys with no index; this adds the 33 that
-- reference the two tables rows actually get deleted from.
--
-- Left out on purpose: bones_purchases.product_id, cosmetic_purchases.item_id,
-- profiles.equipped_background_id / _frame_id / _icon_id and
-- user_achievements.achievement_id. They point at small catalogue tables
-- that are never deleted from, so an index there only slows writes.
--
-- Safe to re-run. The tables involved are small, so each index builds in
-- well under a second.

create index if not exists idx_activity_events_challenge_id on public.activity_events (challenge_id);
create index if not exists idx_alert_deliveries_challenge_id on public.alert_deliveries (challenge_id);
create index if not exists idx_alert_deliveries_recipient_id on public.alert_deliveries (recipient_id);
create index if not exists idx_bingo_progress_user_id on public.bingo_progress (user_id);
create index if not exists idx_bones_purchases_user_id on public.bones_purchases (user_id);
create index if not exists idx_challenge_bots_challenge_id on public.challenge_bots (challenge_id);
create index if not exists idx_challenge_invites_inviter_id on public.challenge_invites (inviter_id);
create index if not exists idx_challenge_message_reports_reporter_id on public.challenge_message_reports (reporter_id);
create index if not exists idx_challenge_reactions_from_user on public.challenge_reactions (from_user);
create index if not exists idx_challenge_reactions_to_user on public.challenge_reactions (to_user);
create index if not exists idx_challenges_created_by on public.challenges (created_by);
create index if not exists idx_challenges_organization_id on public.challenges (organization_id);
create index if not exists idx_kudos_receiver_id on public.kudos (receiver_id);
create index if not exists idx_nudges_challenge_id on public.nudges (challenge_id);
create index if not exists idx_organizations_created_by on public.organizations (created_by);
create index if not exists idx_profiles_organization_id on public.profiles (organization_id);
create index if not exists idx_progress_snapshots_user_id on public.progress_snapshots (user_id);
create index if not exists idx_reaction_pushes_from_user on public.reaction_pushes (from_user);
create index if not exists idx_reaction_pushes_to_user on public.reaction_pushes (to_user);
create index if not exists idx_seventyfive_checkins_user_id on public.seventyfive_checkins (user_id);
create index if not exists idx_stale_data_alerts_sent_stale_user_id on public.stale_data_alerts_sent (stale_user_id);
create index if not exists idx_tag_events_challenge_id on public.tag_events (challenge_id);
create index if not exists idx_tag_events_tagged_id on public.tag_events (tagged_id);
create index if not exists idx_tag_events_tagger_id on public.tag_events (tagger_id);
create index if not exists idx_tag_rounds_it_user_id on public.tag_rounds (it_user_id);
create index if not exists idx_tag_rounds_target_user_id on public.tag_rounds (target_user_id);
create index if not exists idx_tictacgo_games_o_user_id on public.tictacgo_games (o_user_id);
create index if not exists idx_tictacgo_games_turn_user_id on public.tictacgo_games (turn_user_id);
create index if not exists idx_tictacgo_games_winner_user_id on public.tictacgo_games (winner_user_id);
create index if not exists idx_tictacgo_games_x_user_id on public.tictacgo_games (x_user_id);
create index if not exists idx_trash_talk_challenge_mutes_user_id on public.trash_talk_challenge_mutes (user_id);
create index if not exists idx_trash_talk_mutes_muted_user_id on public.trash_talk_mutes (muted_user_id);
create index if not exists idx_trash_talk_pushes_user_id on public.trash_talk_pushes (user_id);
