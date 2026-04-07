// ─── /api/feature-requests ──────────────────────────────────────
// GET  — list all feature requests with vote counts + user's vote
// POST — submit a new feature request

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const { auth, error, status } = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error }, { status: status || 401 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // Fetch all feature requests
  const { data: requests, error: reqErr } = await supabase
    .from('feature_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (reqErr) {
    return NextResponse.json({ error: reqErr.message }, { status: 500 });
  }

  // Fetch all votes
  const { data: votes } = await supabase
    .from('feature_votes')
    .select('feature_id, user_id, vote');

  // Build score map and user's vote map
  const scoreMap: Record<string, { score: number; upvotes: number; downvotes: number }> = {};
  const userVoteMap: Record<string, number> = {};

  for (const v of votes || []) {
    if (!scoreMap[v.feature_id]) {
      scoreMap[v.feature_id] = { score: 0, upvotes: 0, downvotes: 0 };
    }
    scoreMap[v.feature_id].score += v.vote;
    if (v.vote === 1) scoreMap[v.feature_id].upvotes++;
    if (v.vote === -1) scoreMap[v.feature_id].downvotes++;

    if (v.user_id === auth.user_id) {
      userVoteMap[v.feature_id] = v.vote;
    }
  }

  const enriched = (requests || []).map((r: any) => ({
    ...r,
    score: scoreMap[r.id]?.score || 0,
    upvotes: scoreMap[r.id]?.upvotes || 0,
    downvotes: scoreMap[r.id]?.downvotes || 0,
    user_vote: userVoteMap[r.id] || 0,
  }));

  return NextResponse.json({ requests: enriched });
}

export async function POST(request: NextRequest) {
  const { auth, error, status } = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error }, { status: status || 401 });

  const body = await request.json();
  const { title, description, category } = body;

  if (!title || !title.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data, error: insertErr } = await supabase
    .from('feature_requests')
    .insert({
      title: title.trim(),
      description: description?.trim() || null,
      category: category || 'general',
      submitted_by: auth.user_id,
      submitted_by_email: auth.email,
      submitted_by_role: auth.role,
      brand_id: auth.brand_id,
    })
    .select()
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ request: { ...data, score: 0, upvotes: 0, downvotes: 0, user_vote: 0 } });
}
