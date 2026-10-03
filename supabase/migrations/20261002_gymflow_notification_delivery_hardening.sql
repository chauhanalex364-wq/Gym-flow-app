create unique index if not exists uq_gymflow_daily_member_notification_slot
on public.gymflow_notifications(recipient_member_id,kind,(data->>'dayKey'))
where recipient_member_id is not null and kind in ('daily_morning','daily_evening');

create index if not exists idx_gymflow_notifications_delivery
on public.gymflow_notifications(kind,scheduled_for,published_at);

create index if not exists idx_gymflow_push_active_member
on public.gymflow_push_subscriptions(gym_id,member_id,active);

create index if not exists idx_gymflow_push_active_owner
on public.gymflow_push_subscriptions(gym_id,owner_user_id,active);
