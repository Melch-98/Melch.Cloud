-- ═══════════════════════════════════════════════════════════════
-- Feature Requests + Voting System
-- Run this in the Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

-- 1. Feature Requests table
CREATE TABLE IF NOT EXISTS feature_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',          -- open | planned | in_progress | shipped | declined
  category TEXT NOT NULL DEFAULT 'general',      -- general | analytics | calendar | upload | integrations | ui
  submitted_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  submitted_by_email TEXT,
  submitted_by_role TEXT,
  brand_id UUID REFERENCES brands(id) ON DELETE SET NULL,
  admin_note TEXT,                               -- admin can leave a note on the request
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Feature Votes table (one vote per user per request)
CREATE TABLE IF NOT EXISTS feature_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id UUID NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vote SMALLINT NOT NULL DEFAULT 1,              -- 1 = upvote, -1 = downvote
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(feature_id, user_id)                    -- one vote per user per feature
);

-- 3. RLS
ALTER TABLE feature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_votes ENABLE ROW LEVEL SECURITY;

-- Feature requests: all authenticated users can read
CREATE POLICY "Anyone can read feature requests" ON feature_requests
  FOR SELECT USING (auth.role() = 'authenticated');

-- Feature requests: authenticated users can insert their own
CREATE POLICY "Users can submit feature requests" ON feature_requests
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND submitted_by = auth.uid()
  );

-- Feature requests: admin can update (status, admin_note)
CREATE POLICY "Admin can update feature requests" ON feature_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role = 'admin'
    )
  );

-- Feature requests: admin can delete
CREATE POLICY "Admin can delete feature requests" ON feature_requests
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role = 'admin'
    )
  );

-- Votes: all authenticated users can read
CREATE POLICY "Anyone can read votes" ON feature_votes
  FOR SELECT USING (auth.role() = 'authenticated');

-- Votes: users can insert their own vote
CREATE POLICY "Users can vote" ON feature_votes
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' AND user_id = auth.uid()
  );

-- Votes: users can update their own vote (change up/down)
CREATE POLICY "Users can update own vote" ON feature_votes
  FOR UPDATE USING (user_id = auth.uid());

-- Votes: users can delete their own vote (un-vote)
CREATE POLICY "Users can remove own vote" ON feature_votes
  FOR DELETE USING (user_id = auth.uid());

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_feature_requests_status ON feature_requests(status);
CREATE INDEX IF NOT EXISTS idx_feature_requests_category ON feature_requests(category);
CREATE INDEX IF NOT EXISTS idx_feature_requests_submitted_by ON feature_requests(submitted_by);
CREATE INDEX IF NOT EXISTS idx_feature_votes_feature ON feature_votes(feature_id);
CREATE INDEX IF NOT EXISTS idx_feature_votes_user ON feature_votes(user_id);

-- 5. Vote count view (for easy querying)
CREATE OR REPLACE VIEW feature_request_scores AS
SELECT
  fr.*,
  COALESCE(SUM(fv.vote), 0) AS score,
  COUNT(CASE WHEN fv.vote = 1 THEN 1 END) AS upvotes,
  COUNT(CASE WHEN fv.vote = -1 THEN 1 END) AS downvotes
FROM feature_requests fr
LEFT JOIN feature_votes fv ON fv.feature_id = fr.id
GROUP BY fr.id;
