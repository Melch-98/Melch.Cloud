-- Supabase Schema for Creative Management System

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- CUSTOM TYPES (ENUMS)
-- ============================================================================

CREATE TYPE creative_type AS ENUM ('ugc', 'static', 'video', 'carousel', 'flexible', 'other');

CREATE TYPE file_status AS ENUM ('pending', 'in_review', 'approved', 'scheduled', 'live', 'paused', 'killed');

CREATE TYPE user_role AS ENUM ('admin', 'strategist', 'user');

-- ============================================================================
-- TABLES
-- ============================================================================

-- Brands table
CREATE TABLE brands (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  -- Shopify custom app integration (Dev Dashboard — client credentials grant)
  shopify_store_domain text,          -- e.g. 'my-store.myshopify.com'
  shopify_client_id text,             -- App client ID from Dev Dashboard
  shopify_client_secret text,         -- App client secret from Dev Dashboard
  shopify_gross_margin_pct numeric DEFAULT 62, -- Default gross margin for P&L calc
  created_at timestamptz DEFAULT now()
);

-- Users Profile table
CREATE TABLE users_profile (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  role user_role DEFAULT 'user',
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Submissions table
CREATE TABLE submissions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_name text NOT NULL,
  creative_type creative_type NOT NULL DEFAULT 'other',
  creator_name text NOT NULL,
  landing_page_url text DEFAULT '',
  copy_headline text DEFAULT '',
  copy_body text DEFAULT '',
  copy_cta text DEFAULT '',
  copy_title text DEFAULT '',
  notes text DEFAULT '',
  status file_status DEFAULT 'pending',
  is_carousel boolean DEFAULT false,
  is_flexible boolean DEFAULT false,
  is_whitelist boolean DEFAULT false,
  creator_social_handle text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT not_both_carousel_and_flexible CHECK (NOT (is_carousel AND is_flexible))
);

-- Submission Files table
CREATE TABLE submission_files (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size bigint NOT NULL,
  file_url text NOT NULL,
  status file_status DEFAULT 'pending',
  media_format text,
  aspect_ratio text,
  width integer,
  height integer,
  copy_headline text,
  copy_body text,
  copy_cta text,
  landing_page_url text,
  copy_title text,
  launch_date date,
  launch_time time,
  ad_name text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Status Log table
CREATE TABLE status_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id uuid NOT NULL REFERENCES submission_files(id) ON DELETE CASCADE,
  old_status file_status,
  new_status file_status NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz DEFAULT now()
);

-- ============================================================================
-- VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW file_tracker AS
SELECT
  sf.id,
  sf.file_name,
  sf.file_type,
  sf.file_size,
  sf.file_url,
  s.batch_name,
  b.name AS brand_name,
  b.id AS brand_id,
  s.creator_name,
  s.creative_type::text,
  COALESCE(sf.landing_page_url, s.landing_page_url) AS landing_page_url,
  COALESCE(sf.copy_headline, s.copy_headline) AS copy_headline,
  COALESCE(sf.copy_body, s.copy_body) AS copy_body,
  COALESCE(sf.copy_cta, s.copy_cta) AS copy_cta,
  COALESCE(sf.copy_title, s.copy_title) AS copy_title,
  sf.status,
  sf.media_format,
  sf.aspect_ratio,
  sf.width,
  sf.height,
  s.is_carousel,
  s.is_flexible,
  s.is_whitelist,
  s.creator_social_handle,
  sf.launch_date,
  sf.launch_time,
  sf.ad_name,
  sf.notes,
  sf.created_at AS submitted_at,
  s.id AS submission_id
FROM submission_files sf
JOIN submissions s ON sf.submission_id = s.id
JOIN brands b ON s.brand_id = b.id;

-- ============================================================================
-- TRIGGER FUNCTIONS
-- ============================================================================

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for submissions table
CREATE TRIGGER update_submissions_updated_at
BEFORE UPDATE ON submissions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger for submission_files table
CREATE TRIGGER update_submission_files_updated_at
BEFORE UPDATE ON submission_files
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Function to log status changes
CREATE OR REPLACE FUNCTION log_submission_file_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO status_log (file_id, old_status, new_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for status change logging
CREATE TRIGGER log_submission_file_status
AFTER UPDATE ON submission_files
FOR EACH ROW
EXECUTE FUNCTION log_submission_file_status_change();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE users_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_log ENABLE ROW LEVEL SECURITY;

-- Brands policies
CREATE POLICY "Authenticated users can read all brands"
ON brands FOR SELECT
TO authenticated
USING (true);

-- Users Profile policies
CREATE POLICY "Users can read own profile"
ON users_profile FOR SELECT
TO authenticated
USING (auth.uid() = id);

CREATE POLICY "Admins can read all profiles"
ON users_profile FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- Submissions policies
CREATE POLICY "Users can insert submissions for their brand"
ON submissions FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid() AND
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid() AND brand_id = submissions.brand_id
  )
);

CREATE POLICY "Users can read submissions from their brand"
ON submissions FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid() AND brand_id = submissions.brand_id
  )
);

CREATE POLICY "Admins can read all submissions"
ON submissions FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Admins can update all submissions"
ON submissions FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid() AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- Submission Files policies
CREATE POLICY "Users can insert files for their brand's submissions"
ON submission_files FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM submissions s
    JOIN users_profile up ON s.brand_id = up.brand_id
    WHERE s.id = submission_id AND up.id = auth.uid()
  )
);

CREATE POLICY "Users can read files from their brand's submissions"
ON submission_files FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM submissions s
    JOIN users_profile up ON s.brand_id = up.brand_id
    WHERE s.id = submission_id AND up.id = auth.uid()
  )
);

CREATE POLICY "Admins can read all submission files"
ON submission_files FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Admins can update all submission files"
ON submission_files FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid() AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- Status Log policies
CREATE POLICY "Admins can read all status logs"
ON status_log FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Users can read status logs for their brand"
ON status_log FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM submission_files sf
    JOIN submissions s ON sf.submission_id = s.id
    JOIN users_profile up ON s.brand_id = up.brand_id
    WHERE sf.id = status_log.file_id AND up.id = auth.uid()
  )
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_submissions_brand_id ON submissions(brand_id);
CREATE INDEX idx_submissions_user_id ON submissions(user_id);
CREATE INDEX idx_submission_files_submission_id ON submission_files(submission_id);
CREATE INDEX idx_submission_files_status ON submission_files(status);
CREATE INDEX idx_status_log_file_id ON status_log(file_id);

-- ============================================================================
-- STORAGE BUCKET (Creatives)
-- ============================================================================

-- Note: Storage bucket creation is handled through Supabase Dashboard or via separate storage API call
-- The bucket 'creatives' should be created with public access disabled (private bucket)
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('creatives', 'creatives', false);
