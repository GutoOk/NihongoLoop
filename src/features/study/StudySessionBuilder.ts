import {
  DictionaryRepository,
  ProgressRepository,
  SentenceRepository,
  TermRepository,
} from "../../repositories";
import { DictionaryEntry, DictionaryProgress, Sentence } from "../../types";
import { StudyItem, StudySessionBuildResult, StudySessionConfig } from "./studyTypes";

function hasMeaning(entry: DictionaryEntry): boolean {
  return Boolean(entry.main_meaning && entry.main_meaning.trim());
}

function isDue(progress?: DictionaryProgress | null): boolean {
  return Boolean(progress?.due_at && new Date(progress.due_at).getTime() <= Date.now());
}

function wordDifficultyScore(entry: DictionaryEntry, progress?: DictionaryProgress | null): number {
  if (!progress) return 0;
  return (
    (progress.wrong_count || 0) * 12 +
    (progress.difficulty || 0) * 8 +
    Math.max(0, 60 - (progress.mastery || 0)) +
    (entry.status === "pending" ? 5 : 0)
  );
}

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

export class StudySessionBuilder {
  static async build(config: StudySessionConfig): Promise<StudySessionBuildResult> {
    const warnings: string[] = [];
    let items: StudyItem[] = [];

    if (config.entityType === "word") {
      items = await this.buildWordItems(config, warnings);
    } else if (config.entityType === "word_context") {
      items = await this.buildWordContextItems(config, warnings);
    } else {
      items = await this.buildSentenceItems(config, warnings);
    }

    if (items.length === 0) {
      warnings.push("Nenhum item encontrado para esta sessão.");
    }

    return { items, warnings };
  }

  private static async buildWordItems(config: StudySessionConfig, warnings: string[]): Promise<StudyItem[]> {
    let entries = await DictionaryRepository.getAll();
    const progressList = await ProgressRepository.getAllDictionaryProgress();
    const progressMap = new Map(progressList.map((progress) => [progress.dictionary_entry_id, progress]));
    let limitForWords = config.limit;

    if (config.targetType === "specific" && config.wordId) {
      entries = entries.filter((entry) => entry.id === config.wordId);
    } else {
      if (config.targetType === "review_due") {
        entries = entries.filter((entry) => hasMeaning(entry) && isDue(progressMap.get(entry.id)));
      }
      if (config.targetType === "difficult_words") {
        entries = entries.filter((entry) => hasMeaning(entry) && wordDifficultyScore(entry, progressMap.get(entry.id)) > 0);
      }
      if (config.targetType === "pending") entries = entries.filter((entry) => entry.status === "pending");
      if (config.targetType === "reviewed") entries = entries.filter((entry) => entry.status === "reviewed");
      if (config.targetType === "ai_enriched") entries = entries.filter((entry) => entry.status === "ai_enriched");
      if (config.targetType === "verb") entries = entries.filter((entry) => entry.type.toLowerCase() === "verbo");
      if (config.targetType === "particle") entries = entries.filter((entry) => entry.type.toLowerCase() === "partícula");
      if (config.targetType === "proper_noun") entries = entries.filter((entry) => entry.type.toLowerCase() === "nome próprio");
      if (config.targetType === "expression") entries = entries.filter((entry) => entry.type.toLowerCase() === "expressão");
      if (config.targetType === "no_meaning") entries = entries.filter((entry) => !entry.main_meaning);

      if (config.targetType === "source" && config.sourceId) {
        entries = await this.filterWordsBySource(entries, config.sourceId);
      }

      if (config.targetType === "custom_word_filter") {
        if (config.sourceId) entries = await this.filterWordsBySource(entries, config.sourceId);
        if (config.filterWordType && config.filterWordType !== "all") {
          if (config.filterWordType === "sem_significado") {
            entries = entries.filter((entry) => !entry.main_meaning);
          } else {
            entries = entries.filter((entry) => entry.type.toLowerCase() === config.filterWordType);
          }
        }
        if (config.filterWordLevel && config.filterWordLevel !== "all") {
          entries = entries.filter((entry) => entry.jlpt_level === config.filterWordLevel);
        }
      }

      if (config.targetType === "standard_word_flow" && config.sourceId) {
        const sourceSents = await SentenceRepository.getBySourceId(config.sourceId);
        const block = sourceSents.slice(config.offset || 0, (config.offset || 0) + (config.limit || 10));
        entries = await this.filterWordsBySentences(entries, block.map((sentence) => sentence.id), true);
        entries = entries.filter(hasMeaning);
        limitForWords = 9999;
      }
    }

    entries = this.orderWords(entries, progressMap, config.order);
    if (limitForWords && limitForWords < entries.length) entries = entries.slice(0, limitForWords);

    if (entries.some((entry) => !entry.main_meaning)) {
      warnings.push("Algumas palavras ainda não têm significado e podem render estudo mais fraco.");
    }

    return entries.map((entry) => ({
      id: entry.id,
      type: "word" as const,
      japanese: entry.lemma,
      kana: entry.kana,
      romaji: entry.romaji,
      portuguese: entry.main_meaning,
      isFavorite: false,
      isDifficult: Boolean((progressMap.get(entry.id)?.difficulty || 0) > 0),
      rawRef: entry,
    }));
  }

