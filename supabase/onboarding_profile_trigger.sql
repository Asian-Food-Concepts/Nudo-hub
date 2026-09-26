-- =====================================================================
-- Nudo Hub — Onboarding to Profiles activation trigger
-- =====================================================================
-- When an onboarding row reaches current_step = 4 (completed pipeline),
-- automatically create or update public.profiles for the existing auth user.
--
-- WHERE: Postgres trigger on public.onboarding (activation cannot be skipped by any client).
--
-- 1. Create public.profiles with id = onboarding.auth_user_id.
--    The auth user already exists — do NOT create a new auth user.
-- 2. Copy nombres, apellido_paterno, apellido_materno, email, and phone
--    from movil. name = nombres. full_name = the three name parts joined.
-- 3. short_name = the MASKED form, built with the existing SQL
--    build_short_name() helper. Does NOT reimplement the masking.
-- 4. role and branch are set by a HUMAN, never inferred. Left NULL if
--    not present on the onboarding row — NEVER guess a role.
--    area and level are assigned by the existing sync_profile_level trigger
--    once role is set.
-- 5. active = true.
-- 6. IDEMPOTENT: if a profiles row already exists for that auth_user_id,
--    UPDATE the name fields and do NOT create a duplicate, and do NOT
--    overwrite role, branch, level, or active.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_onboarding_profile_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_full_name text;
    v_short_name text;
    v_nombres text;
    v_paterno text;
    v_materno text;
    v_email text;
    v_phone text;
BEGIN
    -- Only activate once current_step reaches 4 and an auth_user_id exists
    IF NEW.auth_user_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.current_step IS NULL OR NEW.current_step < 4 THEN
        RETURN NEW;
    END IF;

    v_nombres := NULLIF(TRIM(NEW.nombres), '');
    v_paterno := NULLIF(TRIM(NEW.apellido_paterno), '');
    v_materno := NULLIF(TRIM(NEW.apellido_materno), '');
    v_email   := LOWER(NULLIF(TRIM(NEW.email), ''));
    v_phone   := NULLIF(TRIM(NEW.movil), '');

    -- full_name = the three name parts joined
    v_full_name := TRIM(CONCAT_WS(' ', v_nombres, v_paterno, v_materno));
    IF v_full_name = '' THEN
        v_full_name := NULL;
    END IF;

    -- short_name = the MASKED form built with existing SQL build_short_name() helper
    IF v_full_name IS NOT NULL THEN
        v_short_name := public.build_short_name(v_full_name);
    ELSE
        v_short_name := NULL;
    END IF;

    -- Upsert into public.profiles:
    -- id = onboarding.auth_user_id
    -- role and branch = NULL (set by human, never inferred)
    -- active = true
    -- ON CONFLICT: update name fields, full_name, short_name, email, phone.
    -- DO NOT overwrite role, branch, level, area, or active.
    INSERT INTO public.profiles (
        id,
        nombres,
        apellido_paterno,
        apellido_materno,
        name,
        full_name,
        short_name,
        email,
        phone,
        role,
        branch,
        active
    ) VALUES (
        NEW.auth_user_id,
        v_nombres,
        v_paterno,
        v_materno,
        COALESCE(v_nombres, v_full_name),
        v_full_name,
        v_short_name,
        v_email,
        v_phone,
        NULL,
        NULL,
        true
    )
    ON CONFLICT (id) DO UPDATE SET
        nombres          = EXCLUDED.nombres,
        apellido_paterno = EXCLUDED.apellido_paterno,
        apellido_materno = EXCLUDED.apellido_materno,
        name             = EXCLUDED.name,
        full_name        = EXCLUDED.full_name,
        short_name       = EXCLUDED.short_name,
        email            = COALESCE(EXCLUDED.email, public.profiles.email),
        phone            = COALESCE(EXCLUDED.phone, public.profiles.phone),
        updated_at       = now();

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_onboarding_profile_activation failed for onboarding id %, auth_user_id %: %',
        NEW.id, NEW.auth_user_id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_onboarding_profile_activation ON public.onboarding;

CREATE TRIGGER trg_onboarding_profile_activation
    AFTER INSERT OR UPDATE ON public.onboarding
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_onboarding_profile_activation();

-- Standalone idempotent helper callable directly by ID or script
CREATE OR REPLACE FUNCTION public.activate_onboarding_profile(p_onboarding_id uuid)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_onb public.onboarding%ROWTYPE;
    v_prof public.profiles%ROWTYPE;
    v_full_name text;
    v_short_name text;
    v_nombres text;
    v_paterno text;
    v_materno text;
    v_email text;
    v_phone text;
BEGIN
    SELECT * INTO v_onb FROM public.onboarding WHERE id = p_onboarding_id;
    IF NOT FOUND OR v_onb.auth_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    v_nombres := NULLIF(TRIM(v_onb.nombres), '');
    v_paterno := NULLIF(TRIM(v_onb.apellido_paterno), '');
    v_materno := NULLIF(TRIM(v_onb.apellido_materno), '');
    v_email   := LOWER(NULLIF(TRIM(v_onb.email), ''));
    v_phone   := NULLIF(TRIM(v_onb.movil), '');

    v_full_name := TRIM(CONCAT_WS(' ', v_nombres, v_paterno, v_materno));
    IF v_full_name = '' THEN
        v_full_name := NULL;
    END IF;

    IF v_full_name IS NOT NULL THEN
        v_short_name := public.build_short_name(v_full_name);
    ELSE
        v_short_name := NULL;
    END IF;

    INSERT INTO public.profiles (
        id,
        nombres,
        apellido_paterno,
        apellido_materno,
        name,
        full_name,
        short_name,
        email,
        phone,
        role,
        branch,
        active
    ) VALUES (
        v_onb.auth_user_id,
        v_nombres,
        v_paterno,
        v_materno,
        COALESCE(v_nombres, v_full_name),
        v_full_name,
        v_short_name,
        v_email,
        v_phone,
        NULL,
        NULL,
        true
    )
    ON CONFLICT (id) DO UPDATE SET
        nombres          = EXCLUDED.nombres,
        apellido_paterno = EXCLUDED.apellido_paterno,
        apellido_materno = EXCLUDED.apellido_materno,
        name             = EXCLUDED.name,
        full_name        = EXCLUDED.full_name,
        short_name       = EXCLUDED.short_name,
        email            = COALESCE(EXCLUDED.email, public.profiles.email),
        phone            = COALESCE(EXCLUDED.phone, public.profiles.phone),
        updated_at       = now()
    RETURNING * INTO v_prof;

    RETURN v_prof;
END;
$$;
