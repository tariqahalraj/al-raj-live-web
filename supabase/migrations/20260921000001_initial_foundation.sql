-- ============================================================
-- TARIQAH AL-RAJ: FOUNDATION MIGRATION (B1, B2, B3, B7)
-- ============================================================

-- 0. CLEANUP ANY PREVIOUS SCHEMA (Wipe completely if already present)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.start_host_session(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.confirm_initial_publish(UUID, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.advance_media_generation(UUID, INTEGER, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.end_host_session(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.finalize_host_session(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.renew_host_lease(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.has_role(UUID, app_role) CASCADE;

DROP TABLE IF EXISTS public.presence_leases CASCADE;
DROP TABLE IF EXISTS public.live_sessions CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

DROP TYPE IF EXISTS session_lifecycle_state CASCADE;
DROP TYPE IF EXISTS app_role CASCADE;

-- 1. ENUMS
DO $$ BEGIN
    CREATE TYPE app_role AS ENUM ('USER', 'HOST', 'ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE session_lifecycle_state AS ENUM ('STARTING', 'LIVE', 'ENDING', 'ENDED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. PROFILES TABLE (Includes user role)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    avatar_url TEXT,
    role app_role NOT NULL DEFAULT 'USER',
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 3. LIVE SESSIONS TABLE
CREATE TABLE IF NOT EXISTS public.live_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Zikr Session',
    state session_lifecycle_state NOT NULL DEFAULT 'STARTING',
    media_generation INTEGER NOT NULL DEFAULT 1 CHECK (media_generation > 0),
    cloudflare_session_id TEXT,
    cloudflare_track_id TEXT,
    startup_deadline_at TIMESTAMPTZ,
    ending_started_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ
);

-- INVARIANT: Exactly ONE active session (STARTING or LIVE) permitted
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_live_session 
ON public.live_sessions ((1)) 
WHERE (state IN ('STARTING', 'LIVE'));

-- 5. PRESENCE LEASES TABLE
CREATE TABLE IF NOT EXISTS public.presence_leases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.live_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    presence_instance_id TEXT NOT NULL,
    role app_role NOT NULL DEFAULT 'USER',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT unique_presence_instance UNIQUE (session_id, user_id, presence_instance_id)
);

CREATE INDEX IF NOT EXISTS idx_presence_leases_active 
ON public.presence_leases (session_id, expires_at);

-- 6. AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    session_id UUID REFERENCES public.live_sessions(id) ON DELETE SET NULL,
    operation TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Profiles: Public read, self update
CREATE POLICY "Public profiles are viewable by everyone" 
ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" 
ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Live Sessions: Read active sessions for everyone (including guest listeners)
CREATE POLICY "Live sessions viewable by everyone" 
ON public.live_sessions FOR SELECT USING (true);

-- Presence Leases: View active leases
CREATE POLICY "Presence leases viewable by authenticated" 
ON public.presence_leases FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can manage own presence lease" 
ON public.presence_leases FOR ALL TO authenticated 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

-- Audit Logs: Viewable only by admin
CREATE POLICY "Audit logs viewable by admin" 
ON public.audit_logs FOR SELECT TO authenticated 
USING (EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'ADMIN'
));

-- ============================================================
-- AUTHORITATIVE LIFECYCLE RPCS (SECURITY DEFINER)
-- ============================================================

-- Helper: Check role from profiles table
CREATE OR REPLACE FUNCTION public.has_role(p_user_id UUID, p_role app_role)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = p_user_id AND role = p_role
    );
$$;

-- 1. Start Host Session (STARTING state)
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

-- 2. Confirm Initial Publication (STARTING -> LIVE)
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

    IF v_session.state != 'STARTING' THEN
        RAISE EXCEPTION 'Session cannot be confirmed: not in STARTING state';
    END IF;

    UPDATE public.live_sessions
    SET state = 'LIVE',
        cloudflare_session_id = p_cf_session_id,
        cloudflare_track_id = p_cf_track_id,
        started_at = NOW(),
        startup_deadline_at = NULL
    WHERE id = p_session_id
    RETURNING * INTO v_session;

    INSERT INTO public.audit_logs (user_id, session_id, operation, details)
    VALUES (v_user_id, p_session_id, 'CONFIRM_INITIAL_PUBLISH', 
        jsonb_build_object('track_id', p_cf_track_id, 'generation', v_session.media_generation));

    RETURN to_jsonb(v_session);
END;
$$;

-- 3. Advance Media Generation (CAS increment for Hard Reset)
CREATE OR REPLACE FUNCTION public.advance_media_generation(
    p_session_id UUID,
    p_expected_generation INTEGER,
    p_new_cf_session_id TEXT,
    p_new_cf_track_id TEXT
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

    IF v_session.state != 'LIVE' THEN
        RAISE EXCEPTION 'Cannot advance generation: session not LIVE';
    END IF;

    -- Strict CAS verification
    IF v_session.media_generation != p_expected_generation THEN
        RAISE EXCEPTION 'CAS Generation mismatch: expected %, actual %', 
            p_expected_generation, v_session.media_generation;
    END IF;

    UPDATE public.live_sessions
    SET media_generation = media_generation + 1,
        cloudflare_session_id = p_new_cf_session_id,
        cloudflare_track_id = p_new_cf_track_id
    WHERE id = p_session_id
    RETURNING * INTO v_session;

    INSERT INTO public.audit_logs (user_id, session_id, operation, details)
    VALUES (v_user_id, p_session_id, 'ADVANCE_MEDIA_GENERATION', 
        jsonb_build_object('old_gen', p_expected_generation, 'new_gen', v_session.media_generation));

    RETURN to_jsonb(v_session);
END;
$$;

-- 4. End Host Session (LIVE -> ENDING)
CREATE OR REPLACE FUNCTION public.end_host_session(p_session_id UUID)
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
        RAISE EXCEPTION 'Session cannot be ended from %', v_session.state;
    END IF;

    UPDATE public.live_sessions
    SET state = 'ENDING',
        ending_started_at = NOW()
    WHERE id = p_session_id
    RETURNING * INTO v_session;

    INSERT INTO public.audit_logs (user_id, session_id, operation, details)
    VALUES (v_user_id, p_session_id, 'END_HOST_SESSION', jsonb_build_object('state', 'ENDING'));

    RETURN to_jsonb(v_session);
END;
$$;

-- 5. Finalize Host Session (ENDING -> ENDED)
CREATE OR REPLACE FUNCTION public.finalize_host_session(p_session_id UUID)
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

    UPDATE public.live_sessions
    SET state = 'ENDED',
        ended_at = NOW()
    WHERE id = p_session_id
    RETURNING * INTO v_session;

    -- Clean presence leases for this session
    DELETE FROM public.presence_leases WHERE session_id = p_session_id;

    INSERT INTO public.audit_logs (user_id, session_id, operation, details)
    VALUES (v_user_id, p_session_id, 'FINALIZE_HOST_SESSION', jsonb_build_object('state', 'ENDED'));

    RETURN to_jsonb(v_session);
END;
$$;

-- 6. Renew Host Lease (Heartbeat: 45s TTL renewed every 15s)
CREATE OR REPLACE FUNCTION public.renew_host_lease(target_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_session RECORD;
BEGIN
    SELECT * INTO v_session FROM public.live_sessions 
    WHERE id = target_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found';
    END IF;

    IF v_session.host_id != v_user_id AND NOT public.has_role(v_user_id, 'ADMIN') THEN
        RAISE EXCEPTION 'Unauthorized host';
    END IF;

    -- Renew presence lease in presence_leases
    INSERT INTO public.presence_leases (session_id, user_id, presence_instance_id, role, expires_at)
    VALUES (target_session_id, v_user_id, 'host-primary', 'HOST', NOW() + INTERVAL '45 seconds')
    ON CONFLICT (session_id, user_id, presence_instance_id)
    DO UPDATE SET expires_at = NOW() + INTERVAL '45 seconds';

    RETURN jsonb_build_object('success', true, 'expires_at', NOW() + INTERVAL '45 seconds');
END;
$$;

-- 7. Trigger on new auth user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, avatar_url, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'Guest Member'),
        NEW.raw_user_meta_data->>'avatar_url',
        'USER'
    )
    ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        avatar_url = EXCLUDED.avatar_url;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- SUPABASE REALTIME PUBLICATION
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.presence_leases;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
