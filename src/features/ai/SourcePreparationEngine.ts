import {
  AiJobRepository,
  DictionaryRepository,
  SentenceRepository,
  TermRepository,
} from '../../repositories';
import { stableHash } from '../../core/hash';
import { makeJapaneseKey } from '../../core/japaneseNormalize';
import { AiJob, AiJobStatus, AiJobType, DictionaryEntry, Sentence, SentenceTermWithDictionary } from '../../types';
import { AiJobService } from '../../services/aiJobService';

export const SOURCE_PREPARATION_DEFINITIONS = {
  existingTranslation:
    'portuguese preenchido, com texto diferente da frase japonesa normalizada.',
  validLexicalAnalysis:
    'kana e romaji preenchidos e termos ligados a verbete, ou terms_source=ai_empty quando a IA confirmou ausência de termos relevantes.',
  sufficientDictionaryEntry:
    'verbete com significado principal, kana, romaji e tipo preenchidos.',
  completeDictionaryEntry:
    'verbete suficiente com status ai_enriched ou reviewed.',
} as const;

export interface PreparationBatchOptions {
  translateBatchSize?: number;
  analyzeBatchSize?: number;
  dictionaryBatchSize?: number;
}

export interface SourcePreparationDiagnosis {
  sourceId: string;
  generatedAt: string;
  definitions: typeof SOURCE_PREPARATION_DEFINITIONS;
  sentences: {
    total: number;
    unique: number;
    repeatedInsideSource: number;
    existingInDatabase: number;
    withTranslation: number;
    withoutTranslation: number;
    reusableTranslation: number;
    needsAiTranslation: number;
    withValidLexicalAnalysis: number;
    withoutValidLexicalAnalysis: number;
  };
  terms: {
    found: number;
    linkedToExistingEntries: number;
    withoutEntry: number;
  };
  dictionary: {
    usedEntries: number;
    completeEntries: number;
    incompleteEntries: number;
    needsAiEntries: number;
  };
  jobs: {
    pending: number;
    running: number;
    completed: number;
    error: number;
    stuck: number;
    possibleDuplicates: number;
  };
  targets: {
    reusableTranslations: Array<{ sentenceId: string; reusableSentenceId: string; translation: string }>;
    aiTranslations: Array<{ sentenceId: string; japanese: string }>;
    lexicalAnalyses: Array<{ sentenceId: string; japanese: string; portuguese: string | null }>;
    dictionaryEntries: Array<{ entryId: string; lemma: string }>;
    erroredJobs: AiJob[];
    stuckJobs: AiJob[];
    duplicateJobs: AiJob[];
  };
}

export interface SourcePreparationPlan {
  sourceId: string;
  diagnosis: SourcePreparationDiagnosis;
  reuse: {
    translations: SourcePreparationDiagnosis['targets']['reusableTranslations'];
  };
  jobs: {
    translation: PlannedPreparationJob[];
    lexicalAnalysis: PlannedPreparationJob[];
    dictionary: PlannedPreparationJob[];
  };
  blocked: {
    errors: AiJob[];
    stuck: AiJob[];
    duplicates: AiJob[];
  };
  totals: {
    reusableTranslationActions: number;
    translationJobs: number;
    lexicalAnalysisJobs: number;
    dictionaryJobs: number;
    jobs: number;
    actions: number;
    translationItems: number;
    lexicalAnalysisItems: number;
    dictionaryItems: number;
  };
}

export interface SourcePreparationQueueResult {
  plan: SourcePreparationPlan;
  jobs: AiJob[];
  appliedReusableTranslations: number;
}

export interface PlannedPreparationJob {
  type: AiJobType;
  targetType: 'batch';
  targetId: string;
  stage: 'translation' | 'lexical_analysis' | 'dictionary';
  label: string;
  itemCount: number;
  input: Record<string, unknown>;
  targetKeys: string[];
}

type PreparationStage = PlannedPreparationJob['stage'];

const JOB_TYPES = {
  translation: 'translate_sentence',
  lexical_analysis: 'generate_sentence_reading',
  dictionary: 'enrich_dictionary_entry',
} as const satisfies Record<PreparationStage, AiJobType>;

