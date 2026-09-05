import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import type { ExclusionReason } from '@/lib/engines/step-validity';

/**
 * Today's validated step picture, if the phone has ever synced one.
 *
 * Returns null rather than a zeroed shape when there is nothing, so the UI can
 * tell "synced, and it was a quiet day" apart from "never synced" — which are
 * completely different things to show someone.
 */

export interface StepSegmentView {
  startedAt: string;
  endedAt: string;
  steps: number;
  sourceName: string | null;
  counted: boolean;
  reason: ExclusionReason | null;
  cadence: number | null;
}

export interface StepValidityView {
  rawSteps: number;
  validatedSteps: number;
  excludedSteps: number;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  sources: string[];
  syncedAt: string;
  segments: StepSegmentView[];
}

export async function getStepValidity(date?: string): Promise<StepValidityView | null> {
  if (!supabaseConfigured) return null;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const logDate = date ?? new Date().toISOString().slice(0, 10);

  const { data: validation } = await supabase
    .from('step_validations')
    .select('raw_steps, validated_steps, excluded_steps, confidence, reasons, sources, synced_at')
    .eq('user_id', auth.user.id)
    .eq('log_date', logDate)
    .maybeSingle();

  if (!validation) return null;

  const { data: segments } = await supabase
    .from('step_segments')
    .select('started_at, ended_at, steps, source_name, counted, exclusion_reason, cadence')
    .eq('user_id', auth.user.id)
    .eq('log_date', logDate)
    .order('started_at', { ascending: true });

  return {
    rawSteps: validation.raw_steps,
    validatedSteps: validation.validated_steps,
    excludedSteps: validation.excluded_steps,
    confidence: validation.confidence,
    reasons: (validation.reasons as string[]) ?? [],
    sources: validation.sources ?? [],
    syncedAt: validation.synced_at,
    segments: (segments ?? []).map((s) => ({
      startedAt: s.started_at,
      endedAt: s.ended_at,
      steps: s.steps,
      sourceName: s.source_name,
      counted: s.counted,
      reason: s.exclusion_reason as ExclusionReason | null,
      cadence: s.cadence,
    })),
  };
}
