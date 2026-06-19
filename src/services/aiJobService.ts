import { isSupabaseConfigured, supabase } from '../core/supabaseClient';
import { AiJobRepository } from '../repositories';
import { getUserId } from '../repositories/utils';

const SENTENCE_MODEL = 'gemini-2.5-flash-lite';
const SENTENCE_PROMPT_VERSION = 'manual-sentence-worker:2026-06-v1';

type ManualSentenceJobResult = {
  created_jobs?: number;
  job_id?: string | null;
  status?: string;
};

async function enqueueSentenceJob(sentenceId: string, type: 'translate_sentence' | 'generate_sentence_reading') {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase!.rpc('enqueue_sentence_ai_job', {
    p_sentence_id: sentenceId,
    p_user_id: getUserId(),
    p_type: type,
    p_model: SENTENCE_MODEL,
    p_prompt_version: SENTENCE_PROMPT_VERSION,
  });
  if (error) {
    console.error(error);
    throw new Error(`Erro do Supabase ao enfileirar job de frase: ${error.message}`);
  }
  return data as ManualSentenceJobResult | null;
}

export class AiJobService {
  static async requestSentenceTranslation(sentenceId: string, _japanese: string) {
    return enqueueSentenceJob(sentenceId, 'translate_sentence');
  }

  static async requestSentenceReading(sentenceId: string, _japanese: string, _portuguese?: string | null) {
    return enqueueSentenceJob(sentenceId, 'generate_sentence_reading');
  }

  static async requestDictionaryEnrichment(entryId: string, _lemma: string) {
    const created = await AiJobRepository.enqueueDictionaryEnrichmentJobs([entryId]);
    return { created_jobs: created };
  }
}