const JOB_STATUSES_FOR_DUPLICATE_AUDIT: AiJobStatus[] = ['pending', 'running', 'completed', 'applied'];
const ACTIVE_STATUSES: AiJobStatus[] = ['pending', 'running'];
const BLOCKING_STATUSES: AiJobStatus[] = ['error'];
function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasExistingTranslation(sentence: Pick<Sentence, 'japanese' | 'portuguese'>): boolean {
  return hasText(sentence.portuguese) && makeJapaneseKey(sentence.portuguese) !== makeJapaneseKey(sentence.japanese);
}

function isDictionaryEntrySufficient(entry: DictionaryEntry | null | undefined): boolean {
  return Boolean(entry && hasText(entry.main_meaning) && hasText(entry.kana) && hasText(entry.romaji) && hasText(entry.type));
}

function isDictionaryEntryComplete(entry: DictionaryEntry | null | undefined): boolean {
  return Boolean(isDictionaryEntrySufficient(entry) && entry && (entry.status === 'ai_enriched' || entry.status === 'reviewed'));
}

function isJobStuck(job: AiJob, now: Date): boolean {
  if (job.status !== 'running') return false;
  if (job.locked_until && new Date(job.locked_until).getTime() < now.getTime()) return true;
  if (!job.locked_until && job.last_heartbeat_at) {
    return now.getTime() - new Date(job.last_heartbeat_at).getTime() > 5 * 60_000;
  }
  return false;
}

function getInput(job: AiJob): any {
  if (typeof job.input === 'string') {
    try {
      return JSON.parse(job.input);
    } catch {
      return {};
    }
  }
  return job.input || {};
}

function canonicalJobType(type: string): string {
  if (type === 'batch_translate_sentences') return JOB_TYPES.translation;
  if (type === 'batch_analyze_sentences') return JOB_TYPES.lexical_analysis;
  if (type === 'batch_enrich_dictionary_entries_fast' || type === 'batch_enrich_dictionary_entries_full') return JOB_TYPES.dictionary;
  return type;
}

function getJobItemTargetKeys(job: AiJob): string[] {
  const input = getInput(job);
  const type = canonicalJobType(job.type);
  if (Array.isArray(input.items)) {
    return input.items
      .map((item: any) => item?.id || item?.entryId || item?.sentenceId)
      .filter(Boolean)
      .map((id: string) => `${type}:${id}`);
  }
  const directId = input.id || input.entryId || input.sentenceId;
  if (directId) return [`${type}:${directId}`];
  return [`${type}:${job.target_type}:${job.target_id}:${job.input_hash}`];
}

function getJobHumanLabel(job: Pick<AiJob, 'type' | 'input'>): string {
  const input = getInput(job as AiJob);
  const count = Array.isArray(input.items) ? input.items.length : 1;
  if (job.type === JOB_TYPES.translation) return `Traduzir frases (${count})`;
  if (job.type === JOB_TYPES.lexical_analysis) return `Analisar frases (${count})`;
  if (job.type === JOB_TYPES.dictionary) return `Completar dicionario (${count})`;
  return String(job.type);
}

function countPossibleDuplicateJobs(jobs: AiJob[]): { count: number; jobs: AiJob[] } {
  const seen = new Map<string, AiJob[]>();
  for (const job of jobs) {
    if (!JOB_STATUSES_FOR_DUPLICATE_AUDIT.includes(job.status) && !BLOCKING_STATUSES.includes(job.status)) continue;
    for (const key of getJobItemTargetKeys(job)) {
      const bucket = seen.get(key) || [];
      bucket.push(job);
      seen.set(key, bucket);
    }
  }
  const duplicates = new Set<AiJob>();
  for (const bucket of seen.values()) {
    if (bucket.length > 1) bucket.forEach((job) => duplicates.add(job));
  }
  return { count: duplicates.size, jobs: Array.from(duplicates) };
}

function buildJobItemStatusIndex(jobs: AiJob[], now: Date) {
  const activeOrDone = new Set<string>();
  const error = new Set<string>();
  const stuck = new Set<string>();

  for (const job of jobs) {
    const keys = getJobItemTargetKeys(job);
    if (ACTIVE_STATUSES.includes(job.status)) {
      keys.forEach((key) => activeOrDone.add(key));
    }
    if (job.status === 'error') {
      keys.forEach((key) => error.add(key));
    }
    if (isJobStuck(job, now)) {
      keys.forEach((key) => stuck.add(key));
    }
  }

  return { activeOrDone, error, stuck };
}

