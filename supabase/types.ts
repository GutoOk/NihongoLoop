/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AiJobType } from '../src/features/ai/jobTypes';

export type SourceType = 'srt' | 'text' | 'manual';

export interface Source {
  id: string;
  user_id: string;
  title: string;
  type: SourceType;
  original_content: string;
  created_at: string;
  updated_at: string;
  favorite?: boolean;
  difficulty?: number | null;
}

export type SentenceStatus = 'raw' | 'translated' | 'reading_ready' | 'reviewed' | 'problematic';

export interface Sentence {
  id: string;
  source_id: string;
  user_id: string;
  order_index: number;
  start_time?: string | null;
  end_time?: string | null;
  japanese: string;
  japanese_key?: string | null;
  portuguese: string | null;
  kana: string | null;
  romaji: string | null;
  status: SentenceStatus;
  tags: string[];
  prepared_at?: string | null;
  translation_source?: string | null;
  reading_source?: string | null;
  terms_source?: string | null;
  created_at: string;
  updated_at: string;
  favorite?: boolean;
  difficulty?: number | null;
}

export type TermStatus = 'detected' | 'reviewed' | 'ignored';
export type DictionaryEntryStatus = 'pending' | 'ai_enriched' | 'reviewed';

export interface DictionaryEntry {
  id: string;
  user_id: string;
  lemma: string;
  kana: string | null;
  romaji: string | null;
  type: string;
  jlpt_level: string | null;
  status: DictionaryEntryStatus;
  tags: string[];
  unique_key: string;
  main_meaning: string | null;
  created_at: string;
  updated_at: string;
  subtype?: string | null;
  components?: any[] | null;
  grammar_info?: string | null;
  short_note?: string | null;
  common_forms?: string[] | null;
  meanings?: string[];
}

export interface DictionaryForm {
  id: string;
  user_id: string;
  dictionary_entry_id: string;
  form: string;
  kana: string | null;
  romaji: string | null;
  form_type: string | null;
  grammar_note: string | null;
  is_common: boolean;
  status: 'detected' | 'ai_resolved' | 'reviewed';
  unique_key: string;
  created_at: string;
  updated_at: string;
}

export interface DictionarySense {
  id: string;
  user_id: string;
  dictionary_entry_id: string;
  meaning: string;
  meaning_type: string | null;
  explanation: string | null;
  example_japanese: string | null;
  example_portuguese: string | null;
  sense_order: number;
  status: 'ai_generated' | 'reviewed';
  created_at: string;
  updated_at: string;
}

export interface SentenceTerm {
  id: string;
  user_id: string;
  sentence_id: string;
  dictionary_form_id: string;
  dictionary_sense_id: string | null;
  surface: string;
  start_index: number;
  end_index: number;
  confidence: number;
  status: TermStatus;
  created_at: string;
  updated_at: string;
  dictionary_entry_id?: string | null;
  context_meaning?: string | null;
  lemma?: string;
  kana?: string | null;
  romaji?: string | null;
  type?: string;
  grammar_note?: string | null;
  structure_note?: string | null;
}

export interface SentenceTermWithDictionary extends SentenceTerm {
  form?: DictionaryForm & {
    entry?: DictionaryEntry | null;
  };
  sense?: DictionarySense | null;
  dictionary_entry_id?: string | null;
  entry?: DictionaryEntry | null;
}

