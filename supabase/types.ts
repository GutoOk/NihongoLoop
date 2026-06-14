/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type SourceType = 'srt' | 'text' | 'manual';

export interface Source {
  id: string;
  user_id: string;
  title: string;
  type: SourceType;
  original_content: string;
  created_at: string;
  updated_at: string;
}

export type SentenceStatus = 'raw' | 'translated' | 'reading_ready' | 'reviewed' | 'problematic';

export interface Sentence {
  id: string;
  source_id: string;
  user_id: string;
  order_index: number;
  japanese: string;
  japanese_key?: string | null;
  portuguese: string | null;
  kana: string | null;
  romaji: string | null;
  status: SentenceStatus;
  tags: string[];
  favorite: boolean;
  difficulty: number | null;
  prepared_at?: string | null;
  translation_source?: string | null;
  reading_source?: string | null;
  terms_source?: string | null;
  created_at: string;
  updated_at: string;
}

export type TermStatus = 'detected' | 'reviewed' | 'ignored';

export interface SentenceTerm {
  id: string;
  user_id: string;
  sentence_id: string;
  dictionary_entry_id: string | null;
  surface: string;
  lemma: string;
  kana: string | null;
  romaji: string | null;
  start_index: number;
  end_index: number;
  type: string;
  confidence: number;
  status: TermStatus;
  created_at: string;
  updated_at: string;

  // Rich metadata/analysis fields
  context_meaning?: string | null;
  grammar_note?: string | null;
  structure_note?: string | null;
  components?: any[] | null;
  is_expression?: boolean;
}

export type DictionaryEntryStatus = 'pending' | 'ai_enriched' | 'reviewed';

export interface DictionaryEntry {
  id: string;
  user_id: string;
  lemma: string;
  kana: string | null;
  romaji: string | null;
  type: string;
  main_meaning: string | null;
  meanings: string[];
  tags: string[];
  jlpt_level: string | null;
  status: DictionaryEntryStatus;
  unique_key: string;
  created_at: string;
  updated_at: string;

  // Rich metadata/analysis fields
  subtype?: string | null;
  components?: any[] | null;
  grammar_info?: string | null;
  common_forms?: string[] | null;
  short_note?: string | null;
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
  srs_interval_minutes?: number;
  srs_ease_factor?: number;
  due_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type AiJobType = 'translate_sentence' | 'generate_sentence_reading' | 'detect_sentence_terms' | 'enrich_dictionary_entry' | 'explain_sentence' | 'repair_sentence' | 'batch_translate_sentences' | 'batch_analyze_sentences' | 'batch_enrich_dictionary_entries_fast' | 'batch_enrich_dictionary_entries_full';
export type AiJobStatus = 'pending' | 'running' | 'completed' | 'error' | 'cancelled' | 'rejected' | 'applied';

export interface AiJob {
  id: string;
  user_id: string;
  type: AiJobType;
  target_type: string;
  target_id: string;
  status: AiJobStatus;
  input_hash: string;
  input: any;
  result: any;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at?: string | null;
  locked_by?: string | null;
  locked_until?: string | null;
  retry_count?: number;
  last_heartbeat_at?: string | null;
}

export interface StudySession {
  id: string;
  user_id: string;
  type: 'phrases' | 'words' | 'word_context';
  source_id: string | null;
  config: any;
  created_at: string;
  updated_at: string;
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


export type ProcessingRunStatus = 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
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
  cancel_requested: boolean;
  log: any[];
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}