  private static async buildWordContextItems(config: StudySessionConfig, warnings: string[]): Promise<StudyItem[]> {
    if (!config.wordId) return [];
    const terms = await TermRepository.getByDictionaryEntry(config.wordId);
    const contextsRaw = await Promise.all(terms.map(async (term) => {
      const sentence = await SentenceRepository.getById(term.sentence_id);
      return sentence ? { sentence, term } : null;
    }));
    let contexts = contextsRaw.filter(Boolean) as { sentence: Sentence; term: any }[];
    if (contexts.length === 0) warnings.push("Esta palavra ainda não tem frases relacionadas.");
    if (config.order === "random") contexts = shuffle(contexts);
    if (config.limit && config.limit < contexts.length) contexts = contexts.slice(0, config.limit);

    return contexts.map(({ sentence, term }) => ({
      id: sentence.id,
      type: "word_context" as const,
      japanese: sentence.japanese,
      kana: sentence.kana,
      romaji: sentence.romaji,
      portuguese: sentence.portuguese,
      isFavorite: sentence.favorite || false,
      isDifficult: Boolean(sentence.difficulty && sentence.difficulty > 0),
      targetWordId: config.wordId || undefined,
      targetSurface: term.surface,
      rawRef: sentence,
    }));
  }

  private static async buildSentenceItems(config: StudySessionConfig, warnings: string[]): Promise<StudyItem[]> {
    let sentences = (config.targetType === "source" || config.targetType === "standard_flow") && config.sourceId
      ? await SentenceRepository.getBySourceId(config.sourceId)
      : await SentenceRepository.getAll();

    if (config.targetType === "favorites") {
      sentences = sentences.filter((sentence) => sentence.favorite);
    } else if (config.targetType === "difficult") {
      sentences = sentences.filter((sentence) => sentence.difficulty && sentence.difficulty > 0);
    } else if (config.targetType === "new") {
      const progressList = await ProgressRepository.getSentenceProgressForSentences(sentences.map((sentence) => sentence.id));
      const seenIds = new Set(progressList.filter((progress) => progress.seen_count > 0).map((progress) => progress.sentence_id));
      sentences = sentences.filter((sentence) => !seenIds.has(sentence.id));
    } else if (config.targetType === "untranslated") {
      sentences = sentences.filter((sentence) => !sentence.portuguese);
    } else if (config.targetType === "unread") {
      sentences = sentences.filter((sentence) => !sentence.kana && !sentence.romaji);
    }

    if (sentences.some((sentence) => !sentence.portuguese)) warnings.push("Há frases sem tradução neste conjunto.");
    if (sentences.some((sentence) => !sentence.kana && !sentence.romaji)) warnings.push("Há frases sem leitura neste conjunto.");

    if (config.targetType === "standard_flow") {
      sentences = sentences.slice(config.offset || 0, (config.offset || 0) + (config.limit || 10));
    } else {
      if (config.order === "random") sentences = shuffle(sentences);
      if (config.limit && config.limit < sentences.length) sentences = sentences.slice(0, config.limit);
    }

    return sentences.map((sentence) => ({
      id: sentence.id,
      type: "sentence" as const,
      japanese: sentence.japanese,
      kana: sentence.kana,
      romaji: sentence.romaji,
      portuguese: sentence.portuguese,
      isFavorite: sentence.favorite || false,
      isDifficult: Boolean(sentence.difficulty && sentence.difficulty > 0),
      rawRef: sentence,
    }));
  }

  private static async filterWordsBySource(entries: DictionaryEntry[], sourceId: string): Promise<DictionaryEntry[]> {
    const sourceSents = await SentenceRepository.getBySourceId(sourceId);
    return this.filterWordsBySentences(entries, sourceSents.map((sentence) => sentence.id), true);
  }

  private static async filterWordsBySentences(
    entries: DictionaryEntry[],
    sentenceIds: string[],
    detectIfEmpty: boolean,
  ): Promise<DictionaryEntry[]> {
    let terms = await TermRepository.getBySentences(sentenceIds);
    let sourceEntries = entries;
    if (detectIfEmpty && (!terms || terms.length === 0)) {
      const { TermDetectionService } = await import("../../services/termDetectionService");
      await TermDetectionService.detectWordsInSentences(sentenceIds);
      terms = await TermRepository.getBySentences(sentenceIds);
      sourceEntries = await DictionaryRepository.getAll();
    }
    const validEntryIds = new Set(terms.map((term) => term.dictionary_entry_id).filter(Boolean));
    return sourceEntries.filter((entry) => validEntryIds.has(entry.id));
  }

  private static orderWords(
    entries: DictionaryEntry[],
    progressMap: Map<string, DictionaryProgress>,
    order: string | undefined,
  ): DictionaryEntry[] {
    if (order === "due") {
      return [...entries].sort((a, b) => {
        const aDue = progressMap.get(a.id)?.due_at || "";
        const bDue = progressMap.get(b.id)?.due_at || "";
        return aDue.localeCompare(bDue);
      });
    }
    if (order === "priority") {
      return [...entries].sort((a, b) => wordDifficultyScore(b, progressMap.get(b.id)) - wordDifficultyScore(a, progressMap.get(a.id)));
    }
    if (order === "random") return shuffle(entries);
    return entries;
  }
}
