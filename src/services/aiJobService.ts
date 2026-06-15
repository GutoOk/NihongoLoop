import { AiJobRepository, SentenceRepository, DictionaryRepository, TermRepository } from '../repositories';
import { AiJob } from '../types';
import { AuthService } from '../core/authService';
import { generateDictionaryUniqueKey } from './termDetectionService';
import { stableHash } from '../core/hash';
import { simpleKanaToRomaji } from './romajiHelper';

const VALID_DICT_TYPES = [
  'substantivo', 'verbo', 'adjetivo', 'advérbio', 'pronome',
  'partícula', 'expressão', 'interjeição', 'nome próprio',
  'número', 'tempo', 'lugar', 'conector', 'auxiliar', 'outro'
];

const isDev = import.meta.env.DEV || (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development');

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 0, initialDelay = 1000): Promise<Response> {
  const { supabase } = await import('../core/supabaseClient');
  let token: string | null = null;
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token || null;
  }

  const finalHeaders = {
    ...(options.headers || {}),
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
  const finalOptions = { ...options, headers: finalHeaders };

  let delay = initialDelay;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (finalOptions.signal?.aborted) {
      throw finalOptions.signal.reason || new Error("Request aborted");
    }
    try {
      const response = await fetch(url, finalOptions);

      if (response.status >= 500 && attempt < maxRetries) {
        console.warn(`[AI Job Service] Server returned error status ${response.status}. Retrying in ${delay}ms... (Attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }

      return response;
    } catch (error: any) {
      if (finalOptions.signal?.aborted || error?.name === 'AbortError') {
        throw error;
      }
      const isNetworkError = error instanceof TypeError || error?.message?.includes('Failed to fetch') || error?.message?.includes('network');

      if (isNetworkError && attempt < maxRetries) {
        console.warn(`[AI Job Service] Network error/Failed to fetch: ${error.message}. Retrying in ${delay}ms... (Attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }

      throw error;
    }
  }
  throw new Error('Falha ao conectar à API de processamento após várias tentativas de rede.');
}

export class AiJobService {
  static async requestSentenceTranslation(sentenceId: string, japanese: string) {
    const input = { sentence: japanese };
    const hash = await stableHash(input);
    const existing = await AiJobRepository.getPendingByTarget('translate_sentence', 'sentence', sentenceId);
    if (existing && existing.input_hash === hash) return existing;

    return await AiJobRepository.add({
      user_id: AuthService.getCurrentUserId(),
      type: 'translate_sentence',
      target_type: 'sentence',
      target_id: sentenceId,
      status: 'pending',
      input_hash: hash,
      input: input,
      error: null,
      result: null
    });
  }

  static async requestSentenceReading(sentenceId: string, japanese: string) {
    const input = { sentence: japanese };
    const hash = await stableHash(input);
    const existing = await AiJobRepository.getPendingByTarget('generate_sentence_reading', 'sentence', sentenceId);
    if (existing && existing.input_hash === hash) return existing;

    return await AiJobRepository.add({
      user_id: AuthService.getCurrentUserId(),
      type: 'generate_sentence_reading',
      target_type: 'sentence',
      target_id: sentenceId,
      status: 'pending',
      input_hash: hash,
      input: input,
      error: null,
      result: null
    });
  }

  static async requestDictionaryEnrichment(entryId: string, lemma: string) {
    const input = { lemma };
    const hash = await stableHash(input);
    const existing = await AiJobRepository.getPendingByTarget('enrich_dictionary_entry', 'dictionary_entry', entryId);
    if (existing && existing.input_hash === hash) return existing;

    return await AiJobRepository.add({
      user_id: AuthService.getCurrentUserId(),
      type: 'enrich_dictionary_entry',
      target_type: 'dictionary_entry',
      target_id: entryId,
      status: 'pending',
      input_hash: hash,
      input: input,
      error: null,
      result: null
    });
  }

  static async processJob(job: AiJob) {
    try {
      await AiJobRepository.updateStatus(job.id, { status: 'running' });

      // Tenta otimizar antes de enviar para a IA
      const isOptimized = await this.tryOptimizeJob(job);
      if (isOptimized) {
         return { success: true, result: { info: "Recuperado do cache/banco de dados" } };
      }

      const res = await fetchWithRetry('/api/ai/process-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: job })
      });

      if (!res.ok) {
        let serverError = `API Error: ${res.status}`;
        try {
          const errData = await res.json();
          if (errData && errData.error) {
            serverError = `API Error: ${res.status} - ${errData.error}`;
          }
        } catch (e) {}
        throw new Error(serverError);
      }

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const result = data.result;
      
      // Auto apply with validation
      await this.applyJobResult(job, result);

      if (result && typeof result === 'object' && result.failed_count > 0) {
         const didReschedule = await this.handlePartialBatchFailure(job, result);
         if (didReschedule) {
            await AiJobRepository.updateStatus(job.id, { 
               status: 'completed', 
               result: {
                  ...result,
                  recovery_status: 'rescheduled_failed_items',
                  rescheduled_count: result.failed_count
               },
               completed_at: new Date().toISOString()
            });
            return { success: true, result };
         } else {
            const errMsg = `Falha parcial: ${result.failed_count} item(ns) falharam no lote e não puderam ser recuperados. Detalhes: ${JSON.stringify(result.errors_by_item || {})}`;
            await AiJobRepository.updateStatus(job.id, { 
               status: 'error', 
               error: errMsg,
               result: result,
               completed_at: new Date().toISOString()
            });
            return { success: false, error: errMsg };
         }
      } else {
         await AiJobRepository.updateStatus(job.id, { 
            status: 'completed', 
            result: result,
            completed_at: new Date().toISOString()
         });
         return { success: true, result };
      }
    } catch (e: any) {
      console.error(e);
      await AiJobRepository.updateStatus(job.id, { status: 'error', error: e.message });
      return { success: false, error: e.message };
    }
  }

  static async processJobsBatch(jobs: AiJob[], signal?: AbortSignal) {
    if (jobs.length === 0) return { success: true, successCount: 0, errorCount: 0 };

    try {
      const remainingJobs: AiJob[] = [];
      let successCount = 0;
      let errorCount = 0;

      for (const job of jobs) {
        await AiJobRepository.updateStatus(job.id, { status: 'running' });
        try {
          const isOptimized = await this.tryOptimizeJob(job);
          if (isOptimized) {
            successCount++;
          } else {
            remainingJobs.push(job);
          }
        } catch (optimizeErr: any) {
          console.error(`Erro ao otimizar job ${job.id}:`, optimizeErr);
          remainingJobs.push(job); // Fallback para processar com IA
        }
      }

      if (remainingJobs.length > 0) {
        const res = await fetchWithRetry('/api/ai/process-jobs-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobs: remainingJobs }),
          signal
        });

        if (!res.ok) {
          let serverError = `API Error: ${res.status}`;
          try {
            const errData = await res.json();
            if (errData && errData.error) {
              serverError = `API Error: ${res.status} - ${errData.error}`;
            }
          } catch (e) {}
          throw new Error(serverError);
        }

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const results = data.results || [];
        const resultsMap = new Map<string, any>();
        for (const item of results) {
          if (item && item.job_id) {
            resultsMap.set(item.job_id, item);
          }
        }

        for (const job of remainingJobs) {
          const itemResult = resultsMap.get(job.id);
          if (!itemResult) {
            await AiJobRepository.updateStatus(job.id, { 
              status: 'error', 
              error: 'A IA omitiu a resposta deste item no processamento do lote.' 
            });
            errorCount++;
            continue;
          }

          try {
            await this.applyJobResult(job, itemResult);

            if (itemResult && typeof itemResult === 'object' && itemResult.failed_count > 0) {
              const didReschedule = await this.handlePartialBatchFailure(job, itemResult);
              if (didReschedule) {
                await AiJobRepository.updateStatus(job.id, {
                  status: 'completed',
                  result: {
                    ...itemResult,
                    recovery_status: 'rescheduled_failed_items',
                    rescheduled_count: itemResult.failed_count
                  },
                  completed_at: new Date().toISOString()
                });
                successCount++;
              } else {
                const errMsg = `Falha parcial: ${itemResult.failed_count} item(ns) falharam no lote. Detalhes: ${JSON.stringify(itemResult.errors_by_item || {})}`;
                await AiJobRepository.updateStatus(job.id, {
                  status: 'error',
                  error: errMsg,
                  result: itemResult,
                  completed_at: new Date().toISOString()
                });
                errorCount++;
              }
            } else {
              await AiJobRepository.updateStatus(job.id, {
                status: 'completed',
                result: itemResult,
                completed_at: new Date().toISOString()
              });
              successCount++;
            }
          } catch (err: any) {
            console.error(`Erro ao aplicar resultado em lote para job ${job.id}:`, err);
            await AiJobRepository.updateStatus(job.id, { 
              status: 'error', 
              error: err.message || 'Falha na validação/gravação' 
            });
            errorCount++;
          }
        }
      }

      return { success: true, successCount, errorCount };
    } catch (e: any) {
      if (e.name === 'AbortError') {
         throw e;
      }
      console.error('Erro ao processar lote de jobs:', e);
      for (const job of jobs) {
        await AiJobRepository.updateStatus(job.id, { status: 'error', error: e.message });
      }
      return { success: false, error: e.message };
    }
  }

  private static async handlePartialBatchFailure(job: AiJob, result: any): Promise<boolean> {
    if (!result || !result.errors_by_item || typeof result.errors_by_item !== 'object') {
      return false;
    }

    const failedItemIds = Object.keys(result.errors_by_item);
    if (failedItemIds.length === 0) {
      return false;
    }

    try {
      let inputObj = job.input;
      if (typeof inputObj === 'string') {
        try {
          inputObj = JSON.parse(inputObj);
        } catch (e) {
          inputObj = null;
        }
      }
      const originalItems = inputObj?.items || [];
      const failedOriginalItems = originalItems.filter((item: any) => item && item.id && failedItemIds.includes(item.id));

      if (failedOriginalItems.length > 0) {
        const currentRetry = (inputObj as any)?.retry_count || 0;
        if (currentRetry >= 3) {
          if (isDev) {
            console.warn(`[Auto-Recovery] Job ${job.id} reached the max retry limit (${currentRetry}). Stopping auto-recovery.`);
          }
          return false;
        }

        const newJobInput = {
           ...(inputObj || {}),
           items: failedOriginalItems,
           retry_count: currentRetry + 1
        };
        const newHash = await stableHash({ type: job.type, input: newJobInput });

        // Check if copy has been already added to avoid duplication
        const allJobs = await AiJobRepository.getAll();
        const alreadyExists = allJobs.some(j => j.input_hash === newHash && (j.status === 'pending' || j.status === 'running'));
        
        if (!alreadyExists) {
          if (isDev) {
            console.log(`[Auto-Recovery] Re-scheduling ${failedOriginalItems.length} failed items for job type ${job.type} from parent job ${job.id} (Attempt ${currentRetry + 1}/3)`);
          }
          
          await AiJobRepository.add({
             user_id: AuthService.getCurrentUserId(),
             type: job.type,
             target_type: job.target_type || 'batch',
             target_id: job.target_id,
             input_hash: newHash,
             input: newJobInput,
             status: 'pending',
             error: null,
             result: null
          } as any);

          return true;
        }
      }
    } catch (e) {
      console.error("[Auto-Recovery] Failed to split and recreate batch job:", e);
    }
    return false;
  }

  private static async tryOptimizeJob(job: AiJob): Promise<boolean> {
    const input = job.input;
    const sentenceJapanese = input.sentence;
    if (!sentenceJapanese) return false;

    // Busca a frase alvo associada ao job
    const targetSentence = await SentenceRepository.getById(job.target_id);
    if (!targetSentence) return false;

    if (job.type === 'translate_sentence') {
       // Busca outras frases iguais já traduzidas
       const matches = await SentenceRepository.getByJapanese(sentenceJapanese);
       const otherTranslated = matches.find(s => s.id !== targetSentence.id && s.portuguese);
       if (otherTranslated) {
          if (isDev) {
             console.log(`[Deduplicação Inteligente] Copiando tradução da frase ID ${otherTranslated.id} para a frase ID ${targetSentence.id}`);
          }
          const newStatus = (!targetSentence.kana || !targetSentence.romaji) ? 'translated' : 'reading_ready';
          await SentenceRepository.update(targetSentence.id, {
             portuguese: otherTranslated.portuguese,
             status: newStatus
          });
          
          await AiJobRepository.updateStatus(job.id, {
             status: 'completed',
             result: { translation: otherTranslated.portuguese, copied_from: otherTranslated.id },
             completed_at: new Date().toISOString()
          });
          return true;
       }
    } else if (job.type === 'generate_sentence_reading') {
       // Busca outras frases iguais já analisadas (com kana e romaji)
       const matches = await SentenceRepository.getByJapanese(sentenceJapanese);
       const otherAnalyzed = matches.find(s => s.id !== targetSentence.id && s.kana && s.romaji);
       if (otherAnalyzed) {
          if (isDev) {
             console.log(`[Deduplicação Inteligente] Copiando leitura e termos da frase ID ${otherAnalyzed.id} para a frase ID ${targetSentence.id}`);
          }
          const newStatus = 'reading_ready';
          
          // Se soubermos a tradução da outra, copie-a também se a nossa tiver vazia
          const ptTranslation = targetSentence.portuguese || otherAnalyzed.portuguese || null;

          await SentenceRepository.update(targetSentence.id, {
             kana: otherAnalyzed.kana,
             romaji: otherAnalyzed.romaji,
             portuguese: ptTranslation,
             status: newStatus
          });

          // Deleta termos pré-existentes para não duplicar se houver
          const existingTerms = await TermRepository.getBySentence(targetSentence.id);
          for (const t of existingTerms) {
             await TermRepository.delete(t.id);
          }

          // Copia todos os termos da outra frase
          const otherTerms = await TermRepository.getBySentence(otherAnalyzed.id);
          if (otherTerms.length > 0) {
             const termsToInsert = otherTerms.map(t => {
                const { id, created_at, updated_at, sentence_id, ...rest } = t as any;
                return {
                   ...rest,
                   sentence_id: targetSentence.id
                };
             });
             await TermRepository.addBatch(termsToInsert);
          }

          await AiJobRepository.updateStatus(job.id, {
             status: 'completed',
             result: { 
                kana: otherAnalyzed.kana, 
                romaji: otherAnalyzed.romaji, 
                terms_count: otherTerms.length, 
                copied_from: otherAnalyzed.id 
             },
             completed_at: new Date().toISOString()
          });
          return true;
       } else {
          // Não encontrou frase igual para copiar. Mas vamos otimizar enviando palavras conhecidas do dicionário que estão presentes na frase
          try {
             // Carrega todo o dicionário do usuário para buscar subclasses comuns na frase
             const allDict = await DictionaryRepository.getAll();
             const cleanJapanese = sentenceJapanese.trim();
             
             // Encontra lembretes de palavras que aparecem na frase japonesa
             const matchedWords = allDict.filter(entry => {
                if (!entry.lemma) return false;
                const lemma = entry.lemma.trim();
                if (lemma.length < 1) return false;
                
                // Evita partículas comuns gerarem match se forem muito pequenas, a não ser que façam sentido
                if (lemma.length === 1) {
                   const isKana = /^[\u3040-\u309F\u30A0-\u30FF]$/.test(lemma);
                   // Se for um kana solto de 1 char, só inclui se for partícula conhecida para ajudar canonicidade
                   if (isKana && !['は', 'が', 'を', 'に', 'で', 'と', 'も', 'の', 'か', 'や', 'よ', 'ね'].includes(lemma)) {
                      return false;
                   }
                }
                
                return cleanJapanese.includes(lemma);
             });

             if (matchedWords.length > 0) {
                // Limita a 15 palavras do dicionário para economizar tokens
                const subsetWords = matchedWords.slice(0, 15).map(w => ({
                   lemma: w.lemma,
                   kana: w.kana,
                   type: w.type,
                   meaning: w.main_meaning
                }));
                
                if (isDev) {
                   console.log(`[Dicionário Inteligente] Adicionando ${subsetWords.length} palavras do dicionário local ao payload da IA`);
                }
                
                // Adiciona as palavras no input para o servidor poder usar
                job.input = {
                  ...(job.input || {}),
                  known_words: subsetWords
                };
             }
          } catch (e) {
             console.error("[Dicionário Inteligente] Falha ao tentar otimizar com palavras conhecidas:", e);
          }
       }
    }

    return false;
  }

  private static async processReadingsAndTermsBatch(items: any[]) {
     if (items.length === 0) return;
     
     // 1. Load sentences
     const sentenceIds = items.map(item => item.job_id);
     const sentences = await SentenceRepository.getByIds(sentenceIds);
     const sentenceMap = new Map(sentences.map(s => [s.id, s]));

     // Salva kana/romaji imediatamente. A leitura não pode depender de a IA ter
     // devolvido uma lista perfeita de termos; caso contrário o job parece
     // concluído, mas a frase continua sem leitura.
     for (const item of items) {
        if (item.romaji && typeof item.romaji === 'string') {
           item.romaji = item.romaji.toLowerCase();
        }
        const sentence = sentenceMap.get(item.job_id);
        if (!sentence || sentence.status === 'reviewed') continue;
        if (item.kana && item.romaji && typeof item.kana === 'string' && typeof item.romaji === 'string') {
           const newStatus = (sentence.portuguese || item.portuguese) ? 'reading_ready' : sentence.status;
           await SentenceRepository.update(item.job_id, {
              kana: item.kana,
              romaji: item.romaji,
              status: newStatus,
              reading_source: 'ai'
           });
        }
     }
     
     // 2. Extract and sanitize all term candidates
     const allTempTerms: any[] = [];
     for (const item of items) {
        const sentence = sentenceMap.get(item.job_id);
        if (!sentence) continue;
        
        if (item.terms && Array.isArray(item.terms)) {
           for (const term of item.terms) {
              if (!term.surface || !term.lemma) continue;
              const cleanSurface = term.surface.trim();
              if (!cleanSurface) continue;
              
              let sIdx = typeof term.start_index === 'number' ? term.start_index : parseInt(term.start_index);
              let eIdx = typeof term.end_index === 'number' ? term.end_index : parseInt(term.end_index);
              
              const currentSubstring = (sentence.japanese || '').substring(sIdx, eIdx);
              if (isNaN(sIdx) || isNaN(eIdx) || currentSubstring !== cleanSurface) {
                 let bestStart = -1;
                 let minDiff = Infinity;
                 let pos = sentence.japanese.indexOf(cleanSurface);
                 while (pos !== -1) {
                    const diff = isNaN(sIdx) ? pos : Math.abs(pos - sIdx);
                    if (diff < minDiff) {
                       minDiff = diff;
                       bestStart = pos;
                    }
                    pos = sentence.japanese.indexOf(cleanSurface, pos + 1);
                 }
                 
                 if (bestStart !== -1) {
                    sIdx = bestStart;
                    eIdx = bestStart + cleanSurface.length;
                 } else {
                    sIdx = sentence.japanese.indexOf(cleanSurface);
                    eIdx = sIdx !== -1 ? sIdx + cleanSurface.length : -1;
                 }
              }
              if (sIdx === -1) continue;
              
              const entryType = term.type || 'outro';
              const uniqueKey = generateDictionaryUniqueKey(term.lemma, term.kana || null, entryType);
              
              allTempTerms.push({
                 sentence_id: sentence.id,
                 surface: cleanSurface,
                 lemma: term.lemma,
                 kana: term.kana || null,
                 romaji: term.romaji || null,
                 type: entryType,
                 start_index: sIdx,
                 end_index: eIdx,
                 context_meaning: term.context_meaning || null,
                 grammar_note: term.grammar_note || null,
                 structure_note: term.structure_note || null,
                 components: term.components || null,
                 is_expression: term.is_expression || false,
                 uniqueKey: uniqueKey
              });
           }
        }
     }
     
     // Post-process allTempTerms to automatically fill in any gaps containing Japanese letters
      const processedTempTerms: any[] = [];
      const termsBySentenceId = new Map<string, any[]>();
      for (const t of allTempTerms) {
         if (!termsBySentenceId.has(t.sentence_id)) {
            termsBySentenceId.set(t.sentence_id, []);
         }
         termsBySentenceId.get(t.sentence_id)!.push(t);
      }

      for (const [sentId, sTerms] of termsBySentenceId.entries()) {
         const sentence = sentenceMap.get(sentId);
         if (!sentence) {
            processedTempTerms.push(...sTerms);
            continue;
         }
         
         sTerms.sort((a, b) => a.start_index - b.start_index);
         const sentText = sentence.japanese || '';
         let lastEnd = 0;
         
         for (const term of sTerms) {
            if (term.start_index > lastEnd) {
               const gapText = sentText.substring(lastEnd, term.start_index);
               if (/[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(gapText)) {
                  let cleanGap = gapText.trim();
                  cleanGap = cleanGap.replace(/^[\s。、！？・『』()（）"'"“”:;+\-*\/\\_~]+|[\s。、！？・『』()（）"'"“”:;+\-*\/\\_~]+$/g, '').trim();
                  if (cleanGap.length > 0 && /[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(cleanGap)) {
                     const cleanStart = lastEnd + gapText.indexOf(cleanGap);
                     const cleanEnd = cleanStart + cleanGap.length;
                     const uniqueKey = generateDictionaryUniqueKey(cleanGap, null, 'outro');
                     processedTempTerms.push({
                        sentence_id: sentence.id,
                        surface: cleanGap,
                        lemma: cleanGap,
                        kana: null,
                        romaji: null,
                        type: 'outro',
                        start_index: cleanStart,
                        end_index: cleanEnd,
                        context_meaning: 'Termo extraído',
                        grammar_note: 'Auto-recuperado de lacuna',
                        structure_note: null,
                        components: null,
                        is_expression: false,
                        uniqueKey: uniqueKey
                     });
                  }
               }
            }
            processedTempTerms.push(term);
            lastEnd = Math.max(lastEnd, term.end_index);
         }
         
         if (lastEnd < sentText.length) {
            const gapText = sentText.substring(lastEnd);
            if (/[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(gapText)) {
               let cleanGap = gapText.trim();
               cleanGap = cleanGap.replace(/^[\s。、！？・『』()（）"'"“”:;+\-*\/\\_~]+|[\s。、！？・『』()（）"'"“”:;+\-*\/\\_~]+$/g, '').trim();
               if (cleanGap.length > 0 && /[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(cleanGap)) {
                  const cleanStart = lastEnd + gapText.indexOf(cleanGap);
                  const cleanEnd = cleanStart + cleanGap.length;
                  const uniqueKey = generateDictionaryUniqueKey(cleanGap, null, 'outro');
                  processedTempTerms.push({
                     sentence_id: sentence.id,
                     surface: cleanGap,
                     lemma: cleanGap,
                     kana: null,
                     romaji: null,
                     type: 'outro',
                     start_index: cleanStart,
                     end_index: cleanEnd,
                     context_meaning: 'Termo extraído',
                     grammar_note: 'Auto-recuperado de lacuna',
                     structure_note: null,
                     components: null,
                     is_expression: false,
                     uniqueKey: uniqueKey
                  });
               }
            }
         }
      }

      // Reassign to allTempTerms
      allTempTerms.length = 0;
      allTempTerms.push(...processedTempTerms);

      if (allTempTerms.length === 0) {
         for (const item of items) {
            const sentence = sentenceMap.get(item.job_id);
            if (!sentence || sentence.status === 'reviewed') continue;
            await SentenceRepository.update(item.job_id, { terms_source: 'ai_empty' });
         }
         return;
      }
     
     // 4. Load ALL existing dictionary entries to find local matches
     const allDicts = await DictionaryRepository.getAll();
     const dictMap = new Map<string, any>();
     const dictByLemma = new Map<string, any[]>();
     for (const d of allDicts) {
        dictMap.set(d.unique_key, d);
        if (!dictByLemma.has(d.lemma)) dictByLemma.set(d.lemma, []);
        dictByLemma.get(d.lemma)!.push(d);
     }
     
     // 5. Gather missing dictionary entries
     const newDictsToInsertMap = new Map<string, any>();
     for (const term of allTempTerms) {
        let existing = dictMap.get(term.uniqueKey);
        if (!existing && dictByLemma.has(term.lemma)) {
           existing = dictByLemma.get(term.lemma)!.find(e => e.type === term.type);
        }
        
        if (!existing && !newDictsToInsertMap.has(term.uniqueKey)) {
           const initialTags = term.grammar_note === 'Auto-recuperado de lacuna' ? ['auto_recuperado'] : [];
           newDictsToInsertMap.set(term.uniqueKey, {
              user_id: AuthService.getCurrentUserId(),
              lemma: term.lemma,
              kana: term.kana || null,
              romaji: term.romaji || null,
              type: term.type,
              main_meaning: null,
              meanings: [],
              tags: initialTags,
              jlpt_level: null,
              status: 'pending',
              unique_key: term.uniqueKey
           });
        }
     }
     
     // 6. Insert new dictionary entries at once ("ao concluir o processo")
     if (newDictsToInsertMap.size > 0) {
        const freshDicts = await DictionaryRepository.getAll();
        const freshKeys = new Set(freshDicts.map(d => d.unique_key));
        
        const finalDictsToInsert = Array.from(newDictsToInsertMap.values()).filter(d => !freshKeys.has(d.unique_key));
        
        if (finalDictsToInsert.length > 0) {
           const inserted = await DictionaryRepository.addBatch(finalDictsToInsert);
           for (const d of inserted) {
              dictMap.set(d.unique_key, d);
           }
        } else {
           for (const d of freshDicts) {
              if (!dictMap.has(d.unique_key)) {
                 dictMap.set(d.unique_key, d);
              }
           }
        }
     }
     
     // 7. Map temp terms to dictionary entry IDs and prepare batch insert
     const termsToInsert: any[] = [];
     for (const term of allTempTerms) {
        let existing = dictMap.get(term.uniqueKey);
        
        if (!existing && dictByLemma.has(term.lemma)) {
           existing = dictByLemma.get(term.lemma)!.find(e => e.type === term.type);
        }
        
        if (existing) {
           termsToInsert.push({
              user_id: AuthService.getCurrentUserId(),
              sentence_id: term.sentence_id,
              dictionary_entry_id: existing.id,
              surface: term.surface,
              lemma: term.lemma,
              kana: term.kana,
              romaji: term.romaji,
              start_index: term.start_index,
              end_index: term.end_index,
              type: term.type,
              confidence: 1.0,
              status: 'detected',
              context_meaning: term.context_meaning,
              grammar_note: term.grammar_note,
              structure_note: term.structure_note,
              components: term.components,
              is_expression: term.is_expression
           });
        }
     }
     
     // 8. Unique-key deduplication before insert
     if (termsToInsert.length > 0) {
        const uniqueTermsMap = new Map<string, any>();
        for (const t of termsToInsert) {
           const k = `${t.sentence_id}_${t.surface}_${t.start_index}_${t.end_index}`;
           uniqueTermsMap.set(k, t);
        }
        const finalTermsToInsert = Array.from(uniqueTermsMap.values());
        if (finalTermsToInsert.length > 0) {
           // Delete all existing terms for these sentences in a single batch operation
           const sentenceIdsToClear = Array.from(new Set(finalTermsToInsert.map(t => t.sentence_id)));
           await TermRepository.deleteBySentenceIds(sentenceIdsToClear);
           
           await TermRepository.addBatch(finalTermsToInsert);
        }
     }
     
     // 9. Marca a origem dos termos depois que eles foram inseridos com sucesso.
     for (const item of items) {
        const sentence = sentenceMap.get(item.job_id);
        if (!sentence || sentence.status === 'reviewed') continue;
        await SentenceRepository.update(item.job_id, { terms_source: 'ai' });
     }
  }

  private static async applyJobResult(job: AiJob, result: any, ctx?: any) {
    if (job.type === 'batch_translate_sentences') {
        let applied_count = 0;
        let failed_count = 0;
        const errors_by_item: any = {};
        
        const sentenceIds = (result.items || []).map((i: any) => i.job_id);
        const sentences = await SentenceRepository.getByIds(sentenceIds);
        const sentenceMap = new Map(sentences.map(s => [s.id, s]));

        for (const item of result.items || []) {
           try {
              if (!item.translation || typeof item.translation !== 'string' || item.translation.trim() === '') throw new Error('Tradução vazia');
              if (item.translation.includes('{') && item.translation.includes('}')) throw new Error('Result contém JSON cru lixo técnico');
              const sentence = sentenceMap.get(item.job_id);
              if (sentence) {
                 if (sentence.status === 'reviewed') {
                    // Protected: do not overwrite manual edits
                    applied_count++;
                    continue;
                 }
                 if (sentence.japanese === item.translation) throw new Error('Tradução idêntica ao japonês');
                 const newStatus = (!sentence.kana || !sentence.romaji) ? 'translated' : 'reading_ready';
                 await SentenceRepository.update(sentence.id, { portuguese: item.translation, status: newStatus, translation_source: 'ai' });
                 applied_count++;
              } else {
                 throw new Error('Frase não encontrada');
              }
           } catch (err: any) {
              failed_count++;
              errors_by_item[item.job_id] = err.message;
           }
        }
        result.applied_count = applied_count;
        result.failed_count = failed_count;
        result.errors_by_item = errors_by_item;
    } else if (job.type === 'batch_analyze_sentences') {
        const items = result.items || [];
        let applied_count = 0;
        let failed_count = 0;
        const errors_by_item: any = {};
        
        try {
           await this.processReadingsAndTermsBatch(items);
           applied_count = items.length;
        } catch (err: any) {
           console.error("Erro ao aplicar processamento em lote:", err);
           for (const item of items) {
              try {
                 await this.processReadingsAndTermsBatch([item]);
                 applied_count++;
              } catch (itemErr: any) {
                 failed_count++;
                 errors_by_item[item.job_id] = itemErr.message;
              }
           }
        }
        
        result.applied_count = applied_count;
        result.failed_count = failed_count;
        result.errors_by_item = errors_by_item;
    } else if (job.type.startsWith('batch_enrich_dictionary')) {
        let applied_count = 0;
        let failed_count = 0;
        const errors_by_item: any = {};
        for (const item of result.items || []) {
           try {
              await this.applyJobResult({ type: 'enrich_dictionary_entry', target_id: item.job_id } as any, item);
              applied_count++;
           } catch (err: any) {
              failed_count++;
              errors_by_item[item.job_id] = err.message;
           }
        }
        result.applied_count = applied_count;
        result.failed_count = failed_count;
        result.errors_by_item = errors_by_item;
    } else if (job.type === 'translate_sentence') {
       if (!result.translation || typeof result.translation !== 'string' || result.translation.trim() === '') {
          throw new Error('Resultado inválido: tradução ausente.');
       }
       const sentence = await SentenceRepository.getById(job.target_id);
       if (sentence && sentence.japanese === result.translation) {
          throw new Error('Resultado inválido: tradução idêntica ao japonês.');
       }
       if (result.translation.includes('{') && result.translation.includes('}')) {
          throw new Error('Resultado inválido: contém JSON cru lixo técnico.');
       }
       if (sentence) {
          if (sentence.status === 'reviewed') return; // Protected!
          const newStatus = (!sentence.kana || !sentence.romaji) ? 'translated' : 'reading_ready';
          await SentenceRepository.update(job.target_id, { portuguese: result.translation, status: newStatus });
       }
    } else if (job.type === 'generate_sentence_reading') {
       if (!result.kana || !result.romaji || typeof result.kana !== 'string' || typeof result.romaji !== 'string') {
          throw new Error('Resultado inválido: leitura ausente ou mal formatada.');
       }
       if (result.kana.trim() === '' || result.romaji.trim() === '') {
          throw new Error('Resultado inválido: leitura vazia.');
       }
               const targetSentence = await SentenceRepository.getById(job.target_id);
        const sentenceText = targetSentence ? targetSentence.japanese : (job.input?.sentence || '');
        const hasJapaneseLetter = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(sentenceText || '');

        if (hasJapaneseLetter && !/[\u3040-\u30FF]/.test(result.kana)) {
           throw new Error('Resultado inválido: kana não contém hiragana/katakana.');
        }
       if (result.romaji === result.romaji.toUpperCase()) {
          throw new Error('Resultado inválido: romaji todo em caixa alta.');
       }
       if (result.romaji.length > 20 && !result.romaji.includes(' ')) {
          throw new Error('Resultado inválido: romaji de frase longa sem espaços.');
       }
       if (/[\u3040-\u30FF\u4E00-\u9FAF]/.test(result.romaji)) {
          {
              console.warn(`[Auto-Correction] Romaji contains Japanese characters: "${result.romaji}". Repairing from Kana...`);
              const repairRomaji = simpleKanaToRomaji(result.kana || '');
              if (repairRomaji && repairRomaji.trim() !== '') {
                 result.romaji = repairRomaji;
              } else {
                 result.romaji = result.romaji.replace(/[\u3040-\u30FF\u4E00-\u9FAF]/g, '').trim().replace(/\s+/g, ' ');
              }
           }
       }
       await this.processReadingsAndTermsBatch([{
          job_id: job.target_id,
          kana: result.kana,
          romaji: result.romaji,
          terms: result.terms
       }]);
 } else if (job.type === 'enrich_dictionary_entry') {
       if (!result.main_meaning || !result.type || typeof result.main_meaning !== 'string') {
          throw new Error('Resultado inválido: significado ou tipo ausente.');
       }
               const currentEntryForValidation = await DictionaryRepository.getById(job.target_id);
        const finalLemmaForValidation = currentEntryForValidation ? currentEntryForValidation.lemma : job.input?.lemma;
        const hasJapaneseLetter = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(finalLemmaForValidation || '');

        if (hasJapaneseLetter && result.kana && typeof result.kana === 'string' && !/[\u3040-\u30FF]/.test(result.kana)) {
           throw new Error('Resultado inválido: kana não contém hiragana/katakana.');
        }
       if (result.romaji && typeof result.romaji === 'string' && /[A-Z]/.test(result.romaji) && !/[a-z]/.test(result.romaji)) {
          throw new Error('Resultado inválido: romaji todo em caixa alta.');
       }
       
       let finalTags = [];
       if (Array.isArray(result.tags)) {
           finalTags = result.tags;
       } else if (typeof result.tags === 'string') {
           finalTags = result.tags.split(',').map((t: string) => t.trim());
       }

       const validType = VALID_DICT_TYPES.includes(result.type) ? result.type : 'outro';
       
       // Fetch current entry to safely preserve we have the lemma and recalculate its correct unique_key
       const currentEntry = await DictionaryRepository.getById(job.target_id);
       if (currentEntry && currentEntry.status === 'reviewed') {
          // Protected: do not overwrite manual edits
          return;
       }
       const finalLemma = currentEntry ? currentEntry.lemma : job.input?.lemma;
       const finalKana = result.kana || (currentEntry ? currentEntry.kana : null);
       const updatedUniqueKey = generateDictionaryUniqueKey(finalLemma, finalKana, validType);

        // Evita colisão de chave única fundindo registros duplicados se encontrados
        const existingConflict = await DictionaryRepository.getByUniqueKey(updatedUniqueKey);
        if (existingConflict && existingConflict.id !== job.target_id) {
           console.log(`[Colisão de chave única] Verbete duplicado com ID ${existingConflict.id}. Mesclando.`);
           const { supabase } = await import('../core/supabaseClient');
           if (supabase) {
              await supabase.from('sentence_terms')
                .update({ dictionary_entry_id: existingConflict.id })
                .eq('dictionary_entry_id', job.target_id)
                .eq('user_id', AuthService.getCurrentUserId());

              if (!existingConflict.main_meaning) {
                 await DictionaryRepository.update(existingConflict.id, {
                    main_meaning: result.main_meaning,
                    subtype: result.subtype || null,
                    components: result.components || null,
                    grammar_info: result.grammar_info || null,
                    common_forms: result.common_forms || null,
                    short_note: result.short_note || null,
                    meanings: Array.isArray(result.meanings) ? result.meanings : [result.main_meaning],
                    type: validType,
                    tags: finalTags,
                    jlpt_level: result.jlpt_level || null,
                    kana: finalKana,
                    romaji: result.romaji || existingConflict.romaji,
                    status: 'ai_enriched'
                 });
              }
              const { error: deleteErr } = await supabase.from('dictionary_entries')
                .delete()
                .eq('id', job.target_id)
                .eq('user_id', AuthService.getCurrentUserId());
              if (deleteErr) console.error("Erro ao deletar verbete colidido:", deleteErr);
           }
           return;
        }

       await DictionaryRepository.update(job.target_id, {
         main_meaning: result.main_meaning,
         subtype: result.subtype || null,
         components: result.components || null,
         grammar_info: result.grammar_info || null,
         common_forms: result.common_forms || null,
         short_note: result.short_note || null,
         meanings: Array.isArray(result.meanings) ? result.meanings : [result.main_meaning],
         type: validType,
         tags: finalTags,
         jlpt_level: result.jlpt_level || null,
         kana: finalKana,
         romaji: result.romaji || (currentEntry ? currentEntry.romaji : null),
         status: 'ai_enriched',
         unique_key: updatedUniqueKey
       });
    }
  }
}
