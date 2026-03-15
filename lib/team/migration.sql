-- Supabase Migration: Team Queue Tables
-- Run this in Supabase SQL Editor

-- Teams table
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  invite_code text UNIQUE NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- Team members table
CREATE TABLE team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz DEFAULT now(),
  UNIQUE(team_id, user_id)
);

-- Pool cards table
CREATE TABLE pool_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  solution_summary text,
  test_scenarios text,
  ai_opinion text,
  ai_verdict text,
  status text NOT NULL DEFAULT 'backlog',
  complexity text DEFAULT 'medium',
  priority text DEFAULT 'medium',
  assigned_to uuid REFERENCES auth.users(id),
  pushed_by uuid NOT NULL REFERENCES auth.users(id),
  source_card_id text,
  last_synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  pulled_by uuid REFERENCES auth.users(id)
);

-- Indexes
CREATE INDEX idx_team_members_user_id ON team_members(user_id);
CREATE INDEX idx_team_members_team_id ON team_members(team_id);
CREATE INDEX idx_pool_cards_team_id ON pool_cards(team_id);
CREATE INDEX idx_pool_cards_assigned_to ON pool_cards(assigned_to);
CREATE INDEX idx_pool_cards_pulled_by ON pool_cards(pulled_by);
CREATE INDEX idx_pool_cards_source_card_id ON pool_cards(source_card_id);
CREATE INDEX idx_teams_invite_code ON teams(invite_code);

-- RLS Policies
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_cards ENABLE ROW LEVEL SECURITY;

-- Teams: users can see teams they belong to
CREATE POLICY "Users can view their teams" ON teams
  FOR SELECT USING (
    id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

-- Teams: any authenticated user can create
CREATE POLICY "Authenticated users can create teams" ON teams
  FOR INSERT WITH CHECK (auth.uid() = created_by);

-- Team members: users can see members of teams they belong to
CREATE POLICY "Users can view team members" ON team_members
  FOR SELECT USING (
    team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

-- Team members: authenticated users can insert (join)
CREATE POLICY "Authenticated users can join teams" ON team_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Team members: users can delete their own membership
CREATE POLICY "Users can leave teams" ON team_members
  FOR DELETE USING (auth.uid() = user_id);

-- Pool cards: users can view pool cards of their team
CREATE POLICY "Users can view team pool cards" ON pool_cards
  FOR SELECT USING (
    team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

-- Pool cards: users can insert to their team
CREATE POLICY "Users can create pool cards" ON pool_cards
  FOR INSERT WITH CHECK (
    team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

-- Pool cards: users can update pool cards in their team
CREATE POLICY "Users can update team pool cards" ON pool_cards
  FOR UPDATE USING (
    team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

-- ============================================
-- Migration: Add pulled_by column (run this if pool_cards table already exists)
-- ============================================
-- ALTER TABLE pool_cards ADD COLUMN pulled_by uuid REFERENCES auth.users(id);
-- CREATE INDEX idx_pool_cards_pulled_by ON pool_cards(pulled_by);

-- ============================================
-- Notifications table
-- ============================================
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'assignment',
  title text NOT NULL,
  message text,
  reference_id text,
  actor_user_id uuid REFERENCES auth.users(id),
  actor_name text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_user_id);
CREATE INDEX idx_notifications_team ON notifications(team_id);
CREATE INDEX idx_notifications_is_read ON notifications(recipient_user_id, is_read);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY "Users can view own notifications" ON notifications
  FOR SELECT USING (auth.uid() = recipient_user_id);

-- Users can update (mark as read) their own notifications
CREATE POLICY "Users can update own notifications" ON notifications
  FOR UPDATE USING (auth.uid() = recipient_user_id);

-- Team members can insert notifications for others in their team
CREATE POLICY "Team members can create notifications" ON notifications
  FOR INSERT WITH CHECK (
    team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

-- Pool cards: users can delete pool cards they pushed or as team owner/admin
CREATE POLICY "Users can delete own pool cards" ON pool_cards
  FOR DELETE USING (
    pushed_by = auth.uid() OR
    team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
  );

-- ============================================
-- Migration: Update pool_cards DELETE policy for admin role
-- Run this if the policy already exists:
-- ============================================
-- DROP POLICY IF EXISTS "Users can delete own pool cards" ON pool_cards;
-- CREATE POLICY "Users can delete own pool cards" ON pool_cards
--   FOR DELETE USING (
--     pushed_by = auth.uid() OR
--     team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
--   );

-- ============================================
-- Migration: Allow team owners to update member roles
-- ============================================
-- CREATE POLICY "Owners can update team members" ON team_members
--   FOR UPDATE USING (
--     team_id IN (SELECT tm.team_id FROM team_members tm WHERE tm.user_id = auth.uid() AND tm.role = 'owner')
--   );
