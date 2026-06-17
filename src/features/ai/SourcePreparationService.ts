import { ProcessingRunRepository, SentenceRepository, SourceRepository, TermRepository, DictionaryRepository, AiJobRepository } from '../../repositories';
import { Sentence } from '../../types';
import { makeJapaneseKey } from '../../core/japaneseNormalize';
import { stableHash } from '../../core/hash';
import { chunkByCountAndChars } from './batching';

export interface PreparationOptions {
  translateBatchSize: number;
  analyzeBatchSize: number;
  dictFastBatchSize: number;
  dictFullBatchSize: number;
  dictMode: 'fast' | 'full';
  useCache: boolean;
  overwriteReviewed: boolean;
  runMode?: 'all' | 'translate' | 'analyze' | 'dictionary';
  processMode?: 'local' | 'server';
  concurrencyLimit?: number;
}

export class SourcePreparationService {
  private static needsDictionaryEnrichment(entry: any): boolean {
    return entry.status === 'pending' && (
      !entry.main_meaning ||
      !entry.kana ||
      !entry.romaji ||
      !entry.type
    );
  }

  private static getSentencesWithValidDictionaryTerms(terms: any[]): Set<string> {
    const sentenceIds = new Set<string>();
    for (const term of terms) {
      const hasEntry = Boolean(term.entry?.id || term.form?.entry?.id || term.dictionary_entry_id || term.form?.dictionary_entry_id);
      if (hasEntry) sentenceIds.add(term.sentence_id);
    }
    return sentenceIds;
  }

  private static isPreparing = false;