function hasValidLexicalAnalysis(sentence: Sentence, terms: SentenceTermWithDictionary[]): boolean {
  const linkedTerm = terms.some((term) => Boolean(term.dictionary_entry_id || term.form?.dictionary_entry_id || term.entry?.id));
  return Boolean(sentence.kana && sentence.romaji && (linkedTerm || sentence.terms_source === 'ai_empty'));
}

export class SourcePreparationEngine {
  static readonly definitions = SOURCE_PREPARATION_DEFINITIONS;

  static getHumanJobLabel(job: Pick<AiJob, 'type' | 'input'>): string {
    return getJobHumanLabel(job);
  }

  static isDictionaryEntrySufficient(entry: DictionaryEntry | null | undefined): boolean {
    return isDictionaryEntrySufficient(entry);
  }

  static isDictionaryEntryComplete(entry: DictionaryEntry | null | undefined): boolean {
    return isDictionaryEntryComplete(entry);
  }

  static async diagnoseSource(sourceId: string, now = new Date()): Promise<SourcePreparationDiagnosis> {
    const sourceSentences = await SentenceRepository.getBySourceId(sourceId);
    const allSentences = await SentenceRepository.getAll();
    const sentenceIds = sourceSentences.map((sentence) => sentence.id);
    const terms = await TermRepository.getBySentencesWithDictionary(sentenceIds);
    const jobs = await AiJobRepository.getByTarget(sourceId);

    const sourceKeys = sourceSentences.map((sentence) => sentence.japanese_key || makeJapaneseKey(sentence.japanese));
    const keyCounts = new Map<string, number>();
    for (const key of sourceKeys) keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    const uniqueKeys = new Set(sourceKeys);

    const allByKey = new Map<string, Sentence[]>();
    for (const sentence of allSentences) {
      const key = sentence.japanese_key || makeJapaneseKey(sentence.japanese);
      const bucket = allByKey.get(key) || [];
      bucket.push(sentence);
      allByKey.set(key, bucket);
    }

    const termsBySentence = new Map<string, SentenceTermWithDictionary[]>();
    for (const term of terms) {
      const bucket = termsBySentence.get(term.sentence_id) || [];
      bucket.push(term);
      termsBySentence.set(term.sentence_id, bucket);
    }

    const reusableTranslations: SourcePreparationDiagnosis['targets']['reusableTranslations'] = [];
    const aiTranslations: SourcePreparationDiagnosis['targets']['aiTranslations'] = [];
    const lexicalAnalyses: SourcePreparationDiagnosis['targets']['lexicalAnalyses'] = [];

    let existingInDatabase = 0;
    let withTranslation = 0;
    let withoutTranslation = 0;
    let withValidLexicalAnalysis = 0;

    const aiTranslationKeys = new Set<string>();

    for (const sentence of sourceSentences) {
      const key = sentence.japanese_key || makeJapaneseKey(sentence.japanese);
      const otherMatches = (allByKey.get(key) || []).filter((match) => match.id !== sentence.id);
      if (otherMatches.length > 0) existingInDatabase++;

      if (hasExistingTranslation(sentence)) {
        withTranslation++;
      } else {
        withoutTranslation++;
        const reusable = otherMatches.find(hasExistingTranslation);
        if (reusable && reusable.portuguese) {
          reusableTranslations.push({
            sentenceId: sentence.id,
            reusableSentenceId: reusable.id,
            translation: reusable.portuguese,
          });
        } else if (!aiTranslationKeys.has(key)) {
          aiTranslationKeys.add(key);
          aiTranslations.push({ sentenceId: sentence.id, japanese: sentence.japanese });
        }
      }

      const sentenceTerms = termsBySentence.get(sentence.id) || [];
      if (hasValidLexicalAnalysis(sentence, sentenceTerms)) {
        withValidLexicalAnalysis++;
      } else if (hasExistingTranslation(sentence)) {
        lexicalAnalyses.push({
          sentenceId: sentence.id,
          japanese: sentence.japanese,
          portuguese: sentence.portuguese || null,
        });
      }
    }

    const entryIds = Array.from(
      new Set(
        terms
          .map((term) => term.dictionary_entry_id || term.form?.dictionary_entry_id || term.entry?.id)
          .filter(Boolean),
      ),
    ) as string[];
    const entries = await DictionaryRepository.getByIds(entryIds);
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    const dictionaryEntries = entryIds
      .map((entryId) => entriesById.get(entryId))
      .filter((entry): entry is DictionaryEntry => Boolean(entry));
    const completeEntries = dictionaryEntries.filter(isDictionaryEntryComplete);
    const needsAiEntries = dictionaryEntries.filter((entry) => !isDictionaryEntrySufficient(entry));

    const linkedToExistingEntries = terms.filter((term) =>
      Boolean(term.dictionary_entry_id || term.form?.dictionary_entry_id || term.entry?.id),
    ).length;
    const stuckJobs = jobs.filter((job) => isJobStuck(job, now));
    const duplicateJobs = countPossibleDuplicateJobs(jobs);

    return {
      sourceId,
      generatedAt: now.toISOString(),
      definitions: SOURCE_PREPARATION_DEFINITIONS,
      sentences: {
        total: sourceSentences.length,
        unique: uniqueKeys.size,
        repeatedInsideSource: sourceSentences.length - uniqueKeys.size,
        existingInDatabase,
        withTranslation,
        withoutTranslation,
        reusableTranslation: reusableTranslations.length,
        needsAiTranslation: aiTranslations.length,
        withValidLexicalAnalysis,
        withoutValidLexicalAnalysis: sourceSentences.length - withValidLexicalAnalysis,
      },
      terms: {
        found: terms.length,
        linkedToExistingEntries,
        withoutEntry: terms.length - linkedToExistingEntries,
      },
      dictionary: {
        usedEntries: dictionaryEntries.length,
        completeEntries: completeEntries.length,
        incompleteEntries: dictionaryEntries.length - completeEntries.length,
        needsAiEntries: needsAiEntries.length,
      },
      jobs: {
        pending: jobs.filter((job) => job.status === 'pending').length,
        running: jobs.filter((job) => job.status === 'running').length,
        completed: jobs.filter((job) => job.status === 'completed' || job.status === 'applied').length,
        error: jobs.filter((job) => job.status === 'error').length,
        stuck: stuckJobs.length,
        possibleDuplicates: duplicateJobs.count,
      },
      targets: {
        reusableTranslations,
        aiTranslations,
        lexicalAnalyses,
        dictionaryEntries: needsAiEntries.map((entry) => ({ entryId: entry.id, lemma: entry.lemma })),
        erroredJobs: jobs.filter((job) => job.status === 'error'),
        stuckJobs,
        duplicateJobs: duplicateJobs.jobs,
      },
    };
  }

