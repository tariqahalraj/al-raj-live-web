-- Migration: 20260925000003_multi_host_session_lifecycle.sql
-- Fix: Prevent multi-host session collisions and ensure clean session handover when roles change

CREATE OR REPLACE FUNCTION public.start_host_session(p_title TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_session RECORD;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated';
    END IF;

    IF NOT public.has_role(v_user_id, 'HOST') AND NOT public.has_role(v_user_id, 'ADMIN') THEN
        RAISE EXCEPTION 'Unauthorized: User is not an authorized HOST';
    END IF;

    -- Take advisory lock to prevent race condition during session initialization
    PERFORM pg_advisory_xact_lock(742198);

    -- End any existing active sessions from any host to ensure single active channel
    UPDATE public.live_sessions
    SET state = 'ENDED',
        ended_at = NOW()
    WHERE state IN ('STARTING', 'LIVE', 'ENDING');

    -- Clean stale presence leases
    DELETE FROM public.presence_leases
    WHERE session_id IN (
        SELECT id FROM public.live_sessions WHERE state = 'ENDED'
    );

    -- Insert new session with 60s startup deadline
    INSERT INTO public.live_sessions (
        host_id,
        title,
        state,
        media_generation,
        startup_deadline_at
    ) VALUES (
        v_user_id,
        COALESCE(NULLIF(TRIM(p_title), ''), 'Zikr Session'),
        'STARTING',
        1,
        NOW() + INTERVAL '60 seconds'
    )
    RETURNING * INTO v_session;

    -- Audit log
    INSERT INTO public.audit_logs (user_id, session_id, operation, details)
    VALUES (v_user_id, v_session.id, 'START_HOST_SESSION', jsonb_build_object('title', v_session.title));

    RETURN to_jsonb(v_session);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_initial_publish(
    p_session_id UUID,
    p_cf_session_id TEXT,
    p_cf_track_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_session RECORD;
BEGIN
    PERFORM pg_advisory_xact_lock(742198);

    SELECT * INTO v_session FROM public.live_sessions 
    WHERE id = p_session_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF v_session.host_id != v_user_id AND NOT public.has_role(v_user_id, 'ADMIN') THEN
        RAISE EXCEPTION 'Unauthorized host';
    END IF;

    IF v_session.state NOT IN ('STARTING', 'LIVE') THEN
        RAISE EXCEPTION 'Session cannot be confirmed: not in STARTING or LIVE state';
    END IF;

    -- End any other sessions that might linger
    UPDATE public.live_sessions
    SET state = 'ENDED',
        ended_at = NOW()
    WHERE id != p_session_id AND state IN ('STARTING', 'LIVE', 'ENDING');

    UPDATE public.live_sessions
    SET state = 'LIVE',
        cloudflare_session_id = p_cf_session_id,
        cloudflare_track_id = p_cf_track_id,
        started_at = COALESCE(started_at, NOW()),
        startup_deadline_at = NULL
    WHERE id = p_session_id
    RETURNING * INTO v_session;

    INSERT INTO public.audit_logs (user_id, session_id, operation, details)
    VALUES (v_user_id, p_session_id, 'CONFIRM_INITIAL_PUBLISH', 
        jsonb_build_object('track_id', p_cf_track_id, 'generation', v_session.media_generation));

    RETURN to_jsonb(v_session);
END;
$$;
