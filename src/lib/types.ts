// ─── Database Enums ─────────────────────────────────────────────

export type CreativeType = 'ugc' | 'static' | 'video' | 'carousel' | 'flexible' | 'other';

export type FileStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'scheduled'
  | 'live'
  | 'paused'
  | 'killed';

export type UserRole = 'admin' | 'strategist' | 'user';

export type MediaFormat = 'VIDEO' | 'STATIC' | 'AUDIO' | 'DOCUMENT';

export type AspectRatio = '1x1' | '9x16' | '4x5' | '16x9' | 'OTHER';

// ─── Brand ──────────────────────────────────────────────────────

export interface Brand {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

// ─── User Profile ───────────────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  brand_id: string | null;
  brand_name?: string;
  created_at: string;
}

// ─── Submission ─────────────────────────────────────────────────

export interface Submission {
  id: string;
  brand_id: string;
  user_id: string;
  batch_name: string;
  creative_type: CreativeType;
  creator_name: string;
  landing_page_url: string;
  copy_headline: string;
  copy_body: string;
  copy_cta: string;
  copy_title: string;
  notes: string;
  status: FileStatus;
  is_carousel: boolean;
  is_flexible: boolean;
  is_whitelist: boolean;
  creator_social_handle: string;
  created_at: string;
  updated_at: string;
}

// ─── Submission File ────────────────────────────────────────────

export interface SubmissionFile {
  id: string;
  submission_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  file_url: string;
  status: FileStatus;
  media_format: MediaFormat | null;
  aspect_ratio: AspectRatio | null;
  width: number | null;
  height: number | null;
  copy_headline: string | null;
  copy_body: string | null;
  copy_cta: string | null;
  landing_page_url: string | null;
  copy_title: string | null;
  launch_date: string | null;
  launch_time: string | null;
  ad_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Tracked File (from file_tracker view) ──────────────────────

export interface TrackedFile {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  file_url: string;
  batch_name: string;
  brand_name: string;
  brand_id: string;
  creator_name: string;
  creative_type: string;
  landing_page_url: string;
  copy_headline: string;
  copy_body: string;
  copy_cta: string;
  copy_title: string;
  status: FileStatus;
  media_format: MediaFormat | null;
  aspect_ratio: AspectRatio | null;
  width: number | null;
  height: number | null;
  is_carousel: boolean;
  is_flexible: boolean;
  is_whitelist: boolean;
  creator_social_handle: string;
  launch_date: string | null;
  launch_time: string | null;
  ad_name: string | null;
  notes: string | null;
  submitted_at: string;
  submission_id: string;
}

// ─── File Context (per-file carousel/flexible context) ──────────

export interface FileContext {
  landingPageUrl: string;
  copyHeadline: string;
  copyBody: string;
  copyCta: string;
}

// ─── Batch Form Data (upload form) ──────────────────────────────

export interface FileMediaInfo {
  format: MediaFormat;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
}

export interface BatchFormData {
  batchName: string;
  creativeType: string;
  creatorName: string;
  landingPageUrl: string;
  copyTitle: string;
  copyHeadline: string;
  copyBody: string;
  copyCta: string;
  notes: string;
  files: File[];
  isCarousel: boolean;
  isFlexible: boolean;
  isWhitelist: boolean;
  creatorSocialHandle: string;
  fileContexts: Record<number, FileContext>;
  fileMediaInfo: Record<number, FileMediaInfo>;
}