  static async buildPlan(
    sourceId: string,
    options: PreparationBatchOptions = {},
    now = new Date(),
  ): Promise<SourcePreparationPlan> {
    const diagnosis = await this.diagnoseSource(sourceId, now);
    const jobs = await AiJobRepository.getByTarget(sourceId);
    const itemStatus = buildJobItemStatusIndex(jobs, now);

    const translationTargets = diagnosis.targets.aiTranslations.filter((target) => {
      const key = `${JOB_TYPES.translation}:${target.sentenceId}`;
      return !itemStatus.activeOrDone.has(key) && !itemStatus.error.has(key) && !itemStatus.stuck.has(key);
    });
    const lexicalTargets = diagnosis.targets.lexicalAnalyses.filter((target) => {
      const key = `${JOB_TYPES.lexical_analysis}:${target.sentenceId}`;
      return !itemStatus.activeOrDone.has(key) && !itemStatus.error.has(key) && !itemStatus.stuck.has(key);
    });
    const dictionaryTargets = diagnosis.targets.dictionaryEntries.filter((target) => {
      const key = `${JOB_TYPES.dictionary}:${target.entryId}`;
      return !itemStatus.activeOrDone.has(key) && !itemStatus.error.has(key) && !itemStatus.stuck.has(key);
    });

    const shouldPlanTranslation = translationTargets.length > 0;
    const shouldPlanLexicalAnalysis = !shouldPlanTranslation && lexicalTargets.length > 0;
    const shouldPlanDictionary = !shouldPlanTranslation && !shouldPlanLexicalAnalysis && dictionaryTargets.length > 0;

    const translation = this.createPlannedJobs(
      sourceId,
      'translation',
      shouldPlanTranslation ? translationTargets.map((target) => ({ id: target.sentenceId, japanese: target.japanese })) : [],
      options.translateBatchSize || 30,
      (item) => item.japanese,
    );
    const lexicalAnalysis = this.createPlannedJobs(
      sourceId,
      'lexical_analysis',
      shouldPlanLexicalAnalysis
        ? lexicalTargets.map((target) => ({ id: target.sentenceId, japanese: target.japanese, portuguese: target.portuguese }))
        : [],
      options.analyzeBatchSize || 10,
      (item) => `${item.japanese}${item.portuguese || ''}`,
    );
    const dictionary = this.createPlannedJobs(
      sourceId,
      'dictionary',
      shouldPlanDictionary ? dictionaryTargets.map((target) => ({ id: target.entryId, lemma: target.lemma })) : [],
      options.dictionaryBatchSize || 12,
      (item) => item.lemma,
    );

    return {
      sourceId,
      diagnosis,
      reuse: {
        translations: diagnosis.targets.reusableTranslations,
      },
      jobs: { translation, lexicalAnalysis, dictionary },
      blocked: {
        errors: diagnosis.targets.erroredJobs,
        stuck: diagnosis.targets.stuckJobs,
        duplicates: diagnosis.targets.duplicateJobs,
      },
      totals: {
        reusableTranslationActions: diagnosis.targets.reusableTranslations.length,
        translationJobs: translation.length,
        lexicalAnalysisJobs: lexicalAnalysis.length,
        dictionaryJobs: dictionary.length,
        jobs: translation.length + lexicalAnalysis.length + dictionary.length,
        actions: diagnosis.targets.reusableTranslations.length + translation.length + lexicalAnalysis.length + dictionary.length,
        translationItems: shouldPlanTranslation ? translationTargets.length : 0,
        lexicalAnalysisItems: shouldPlanLexicalAnalysis ? lexicalTargets.length : 0,
        dictionaryItems: shouldPlanDictionary ? dictionaryTargets.length : 0,
      },
    };
  }