export interface SentenceProgress {
  id: string;
  user_id: string;
  sentence_id: string;
  seen_count: number;
  correct_count: number;
  wrong_count: number;
  last_seen_at: string | null;
  mastery: number;
  favorite: boolean;
  difficulty: number | null;
  suspended: boolean;
  notes: string | null;
  srs_interval_minutes?: number;
  srs_ease_factor?: number;
  due_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DictionaryProgress {
  id: string;
  user_id: string;
  dictionary_entry_id: string;
  seen_count: number;
  correct_count: number;
  wrong_count: number;
  last_seen_at: string | null;
  mastery: number;
  favorite: boolean;
  difficulty: number | null;
  suspended: boolean;
  notes: string | null;
  srs_interval_minutes?: number;
  srs_ease_factor?: number;
  due_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type { AiJobType };
export type AiJobStatus =
  | 'pending'
  | 'claimed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'retry_wait'
  | 'needs_review'
  | 'cancelled'
  | 'obsolete'
  | 'error'
  | 'rejected'
  | 'applied';

export interface AiJob {
  id: string;
  user_id: string;
  run_id?: string | null;
  retry_of_job_id?: string | null;
  type: AiJobType;
  target_type: string;
  target_id: string;
  job_key?: string | null;
  status: AiJobStatus;
  priority?: number;
  input_hash: string;
  input: any;
  payload?: any;
  result: any;
  raw_result?: any;
  error: string | null;
  error_code?: string | null;
  error_kind?: string | null;
  error_structured?: any;
  current_step?: string | null;
  attempts?: number;
  max_attempts?: number;
  model?: string | null;
  model_version?: string | null;
  prompt_version?: string | null;
  target_hash?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_estimate?: number | null;
  cost_actual?: number | null;
  latency_queue_ms?: number | null;
  latency_ai_ms?: number | null;
  latency_persist_ms?: number | null;
  logs?: any[];
  created_at: string;
  claimed_at?: string | null;
  started_at?: string | null;
  completed_at: string | null;
  updated_at?: string | null;
  locked_by?: string | null;
  locked_until?: string | null;
  lease_expires_at?: string | null;
  worker_id?: string | null;
  retry_at?: string | null;
  retry_count?: number;
  cancel_requested?: boolean;
  last_heartbeat_at?: string | null;
}

export interface StudySession {
  id: string;
  user_id: string;
  type: 'phrases' | 'words' | 'word_context' | 'flashcards' | 'source_offset';
  source_id: string | null;
  config: any;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudySessionItem {
  id: string;
  user_id: string;
  study_session_id: string;
  target_type: 'sentence' | 'dictionary_entry';
  target_id: string;
  order_index: number | null;
  answer: any;
  is_correct: boolean | null;
  response_time_ms: number | null;
  created_at: string;
}

export type StudyEntityType = 'sentence' | 'word' | 'word_context';

export type StudyTargetType = 'all' | 'source' | 'favorites' | 'difficult' | 'new' | 'untranslated' | 'unread' | 'pending_words' | 'specific_word' | 'pending' | 'reviewed' | 'ai_enriched' | 'no_meaning' | 'frequent' | 'verb' | 'particle' | 'proper_noun' | 'expression' | 'specific';

export interface StudySessionConfig {
  entityType: StudyEntityType;
  targetType: StudyTargetType;
  sourceId?: string | null;
  wordId?: string | null;
  limit?: number;
  order?: 'original' | 'random';
  studyMode?: 'jp-pt' | 'pt-jp' | 'pt-jp-jp' | 'jp-repeat' | 'shadowing' | 'jp-meaning' | 'meaning-jp' | 'jp-reading-meaning' | 'reading-jp-meaning' | 'meaning-jp-example';
}

export interface QuizConfig {
  quizEntityType: StudyEntityType;
  targetType: StudyTargetType;
  sourceId?: string | null;
  wordId?: string | null;
  limit?: number;
  questionMode?: string;
}

export interface AppSettings {
  voicePt: string;
  voiceJa1: string;
  voiceJa2: string;
  speedPt: number;
  speedJa: number;
  pauseBetweenSpeeches: number;
  pauseBetweenItems: number;
  studyMode: string;
  jpRepeatCount: number;
  blockHighlightDuringSpeech?: boolean;
}

export type ProcessingRunStatus =
  | 'pending'
  | 'planning'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'error'
  | 'cancelled'
  | 'needs_review';
export interface ProcessingRun {
  id: string;
  user_id: string;
  source_id: string;
  status: ProcessingRunStatus;
  run_mode?: 'all' | 'translate' | 'analyze' | 'dictionary';
  current_step: string | null;
  total_steps: number;
  completed_steps: number;
  total_items: number;
  processed_items: number;
  created_jobs: number;
  processed_jobs: number;
  applied_items: number;
  failed_items: number;
  planned_jobs?: number;
  pending_jobs?: number;
  claimed_jobs?: number;
  running_jobs?: number;
  completed_jobs?: number;
  failed_jobs?: number;
  retry_jobs?: number;
  needs_review_jobs?: number;
  cancelled_jobs?: number;
  obsolete_jobs?: number;
  total_cost_estimate?: number;
  total_cost_actual?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  ai_call_count?: number;
  metadata?: Record<string, unknown>;
  cancel_requested: boolean;
  log: any[];
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}
