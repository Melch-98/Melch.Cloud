-- Calendar Events table for manual marketing comms
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/txetdixzcftzetqiuzan/sql

CREATE TABLE IF NOT EXISTS public.calendar_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'Other',
  event_date DATE NOT NULL,
  brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Allow service role full access
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Service role has full access to calendar_events"
  ON public.calendar_events
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Index for fast date range queries
CREATE INDEX idx_calendar_events_date ON public.calendar_events(event_date);
CREATE INDEX idx_calendar_events_brand ON public.calendar_events(brand_id);