  static async createQueueFromPlan(plan: SourcePreparationPlan): Promise<SourcePreparationQueueResult> {
    const appliedReusableTranslations = await this.applyReusableTranslations(plan.reuse.translations);
    const created: AiJob[] = [];
    for (const planned of [...plan.jobs.translation, ...plan.jobs.lexicalAnalysis, ...plan.jobs.dictionary]) {
      const inputHash = await stableHash({
        type: planned.type,
        sourceId: plan.sourceId,
        targetKeys: planned.targetKeys,
      });
      const job = await AiJobRepository.add({
        type: planned.type,
        target_type: planned.targetType,
        target_id: planned.targetId,
        status: 'pending',
        priority: this.priorityForStage(planned.stage),
        input_hash: inputHash,
        input: planned.input,
        result: null,
        error: null,
        attempts: 0,
        max_attempts: 3,
      } as any);
      if (job) created.push(job);
    }
    return { plan, jobs: created, appliedReusableTranslations };
  }

  static async createQueueForSource(sourceId: string, options: PreparationBatchOptions = {}): Promise<SourcePreparationQueueResult> {
    const plan = await this.buildPlan(sourceId, options);
    return this.createQueueFromPlan(plan);
  }

  private static async requeueStuckJobsForSource(sourceId: string): Promise<boolean> {
    const jobs = await AiJobRepository.getByTarget(sourceId);
    const now = new Date();
    const stuckIds = jobs.filter((job) => isJobStuck(job, now)).map((job) => job.id);
    if (stuckIds.length === 0) return true;
    return AiJobRepository.updateStatuses(stuckIds, {
      status: 'pending',
      error: null,
      locked_by: null,
      locked_until: null,
      last_heartbeat_at: null,
    } as any);
  }

  static async retryProblemJobs(sourceId: string): Promise<boolean> {
    const jobs = await AiJobRepository.getByTarget(sourceId);
    return this.retryProblemJobsFromList(jobs);
  }

  static async retryAllProblemJobs(): Promise<boolean> {
    const jobs = await AiJobRepository.getAll();
    return this.retryProblemJobsFromList(jobs);
  }

