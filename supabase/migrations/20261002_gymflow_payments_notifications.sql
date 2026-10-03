-- GymFlow V2: UPI payment intents / notification-ready records.
-- Uses the existing tenant-scoped gymflow_records table + RLS.

CREATE OR REPLACE FUNCTION public.gymflow_member_create_order(
  p_code text,
  p_order jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member jsonb;
  v_plan jsonb;
  v_gym_id text;
  v_member_id text;
  v_plan_id text;
  v_amount numeric;
  v_id text;
  v_order jsonb;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[0-9]{6}$' THEN
    RAISE EXCEPTION 'Invalid member access code';
  END IF;

  SELECT payload INTO v_member
  FROM public.gymflow_records
  WHERE record_type='members' AND payload->>'code'=p_code
  LIMIT 1;

  IF v_member IS NULL THEN RAISE EXCEPTION 'Member access code not found'; END IF;
  IF COALESCE(v_member->>'status','Active')='Blocked' THEN RAISE EXCEPTION 'Membership is blocked'; END IF;
  IF NULLIF(v_member->>'expiry','')::date < CURRENT_DATE THEN RAISE EXCEPTION 'Membership has expired'; END IF;

  v_gym_id := v_member->>'gymId';
  v_member_id := v_member->>'id';
  v_plan_id := p_order->>'planId';

  SELECT payload INTO v_plan
  FROM public.gymflow_records
  WHERE record_type='plans' AND gym_id=v_gym_id AND payload->>'id'=v_plan_id
  LIMIT 1;

  IF v_plan IS NULL THEN RAISE EXCEPTION 'Plan not found'; END IF;
  v_amount := (v_plan->>'price')::numeric;
  IF v_amount IS NULL OR v_amount < 0 THEN RAISE EXCEPTION 'Invalid plan amount'; END IF;
  IF (p_order->>'amount')::numeric IS DISTINCT FROM v_amount THEN
    RAISE EXCEPTION 'Payment amount does not match plan price';
  END IF;

  v_id := COALESCE(NULLIF(p_order->>'id',''), 'ORD-'||replace(gen_random_uuid()::text,'-',''));
  v_order := p_order
    || jsonb_build_object(
      'id',v_id,
      'gymId',v_gym_id,
      'memberId',v_member_id,
      'memberName',v_member->>'name',
      'planName',v_plan->>'name',
      'amount',v_amount,
      'status','Pending',
      'createdAt',now()
    );

  INSERT INTO public.gymflow_records(id,gym_id,record_type,payload)
  VALUES(v_id,v_gym_id,'orders',v_order)
  ON CONFLICT(id) DO NOTHING;

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gymflow_member_create_order(text,jsonb) TO anon, authenticated;