  static async prepareSource(sourceId: string, options: PreparationOptions, runId: string): Promise<void> {
    if (this.isPreparing) {
      console.warn("Source preparation is already running. Skipping duplicate call.");
      return;
    }
    this.isPreparing = true;

    try {
      const run = await ProcessingRunRepository.getRun(runId);
      if (!run) {
        this.isPreparing = false;
        return;
      }

      await ProcessingRunRepository.updateRun(run.id, { status: 'running', started_at: run.started_at || new Date().toISOString(), current_step: 'Carregando fonte...' });

      // ETAPA 1 - carregar fonte
      const source = await SourceRepository.getById(sourceId);
      if (!source) throw new Error('Fonte não encontrada');

      const sentences = await SentenceRepository.getBySourceId(sourceId);
      if (sentences.length === 0) {
        await ProcessingRunRepository.finishRun(run.id);
        return;
      }

      await ProcessingRunRepository.updateRun(run.id, { 
        total_items: sentences.length,
        total_steps: 7,
        completed_steps: 1
      });

      // Garantir chaves em todas as frases do lote
      for (const sent of sentences) {
        if (!sent.japanese_key) {
           sent.japanese_key = makeJapaneseKey(sent.japanese);
           await SentenceRepository.update(sent.id, { japanese_key: sent.japanese_key });
        }
      }
      
      // ETAPA 2 - Hidratar do Cache
      if (options.useCache) {
        await this.hydrateSourceSentencesFromCache(sentences, run.id, options.overwriteReviewed);
      }
      
      let cancelCheck = await ProcessingRunRepository.getRun(run.id);
      if (cancelCheck?.cancel_requested) throw new Error('Canceled');
      await ProcessingRunRepository.updateRun(run.id, { completed_steps: 2 });
      // ETAPA 3 - Frases sem tradução -> Lotes de Traducao
      const runTranslate = !options.runMode || options.runMode === 'all' || options.runMode === 'translate';
      if (runTranslate) {
         await ProcessingRunRepository.updateRun(run.id, { current_step: 'Identificando frases para tradução...' });
         const sentencesToTranslate = sentences.filter(s => !s.portuguese);
         
         const targetJobs = await AiJobRepository.getByStatuses(['pending', 'running', 'error']);
         
         const pendingTranslateSet = new Set<string>();
         targetJobs.filter(j => j.type === 'batch_translate_sentences').forEach(j => {
            const input = j.input || j.result || {};
            if (input.items) input.items.forEach((item: any) => pendingTranslateSet.add(item.id));
         });

         const translationJobs = sentencesToTranslate.filter(s => !pendingTranslateSet.has(s.id));

         if (translationJobs.length > 0) {
            await ProcessingRunRepository.appendLog(run.id, `Criando lotes de tradução para ${translationJobs.length} frases.`);
            const translateChunks = chunkByCountAndChars(translationJobs, s => s.japanese, {
               maxItems: options.translateBatchSize, maxChars: 5200, perItemOverhead: 80
            });
            
            for (const chunk of translateChunks) {
               cancelCheck = await ProcessingRunRepository.getRun(run.id);
               if (cancelCheck?.cancel_requested) throw new Error('Canceled');
               
               const reqItems = chunk.map(s => ({ id: s.id, japanese: s.japanese }));
               const input = { items: reqItems };
               const hash = await stableHash({ type: 'batch_translate_sentences', input });
               
               if (!targetJobs.find(j => j.input_hash === hash)) {
                  await AiJobRepository.add({
                     type: 'batch_translate_sentences',
                     target_type: 'batch',
                     target_id: sourceId,
                     input_hash: hash,
                     input: input,
                     status: 'pending',
                     result: null
                  } as any);
               }
            }
         }
      }

      if ((options.runMode || 'all') === 'all') {
        const pendingTranslateJobs = await AiJobRepository.hasTargetJobByTypeAndStatuses(
          sourceId,
          'batch_translate_sentences',
          ['pending', 'running', 'error'],
        );
        const stillMissingTranslations = (await SentenceRepository.getBySourceId(sourceId)).some(s => !s.portuguese);
        if (pendingTranslateJobs || stillMissingTranslations) {
          await ProcessingRunRepository.updateRun(run.id, {
            completed_steps: 3,
            current_step: 'Aguardando conclusão da tradução antes de iniciar a análise...'
          });
          await ProcessingRunRepository.finishRun(run.id);
          return;
        }
      }

      await ProcessingRunRepository.updateRun(run.id, { completed_steps: 3 });

      // ETAPA 4 - Analise -> Leituras e Termos
      const runAnalyze = !options.runMode || options.runMode === 'all' || options.runMode === 'analyze';
      if (runAnalyze) {
         await ProcessingRunRepository.updateRun(run.id, { current_step: 'Identificando frases para leitura e segmentação...' });
         
         const allTerms = await TermRepository.getBySentencesWithDictionary(sentences.map(s => s.id));
         const validTermSentenceIds = this.getSentencesWithValidDictionaryTerms(allTerms);
         
         const sentencesToAnalyze = sentences.filter(s => {
            const lacksKana = !s.kana;
            const lacksRomaji = !s.romaji;
            const hasNoValidTerms = !validTermSentenceIds.has(s.id);
            return lacksKana || lacksRomaji || hasNoValidTerms;
         });
         
         const targetJobs = await AiJobRepository.getByStatuses(['pending', 'running', 'error']);
         const pendingAnalyzeSet = new Set<string>();
         targetJobs.filter(j => j.type === 'batch_analyze_sentences').forEach(j => {
            const input = j.input || j.result || {};
            if (input.items) input.items.forEach((item: any) => pendingAnalyzeSet.add(item.id));
         });

         const analyzeJobs = sentencesToAnalyze.filter(s => !pendingAnalyzeSet.has(s.id));

         if (analyzeJobs.length > 0) {
            await ProcessingRunRepository.appendLog(run.id, `Criando lotes de análise para ${analyzeJobs.length} frases.`);
            const analyzeChunks = chunkByCountAndChars(analyzeJobs, s => s.japanese + (s.portuguese||''), {
               maxItems: options.analyzeBatchSize, maxChars: 4200, perItemOverhead: 220
            });
            
            for (const chunk of analyzeChunks) {
               cancelCheck = await ProcessingRunRepository.getRun(run.id);
               if (cancelCheck?.cancel_requested) throw new Error('Canceled');
               
               const reqItems = chunk.map(s => ({ id: s.id, japanese: s.japanese, portuguese: s.portuguese || null }));
               const input = { items: reqItems };
               const hash = await stableHash({ type: 'batch_analyze_sentences', input });
               
               if (!targetJobs.find(j => j.input_hash === hash)) {
                  await AiJobRepository.add({
                     type: 'batch_analyze_sentences',
                     target_type: 'batch',
                     target_id: sourceId,
                     input_hash: hash,
                     input: input,
                     status: 'pending',
                     result: null
                  } as any);
               }
            }
         }
      }

      if ((options.runMode || 'all') === 'all') {
        const pendingAnalyzeJobs = await AiJobRepository.hasTargetJobByTypeAndStatuses(
          sourceId,
          'batch_analyze_sentences',
          ['pending', 'running', 'error'],
        );
        const currentSentences = await SentenceRepository.getBySourceId(sourceId);
        const currentTerms = await TermRepository.getBySentencesWithDictionary(currentSentences.map(s => s.id));
        const validTermSentenceIds = this.getSentencesWithValidDictionaryTerms(currentTerms);
        const stillMissingAnalysis = currentSentences.some(s => {
           return !s.kana || !s.romaji || !validTermSentenceIds.has(s.id);
        });
        if (pendingAnalyzeJobs || stillMissingAnalysis) {
          await ProcessingRunRepository.updateRun(run.id, {
            completed_steps: 4,
            current_step: 'Aguardando conclusão da leitura/segmentação antes de enriquecer o dicionário...'
          });
          await ProcessingRunRepository.finishRun(run.id);
          return;
        }
      }

      await ProcessingRunRepository.updateRun(run.id, { completed_steps: 4 });

      // ETAPA 5 - Dicionário -> Enriquecimento detalhado
      const runDict = !options.runMode || options.runMode === 'all' || options.runMode === 'dictionary';
      if (runDict) {
         await ProcessingRunRepository.updateRun(run.id, { current_step: 'Identificando palavras para dicionário...' });
         
         const allTerms = await TermRepository.getBySentencesWithDictionary(sentences.map(s => s.id));
         const dictIds = new Set(allTerms.map(t => t.dictionary_entry_id || t.form?.dictionary_entry_id).filter(Boolean));
         
         if (dictIds.size > 0) {
            const entries = await DictionaryRepository.getByIds(Array.from(dictIds) as string[]);
            const missingEntries = entries.filter(e => this.needsDictionaryEnrichment(e));
            
            const targetJobs = await AiJobRepository.getByStatuses(['pending', 'running', 'error']);
            const pendingDictItemIds = new Set<string>();
            targetJobs.filter(j => j.type.startsWith('batch_enrich_dictionary')).forEach(j => {
               const input = j.input || j.result || {};
               if (input.items) input.items.forEach((item: any) => pendingDictItemIds.add(item.id));
            });
            
            const entriesToBatch = missingEntries.filter(e => !pendingDictItemIds.has(e.id));
                        if (entriesToBatch.length > 0) {
               await ProcessingRunRepository.appendLog(run.id, `Criando lotes de dicionário para ${entriesToBatch.length} termos.`);
               const dictType = 'batch_enrich_dictionary_entries_full';
               const bSize = (options.dictFullBatchSize || 10);
               
               const dictChunks = chunkByCountAndChars(entriesToBatch, e => e.lemma, {
                  maxItems: bSize, maxChars: 5200, perItemOverhead: 180
               });
               
               for (const chunk of dictChunks) {
                  cancelCheck = await ProcessingRunRepository.getRun(run.id);
                  if (cancelCheck?.cancel_requested) throw new Error('Canceled');
                  
                  const input = { mode: 'full', items: chunk.map(e => ({ id: e.id, lemma: e.lemma })) };
                  const hash = await stableHash({ type: dictType, input });
                  
                  if (!targetJobs.find(j => j.input_hash === hash)) {
                     await AiJobRepository.add({
                        type: dictType as any,
                        target_type: 'batch',
                        target_id: sourceId,
                        input_hash: hash,
                        input: input,
                        status: 'pending',
                        result: null
                     } as any);
                  }
               }
            }
         }
      }

      await ProcessingRunRepository.updateRun(run.id, { completed_steps: 5 });
      await ProcessingRunRepository.finishRun(run.id);
      await ProcessingRunRepository.appendLog(run.id, 'Preparação de tarefas agendada. O executor processará a fila em seguida.');

    } catch (e: any) {
      if (e.message === 'Canceled') {
        await ProcessingRunRepository.appendLog(runId, 'Preparação cancelada pelo usuário.');
        await ProcessingRunRepository.updateRun(runId, { status: 'cancelled', finished_at: new Date().toISOString() });
      } else {
        await ProcessingRunRepository.failRun(runId, e.message);
      }
    } finally {
      this.isPreparing = false;
    }
  }

