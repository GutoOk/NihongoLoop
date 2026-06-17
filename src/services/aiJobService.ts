import {
  AiJobRepository,
  DictionaryFormRepository,
  DictionaryRepository,
  DictionarySenseRepository,
  SentenceRepository,
  TermRepository,
} from '../repositories';
import { AiJob } from '../types';
import { AuthService } from '../core/authService';
import { generateDictionaryUniqueKey } from './termDetectionService';
import { stableHash } from '../core/hash';
import { simpleKanaToRomaji } from './romajiHelper';

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 0, initialDelay = 1000): Promise<Response> {
  const { supabase } = await import('../core/supabaseClient');
  let token: string | null = null;
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token || null;
  }
  const finalOptions = {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };

  let delay = initialDelay;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url, finalOptions);
    } catch (error: any) {
      if (attempt >= maxRetries || finalOptions.signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  throw new Error('Falha ao conectar à API de processamento.');
}

export class AiJobService {
  static async triggerBatchJobs(targetId: string, concurrencyLimit?: number, signal?: AbortSignal) {
    const response = await fetchWithRetry('/api/ai/trigger-batch-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetId, concurrencyLimit }),
      signal,
    });
    if (!response.ok) throw new Error(`Servidor respondeu com status ${response.status}`);
    return response.json();
  }

  static async requestSentenceTranslation(sentenceId: string, japanese: string) {
    const input = { sentence: japanese };
    const hash = await stableHash(input);
    const existing = await AiJobRepository.getPendingByTarget('translate_sentence', 'sentence', sentenceId);
    if (existing && existing.input_hash === hash) return existing;
    return AiJobRepository.add({
      user_id: AuthService.getCurrentUserId(),
      type: 'translate_sentence',
      target_type: 'sentence',
      target_id: sentenceId,
      status: 'pending',
      input_hash: hash,
      input,
      error: null,
      result: null,
    });
  }

  static async requestSentenceReading(sentenceId: string, japanese: string) {
    const input = { sentence: japanese };
    const hash = await stableHash(input);
    const existing = await AiJobRepository.getPendingByTarget('generate_sentence_reading', 'sentence', sentenceId);
    if (existing && existing.input_hash === hash) return existing;
    return AiJobRepository.add({
      user_id: AuthService.getCurrentUserId(),
      type: 'generate_sentence_reading',
      target_type: 'sentence',
      target_id: sentenceId,
      status: 'pending',
      input_hash: hash,
      input,
      error: null,
      result: null,
    });
  }

  static async requestDictionaryEnrichment(entryId: string, lemma: string) {
    const input = { lemma };
    const hash = await stableHash(input);
    const existing = await AiJobRepository.getPendingByTarget('enrich_dictionary_entry', 'dictionary_entry', entryId);
    if (existing && existing.input_hash === hash) return existing;
    return AiJobRepository.add({
      user_id: AuthService.getCurrentUserId(),
      type: 'enrich_dictionary_entry',
      target_type: 'dictionary_entry',
      target_id: entryId,
      status: 'pending',
      input_hash: hash,
      input,
      error: null,
      result: null,
    });
  }

  static async processJob(job: AiJob) {
    try {
      await AiJobRepository.updateStatus(job.id, { status: 'running', attempts: (job.attempts || 0) + 1 });
      const optimized = await this.tryOptimizeJob(job);
      if (optimized) return { success: true };

      const res = await fetchWithRetry('/api/ai/process-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job }),
      });
      if (!res.ok) {
        let errMsg = `API Error: ${res.status}`;
        try {
          const body = await res.json();
          if (body && body.error) errMsg = body.error;
        } catch {}
        throw new Error(errMsg);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await this.applyJobResult(job, data.result);
      await AiJobRepository.updateStatus(job.id, {
        status: 'completed',
        result: data.result,
        completed_at: new Date().toISOString(),
      });
      return { success: true, result: data.result };
    } catch (error: any) {
      await AiJobRepository.updateStatus(job.id, { status: 'error', error: error.message });
      return { success: false, error: error.message };
    }
  }

  static async processJobsBatch(jobs: AiJob[], signal?: AbortSignal) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    let successCount = 0;
    let errorCount = 0;

    // Set all jobs to running in a single optimized query
    await AiJobRepository.updateStatuses(jobs.map(j => j.id), { status: 'running' });

    if (signal?.aborted) {
      // Revert if aborted immediately after running state change
      await AiJobRepository.updateStatuses(jobs.map(j => j.id), { status: 'pending' });
      throw new DOMException('Aborted', 'AbortError');
    }

    const remainingJobs: AiJob[] = [];
    for (const job of jobs) {
      if (signal?.aborted) break;
      if (await this.tryOptimizeJob(job)) successCount++;
      else remainingJobs.push(job);
    }

    if (signal?.aborted) {
      if (remainingJobs.length > 0) {
        await AiJobRepository.updateStatuses(remainingJobs.map(j => j.id), { status: 'pending' });
      }
      throw new DOMException('Aborted', 'AbortError');
    }

    if (remainingJobs.length === 0) return { success: true, successCount, errorCount };

    try {
      const res = await fetchWithRetry('/api/ai/process-jobs-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobs: remainingJobs }),
        signal,
      });
      if (!res.ok) {
        let errMsg = `API Error: ${res.status}`;
        try {
          const body = await res.json();
          if (body && body.error) errMsg = body.error;
        } catch {}
        throw new Error(errMsg);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const resultMap = new Map<string, any>();
      for (const item of data.results || []) {
        if (item?.job_id) resultMap.set(item.job_id, item);
      }

      for (const job of remainingJobs) {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const itemResult = resultMap.get(job.id) || data.result || data;
        try {
          await this.applyJobResult(job, itemResult);
          if (itemResult && typeof itemResult === 'object' && itemResult.failed_count > 0) {
            await this.rescheduleFailedItems(job, itemResult);
          }
          await AiJobRepository.updateStatus(job.id, {
            status: 'completed',
            result: itemResult,
            completed_at: new Date().toISOString(),
          });
          successCount++;
        } catch (error: any) {
          await AiJobRepository.updateStatus(job.id, { status: 'error', error: error.message });
          errorCount++;
        }
      }
      return { success: true, successCount, errorCount };
    } catch (error: any) {
      const isAbort = error.name === 'AbortError' || 
                      error.message?.includes('aborted') || 
                      error.message?.includes('AbortError') ||
                      error.message?.includes('signal is aborted') ||
                      (signal && signal.aborted);
      
      const newStatus = isAbort ? 'pending' : 'error';
      const errorMsg = isAbort ? null : error.message;

      if (remainingJobs.length > 0) {
        await AiJobRepository.updateStatuses(remainingJobs.map(j => j.id), { status: newStatus, error: errorMsg });
      }
      return { success: false, error: error.message, successCount, errorCount: remainingJobs.length };
    }
  }

  private static getJobInput(job: AiJob): any {
    if (typeof job.input === 'string') {
      try {
        return JSON.parse(job.input);
      } catch {
        return {};
      }
    }
    return job.input || {};
  }

  private static async tryOptimizeJob(job: AiJob): Promise<boolean> {
    const input = this.getJobInput(job);
    if (job.type === 'batch_translate_sentences' && Array.isArray(input.items)) {
      const sentences = await SentenceRepository.getByIds(input.items.map((item: any) => item.id).filter(Boolean));
      const sentenceMap = new Map(sentences.map((sentence) => [sentence.id, sentence]));
      const unresolvedItems = input.items.filter((item: any) => {
        const sentence = sentenceMap.get(item.id);
        return sentence && !sentence.portuguese && sentence.status !== 'reviewed';
      });
      if (unresolvedItems.length === 0) {
        await AiJobRepository.updateStatus(job.id, { status: 'completed', result: { optimization: 'skipped_resolved_batch' }, completed_at: new Date().toISOString() });
        return true;
      }
      if (unresolvedItems.length !== input.items.length) {
        job.input = { ...input, items: unresolvedItems };
      }
    }
    if (job.type === 'batch_analyze_sentences' && Array.isArray(input.items)) {
      const ids = input.items.map((item: any) => item.id).filter(Boolean);
      const sentences = await SentenceRepository.getByIds(ids);
      const terms = await TermRepository.getBySentences(ids);
      const withTerms = new Set(terms.map((term) => term.sentence_id));
      if (sentences.every((sentence) => sentence.kana && sentence.romaji && withTerms.has(sentence.id))) {
        await AiJobRepository.updateStatus(job.id, { status: 'completed', result: { optimization: 'already_analyzed' }, completed_at: new Date().toISOString() });
        return true;
      }
    }
    if (job.type.startsWith('batch_enrich_dictionary') && Array.isArray(input.items)) {
      const entries = await DictionaryRepository.getByIds(input.items.map((item: any) => item.id).filter(Boolean));
      if (entries.every((entry) => entry.status !== 'pending' && entry.main_meaning && entry.kana && entry.romaji)) {
        await AiJobRepository.updateStatus(job.id, { status: 'completed', result: { optimization: 'already_enriched' }, completed_at: new Date().toISOString() });
        return true;
      }
    }
    return false;
  }

  private static async rescheduleFailedItems(job: AiJob, result: any): Promise<void> {
    const input = this.getJobInput(job);
    const originalItems = Array.isArray(input.items) ? input.items : [];
    const failedIds = Object.keys(result.errors_by_item || {});
    if (failedIds.length === 0) return;
    const failedItems = originalItems.filter((item: any) => failedIds.includes(item.id) || failedIds.includes(item.job_id));
    if (failedItems.length === 0) return;
    const splitSize = Math.max(1, Math.ceil(failedItems.length / 2));
    for (let i = 0; i < failedItems.length; i += splitSize) {
      const items = failedItems.slice(i, i + splitSize);
      const retryInput = { ...input, items, retry_count: (input.retry_count || 0) + 1 };
      await AiJobRepository.add({
        user_id: AuthService.getCurrentUserId(),
        type: job.type,
        target_type: job.target_type,
        target_id: job.target_id,
        status: 'pending',
        input_hash: await stableHash({ type: job.type, input: retryInput }),
        input: retryInput,
        error: null,
        result: null,
      });
    }
  }

  private static async applyJobResult(job: AiJob, result: any) {
    if (job.type === 'batch_translate_sentences') {
      const failed: Record<string, string> = {};
      for (const item of result.items || result.results || []) {
        const sentenceId = item.job_id || item.id;
        if (!sentenceId || !item.translation) {
          if (sentenceId) failed[sentenceId] = 'Tradução vazia';
          continue;
        }
        const sentence = await this.getSentenceForApply(sentenceId);
        if (!sentence || sentence.status === 'reviewed') continue;
        if (sentence.japanese === item.translation) throw new Error('Tradução idêntica ao japonês.');
        await SentenceRepository.update(sentence.id, {
          portuguese: item.translation,
          status: sentence.kana && sentence.romaji ? 'reading_ready' : 'translated',
          translation_source: 'ai',
        });
      }
      if (Object.keys(failed).length > 0) {
        result.failed_count = Object.keys(failed).length;
        result.errors_by_item = failed;
      }
      return;
    }

    if (job.type === 'batch_analyze_sentences') {
      await this.applySentenceAnalysisBatch(result.items || result.results || []);
      return;
    }

    if (job.type.startsWith('batch_enrich_dictionary')) {
      for (const item of result.items || result.results || []) {
        await this.applyDictionaryEnrichment(item.job_id || item.id, item);
      }
      return;
    }

    if (job.type === 'translate_sentence') {
      const sentence = await SentenceRepository.getById(job.target_id);
      if (!sentence || sentence.status === 'reviewed') return;
      if (!result.translation) throw new Error('Resultado inválido: tradução ausente.');
      await SentenceRepository.update(sentence.id, {
        portuguese: result.translation,
        status: sentence.kana && sentence.romaji ? 'reading_ready' : 'translated',
        translation_source: 'ai',
      });
      return;
    }

    if (job.type === 'generate_sentence_reading' || job.type === 'detect_sentence_terms') {
      await this.applySentenceAnalysisBatch([{ job_id: job.target_id, ...result }]);
      return;
    }

    if (job.type === 'enrich_dictionary_entry' || job.type === 'generate_dictionary_senses') {
      await this.applyDictionaryEnrichment(job.target_id, result);
    }
  }

  private static async getSentenceForApply(sentenceId: string) {
    if (typeof SentenceRepository.getById === 'function') {
      const sentence = await SentenceRepository.getById(sentenceId);
      if (sentence) return sentence;
    }
    const [sentence] = await SentenceRepository.getByIds([sentenceId]);
    return sentence || null;
  }

  private static async applySentenceAnalysisBatch(items: any[]) {
    const sentenceIds = items.map((item) => item.job_id || item.id).filter(Boolean);
    const sentences = await SentenceRepository.getByIds(sentenceIds);
    const sentenceMap = new Map(sentences.map((sentence) => [sentence.id, sentence]));
    const userId = AuthService.getCurrentUserId();

    for (const item of items) {
      const sentenceId = item.job_id || item.id;
      const sentence = sentenceMap.get(sentenceId);
      if (!sentence || sentence.status === 'reviewed') continue;

      if (item.kana && item.romaji) {
        let romaji = String(item.romaji).toLowerCase();
        if (/[\u3040-\u30FF\u4E00-\u9FAF]/.test(romaji)) {
          romaji = simpleKanaToRomaji(item.kana) || romaji.replace(/[\u3040-\u30FF\u4E00-\u9FAF]/g, '');
        }
        await SentenceRepository.update(sentence.id, {
          kana: item.kana,
          romaji,
          status: sentence.portuguese ? 'reading_ready' : sentence.status,
          reading_source: 'ai',
        });
      }

      const terms = Array.isArray(item.terms) ? item.terms : [];
      const normalizedTerms = [];
      for (const rawTerm of terms) {
        const surface = String(rawTerm.surface || '').trim();
        const lemma = String(rawTerm.lemma || surface).trim();
        if (!surface || !lemma) continue;
        let startIndex = Number(rawTerm.start_index);
        let endIndex = Number(rawTerm.end_index);
        if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex) || sentence.japanese.substring(startIndex, endIndex) !== surface) {
          startIndex = sentence.japanese.indexOf(surface);
          endIndex = startIndex >= 0 ? startIndex + surface.length : -1;
        }
        if (startIndex < 0 || endIndex <= startIndex) continue;

        const type = rawTerm.type || 'outro';
        const entryKey = generateDictionaryUniqueKey(lemma, rawTerm.entry_kana || rawTerm.kana || null, type);
        let entry = await DictionaryRepository.getByUniqueKey(entryKey);
        if (!entry) {
          const created = await DictionaryRepository.addBatch([{
            user_id: userId,
            lemma,
            kana: rawTerm.entry_kana || rawTerm.kana || null,
            romaji: rawTerm.entry_romaji || rawTerm.romaji || null,
            type,
            jlpt_level: rawTerm.jlpt_level || null,
            status: 'pending',
            tags: rawTerm.is_expression ? ['expressao'] : [],
            unique_key: entryKey,
            main_meaning: rawTerm.meaning || rawTerm.context_meaning || null,
          }]);
          entry = created[0] || null;
        }
        if (!entry) continue;

        const form = await DictionaryFormRepository.resolveOrCreate({
          dictionary_entry_id: entry.id,
          form: surface,
          kana: rawTerm.form_kana || rawTerm.kana || null,
          romaji: rawTerm.form_romaji || rawTerm.romaji || null,
          form_type: rawTerm.form_type || (surface === lemma ? 'forma de dicionário' : 'forma encontrada'),
          grammar_note: rawTerm.grammar_note || null,
          is_common: surface === lemma,
        });
        if (!form) continue;

        let sense = null;
        const meaning = rawTerm.meaning || rawTerm.context_meaning || entry.main_meaning;
        if (meaning) {
          sense = await DictionarySenseRepository.resolveOrCreate({
            dictionary_entry_id: entry.id,
            meaning,
            meaning_type: 'contextual',
            explanation: rawTerm.explanation || null,
          });
          if (!entry.main_meaning) {
            await DictionaryRepository.update(entry.id, { main_meaning: meaning });
          }
        }

        normalizedTerms.push({
          user_id: userId,
          sentence_id: sentence.id,
          dictionary_form_id: form.id,
          dictionary_sense_id: sense?.id || null,
          surface,
          start_index: startIndex,
          end_index: endIndex,
          confidence: rawTerm.confidence || 1,
          status: 'detected' as const,
        });
      }

      await TermRepository.deleteBySentenceIds([sentence.id]);
      if (normalizedTerms.length > 0) {
        await TermRepository.addBatch(normalizedTerms);
        await SentenceRepository.update(sentence.id, { terms_source: 'ai' });
      } else {
        await SentenceRepository.update(sentence.id, { terms_source: 'ai_empty' });
      }
    }
  }

  private static async applyDictionaryEnrichment(entryId: string, result: any) {
    if (!entryId) return;
    const entry = await DictionaryRepository.getById(entryId);
    if (!entry || entry.status === 'reviewed') return;
    const mainMeaning = result.main_meaning || result.meaning || (Array.isArray(result.meanings) ? result.meanings[0] : null);
    if (!mainMeaning || !result.type) throw new Error('Resultado inválido: significado ou tipo ausente.');

    const finalType = result.type || entry.type || 'outro';
    const finalKana = result.kana || entry.kana || null;
    await DictionaryRepository.update(entry.id, {
      main_meaning: mainMeaning,
      type: finalType,
      kana: finalKana,
      romaji: result.romaji || entry.romaji || null,
      jlpt_level: result.jlpt_level || entry.jlpt_level || null,
      tags: Array.isArray(result.tags) ? result.tags : entry.tags,
      subtype: result.subtype || entry.subtype || null,
      components: result.components || entry.components || null,
      grammar_info: result.grammar_info || entry.grammar_info || null,
      short_note: result.short_note || entry.short_note || null,
      status: 'ai_enriched',
      unique_key: DictionaryRepository.makeEntryKey(entry.lemma, finalKana, finalType),
    });

    const meanings = Array.isArray(result.meanings) && result.meanings.length > 0 ? result.meanings : [mainMeaning];
    await DictionarySenseRepository.upsertBatch(meanings.filter(Boolean).map((meaning: string, index: number) => ({
      dictionary_entry_id: entry.id,
      meaning,
      meaning_type: index === 0 ? 'principal' : 'variação',
      sense_order: index + 1,
    })));

    await DictionaryFormRepository.resolveOrCreate({
      dictionary_entry_id: entry.id,
      form: entry.lemma,
      kana: finalKana,
      romaji: result.romaji || entry.romaji || null,
      form_type: 'forma de dicionário',
      is_common: true,
    });
  }
}
