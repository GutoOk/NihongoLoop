import {
  DictionaryRepository,
  ProgressRepository,
  SentenceRepository,
  SourceRepository,
  StudySessionRepository,
} from "../../repositories";
import { DictionaryEntry, Source } from "../../types";

export type GuidedStudyPathId =
  | "smart"
  | "continue"
  | "review"
  | "source"
  | "difficult_words"
  | "custom";

export interface GuidedStudyPlan {
  sources: Source[];
  recommendedSourceId: string;
  recommendedSourceTitle: string;
  recommendedConfig: Record<string, unknown> | null;
  recommendedReason: string;
  dueWordCount: number;
  difficultWordCount: number;
  difficultSentenceCount: number;
  pendingWordCount: number;
  nextOffset: number;
}

const SHORT_SESSION_LIMIT = 15;

function isDue(dueAt?: string | null): boolean {
  if (!dueAt) return false;
  return new Date(dueAt).getTime() <= Date.now();
}

function hasMeaning(entry: DictionaryEntry): boolean {
  return Boolean(entry.main_meaning && entry.main_meaning.trim());
}

export class StudyPlanner {
  static async buildPlan(): Promise<GuidedStudyPlan> {
    const [sources, words, sentenceProgress, dictionaryProgress] = await Promise.all([
      SourceRepository.getAll(),
      DictionaryRepository.getAll(),
      ProgressRepository.getAllSentenceProgress(),
      ProgressRepository.getAllDictionaryProgress(),
    ]);

    const usableWords = words.filter(hasMeaning);
    const wordById = new Map(usableWords.map((word) => [word.id, word]));
    const dueWordIds = dictionaryProgress
      .filter((progress) => !progress.suspended && isDue(progress.due_at))
      .map((progress) => progress.dictionary_entry_id)
      .filter((id) => wordById.has(id));

    const difficultWordIds = dictionaryProgress
      .filter((progress) =>
        !progress.suspended &&
        wordById.has(progress.dictionary_entry_id) &&
        ((progress.wrong_count || 0) > 0 ||
          (progress.difficulty || 0) > 0 ||
          ((progress.seen_count || 0) > 0 && (progress.mastery || 0) < 50)),
      )
      .map((progress) => progress.dictionary_entry_id);

    const difficultSentenceCount = sentenceProgress.filter((progress) =>
      !progress.suspended &&
      ((progress.wrong_count || 0) > 0 ||
        (progress.difficulty || 0) > 0 ||
        ((progress.seen_count || 0) > 0 && (progress.mastery || 0) < 50)),
    ).length;

    const pendingWordCount = words.filter((word) => word.status === "pending" || !word.main_meaning).length;
    const continuity = await this.findContinuationSource(sources);

    let recommendedConfig: Record<string, unknown> | null = null;
    let recommendedReason = "Comece com uma sessão curta guiada.";

    if (dueWordIds.length > 0) {
      recommendedConfig = {
        entityType: "word",
        targetType: "review_due",
        limit: SHORT_SESSION_LIMIT,
        order: "due",
        studyMode: "meaning-jp",
      };
      recommendedReason = "Há palavras vencidas para revisar. Recuperação ativa vem primeiro.";
    } else if (difficultWordIds.length > 0) {
      recommendedConfig = {
        entityType: "word",
        targetType: "difficult_words",
        limit: SHORT_SESSION_LIMIT,
        order: "priority",
        studyMode: "meaning-jp",
      };
      recommendedReason = "Há palavras com erro ou baixa memória. Melhor reforçar antes de avançar.";
    } else if (continuity.sourceId) {
      recommendedReason = continuity.offset > 0
        ? "Continue a fonte no próximo bloco curto."
        : "Comece pela primeira fonte disponível.";
    }

    return {
      sources,
      recommendedSourceId: continuity.sourceId,
      recommendedSourceTitle: continuity.title,
      recommendedConfig,
      recommendedReason,
      dueWordCount: dueWordIds.length,
      difficultWordCount: difficultWordIds.length,
      difficultSentenceCount,
      pendingWordCount,
      nextOffset: continuity.offset,
    };
  }

  private static async findContinuationSource(sources: Source[]) {
    for (const source of sources) {
      const [offset, sentences] = await Promise.all([
        StudySessionRepository.getSourceOffset(source.id),
        SentenceRepository.getBySourceId(source.id),
      ]);
      if (sentences.length === 0) continue;
      if (offset < sentences.length) {
        return {
          sourceId: source.id,
          title: source.title || "Fonte sem título",
          offset,
        };
      }
    }

    return {
      sourceId: sources[0]?.id || "",
      title: sources[0]?.title || "",
      offset: 0,
    };
  }
}