  private static async retryProblemJobsFromList(jobs: AiJob[]): Promise<boolean> {
    const now = new Date();
    const ids = jobs
      .filter((job) => job.status === 'error' || isJobStuck(job, now))
      .map((job) => job.id);
    if (ids.length === 0) return true;
    return AiJobRepository.updateStatuses(ids, {
      status: 'pending',
      error: null,
      locked_by: null,
      locked_until: null,
      last_heartbeat_at: null,
      attempts: 0,
    } as any);
  }

  static async clearQueueJobs(sourceId: string): Promise<boolean> {
    const jobs = await AiJobRepository.getByTarget(sourceId);
    for (const job of jobs) {
      await AiJobRepository.delete(job.id);
    }
    return true;
  }

  static async clearAllQueueJobs(): Promise<boolean> {
    const jobs = await AiJobRepository.getAll();
    for (const job of jobs) {
      await AiJobRepository.delete(job.id);
    }
    return true;
  }

  static async processNextSourceJob(sourceId: string, runnerId: string, signal?: AbortSignal): Promise<AiJob | null> {
    const [processed] = await this.processNextSourceJobs(sourceId, runnerId, 1, signal);
    return processed || null;
  }

  static async processNextSourceJobs(sourceId: string, runnerId: string, concurrencyLimit: number, signal?: AbortSignal): Promise<AiJob[]> {
    await this.requeueStuckJobsForSource(sourceId);
    const jobs = await AiJobRepository.getByTarget(sourceId);
    const pending = jobs
      .filter((job) => job.status === 'pending')
      .sort((a, b) => this.jobSortValue(a) - this.jobSortValue(b));
    const selected: AiJob[] = [];
    for (const job of pending) {
      if (selected.length >= Math.max(1, concurrencyLimit)) break;
      const claimed = await AiJobRepository.claimJob(job.id, runnerId);
      if (claimed) selected.push(job);
    }
    if (selected.length === 0) return [];
    await Promise.all(selected.map((job) => AiJobService.processJob(job)));
    return selected;
  }

  private static createPlannedJobs<T extends { id: string }>(
    sourceId: string,
    stage: PreparationStage,
    items: T[],
    maxItems: number,
    getText: (item: T) => string,
  ): PlannedPreparationJob[] {
    const type = JOB_TYPES[stage];
    return items.map((item, index) => ({
      type,
      targetType: 'batch',
      targetId: sourceId,
      stage,
      label: this.createPlannedJobLabel(stage, index + 1, items.length),
      itemCount: 1,
      input: {
        sourceId,
        stage,
        label: this.createPlannedJobLabel(stage, index + 1, items.length),
        id: item.id,
        ...(stage === 'translation' ? { sentence: (item as any).japanese, japanese: (item as any).japanese } : {}),
        ...(stage === 'lexical_analysis' ? { sentence: (item as any).japanese, japanese: (item as any).japanese, portuguese: (item as any).portuguese } : {}),
        ...(stage === 'dictionary' ? { lemma: (item as any).lemma } : {}),
      },
      targetKeys: [`${type}:${item.id}`],
    }));
  }

  private static createPlannedJobLabel(stage: PreparationStage, batch: number, total: number): string {
    if (stage === 'translation') return `Traduzir frase ${batch}/${total}`;
    if (stage === 'lexical_analysis') return `Analisar frase ${batch}/${total}`;
    return `Completar verbete ${batch}/${total}`;
  }

  private static priorityForStage(stage: PreparationStage): number {
    if (stage === 'translation') return 300;
    if (stage === 'lexical_analysis') return 200;
    return 100;
  }

  private static jobSortValue(job: AiJob): number {
    const typeWeight =
      job.type === JOB_TYPES.translation ? 0 : job.type === JOB_TYPES.lexical_analysis ? 1000 : job.type === JOB_TYPES.dictionary ? 2000 : 3000;
    return typeWeight - (job.priority || 0);
  }

  private static async applyReusableTranslations(reusable: SourcePreparationDiagnosis['targets']['reusableTranslations']): Promise<number> {
    let applied = 0;
    for (const item of reusable) {
      const sentence = await SentenceRepository.getById(item.sentenceId);
      if (!sentence || hasExistingTranslation(sentence)) continue;
      await SentenceRepository.update(item.sentenceId, {
        portuguese: item.translation,
        translation_source: 'cache',
        status: sentence.kana && sentence.romaji ? 'reading_ready' : 'translated',
      });
      applied++;
    }
    return applied;
  }
}
