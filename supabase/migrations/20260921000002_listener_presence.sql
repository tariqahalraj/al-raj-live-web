-- Listener presence heartbeat lease
CREATE OR REPLACE FUNCTION public.renew_listener_lease(
    p_session_id UUID,
    p_instance_id TEXT DEFAULT 'listener-default'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'reason', 'unauthenticated');
    END IF;

    INSERT INTO public.presence_leases (session_id, user_id, presence_instance_id, role, expires_at)
    VALUES (p_session_id, v_user_id, p_instance_id, 'USER', NOW() + INTERVAL '90 seconds')
    ON CONFLICT (session_id, user_id, presence_instance_id)
    DO UPDATE SET expires_at = NOW() + INTERVAL '90 seconds';

    RETURN jsonb_build_object('success', true);
END;
$$;

-- Function to get active session listeners with their profile details
CREATE OR REPLACE FUNCTION public.get_active_session_listeners(p_session_id UUID)
RETURNS TABLE (
    id UUID,
    name TEXT,
    avatar_url TEXT,
    role app_role
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
    SELECT 
        pl.user_id AS id,
        COALESCE(p.full_name, 'Brother in Islam') AS name,
        p.avatar_url,
        pl.role
    FROM public.presence_leases pl
    LEFT JOIN public.profiles p ON pl.user_id = p.id
    WHERE pl.session_id = p_session_id
      AND pl.role = 'USER'
      AND pl.expires_at > NOW();
$$;

-- Function to remove a listener's lease when they leave
CREATE OR REPLACE FUNCTION public.leave_listener_lease(p_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NOT NULL THEN
        DELETE FROM public.presence_leases 
        WHERE session_id = p_session_id AND user_id = v_user_id;
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.renew_listener_lease(UUID, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_active_session_listeners(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.leave_listener_lease(UUID) TO authenticated, anon;