  static async hydrateSourceSentencesFromCache(sentences: Sentence[], runId: string, overwriteReviewed: boolean): Promise<void> {
    await ProcessingRunRepository.updateRun(runId, { current_step: 'Reaproveitando dados já existentes...' });
    
    const keys = sentences.map(s => s.japanese_key).filter(Boolean) as string[];
    const processedCache = await SentenceRepository.findProcessedByJapaneseKeys(keys);
    
    // Group existing sentences by key
    const cacheMap: Record<string, Sentence[]> = {};
    for (const cached of processedCache) {
       const key = cached.japanese_key!;
       if (!cacheMap[key]) cacheMap[key] = [];
       cacheMap[key].push(cached);
    }
    
    let appliedTranslations = 0;
    let appliedReadings = 0;
    let appliedTerms = 0;

    for (let i = 0; i < sentences.length; i++) {
       const target = sentences[i];
       if (target.status === 'reviewed' && !overwriteReviewed) continue;
       const key = target.japanese_key;
       if (!key) continue;
       
       const matches = cacheMap[key] || [];
       if (matches.length === 0) continue;

       const matchWithTranslation = matches.find(m => !!m.portuguese);
       const matchWithReading = matches.find(m => !!m.kana && !!m.romaji);
       
       let updated = false;
       const updates: Partial<Sentence> = {};
       
       if (!target.portuguese && matchWithTranslation) {
          target.portuguese = matchWithTranslation.portuguese;
          updates.portuguese = target.portuguese;
          updates.translation_source = 'cache';
          updated = true;
          appliedTranslations++;
       }
       
       if ((!target.kana || !target.romaji) && matchWithReading) {
          target.kana = matchWithReading.kana;
          target.romaji = matchWithReading.romaji;
          updates.kana = target.kana;
          updates.romaji = target.romaji;
          updates.reading_source = 'cache';
          updated = true;
          appliedReadings++;
       }
       
       if (updated) {
          if (target.status === 'raw') target.status = target.portuguese && target.kana ? 'reading_ready' : 'translated';
          updates.status = target.status;
          await SentenceRepository.update(target.id, updates);
       }
       
       // Handle terms
       const matchForTerms = matches.find(m => m.id !== target.id); // try to copy from any match
       if (matchForTerms) {
          const theirTerms = await TermRepository.getBySentence(matchForTerms.id);
          const myTerms = await TermRepository.getBySentence(target.id);
          
          if (myTerms.length === 0 && theirTerms.length > 0) {
             const newTermsToInsert = theirTerms.map(t => {
                const copy: any = { ...t, sentence_id: target.id };
                delete copy.id;
                delete copy.created_at;
                delete copy.updated_at;
                return copy;
             });
             await TermRepository.addBatch(newTermsToInsert);
             
             await SentenceRepository.update(target.id, { terms_source: 'cache' });
             appliedTerms += newTermsToInsert.length;
          }
       }
    }

    await ProcessingRunRepository.appendLog(runId, `${sentences.length} frases verificadas no cache.`);
    if (appliedTranslations > 0) await ProcessingRunRepository.appendLog(runId, `${appliedTranslations} traduções reaproveitadas.`);
    if (appliedReadings > 0) await ProcessingRunRepository.appendLog(runId, `${appliedReadings} leituras reaproveitadas.`);
    if (appliedTerms > 0) await ProcessingRunRepository.appendLog(runId, `${appliedTerms} ocorrências de palavras reaproveitadas.`);
    
    await ProcessingRunRepository.updateRun(runId, { 
       applied_items: appliedTranslations + appliedReadings + appliedTerms,
       processed_items: sentences.length
    });
  }
}
