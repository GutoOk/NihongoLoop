import {
  DictionaryRepository,
  ProgressRepository,
  SentenceRepository,
  SourceRepository,
  StudySessionRepository,
} from "../../repositories";
import { DictionaryEntry, Source, StudySession } from "../../types";
import { StudySessionConfig } from "./studyTypes";

export interface GuidedStudyPlan {
  sources: Source[];
  savedCustomSessions: StudySession[];
  recommendedSourceId: string;
  recommendedSourceTitle: string;
  recommendedConfig: StudySessionConfig | null;
  recommendedReason: string;
  dueWordCount: number;
  difficultWordCount: number;
  difficultSentenceCount: number;
  pendingWordCount: number;
  nextOffset: number;
}

const DEFAULT_LIMIT = 15;

function isDue(dueAt?: string | null): boolean {
  return Boolean(dueAt && new Date(dueAt).getTime() <= Date.now());
}

function hasMeaning(entry: DictionaryEntry): boolean {
  return Boolean(entry.main_meaning && entry.main_meaning.trim());
}

export class StudyPlanner {
  static async buildPlan(): Promise<GuidedStudyPlan> {
    const [sources, words, sentenceProgress, dictionaryProgress, savedCustomSessions] = await Promise.all([
      SourceRepository.getAll(),
      DictionaryRepository.getAll(),
      ProgressRepository.getAllSentenceProgress(),
      ProgressRepository.getAllDictionaryProgress(),
      StudySessionRepository.getSavedCustomSessions(),
    ]);

    const usableWordIds = new Set(words.filter(hasMeaning).map((word) => word.id));
    const dueWordCount = dictionaryProgress.filter((progress) =>
      !progress.suspended &&
      usableWordIds.has(progress.dictionary_entry_id) &&
      isDue(progress.due_at),
    ).length;
    const difficultWordCount = dictionaryProgress.filter((progress) =>
      !progress.suspended &&
      usableWordIds.has(progress.dictionary_entry_id) &&
      ((progress.wrong_count || 0) > 0 ||
        (progress.difficulty || 0) > 0 ||
        ((progress.seen_count || 0) > 0 && (progress.mastery || 0) < 50)),
    ).length;
    const difficultSentenceCount = sentenceProgress.filter((progress) =>
      !progress.suspended &&
      ((progress.wrong_count || 0) > 0 ||
        (progress.difficulty || 0) > 0 ||
        ((progress.seen_count || 0) > 0 && (progress.mastery || 0) < 50)),
    ).length;
    const pendingWordCount = words.filter((word) => word.status === "pending" || !word.main_meaning).length;
    const continuity = await this.findContinuationSource(sources);

    let recommendedConfig: StudySessionConfig | null = null;
    let recommendedReason = "Sessão curta com pouco atrito para manter constância.";

    if (dueWordCount > 0) {
      recommendedConfig = {
        entityType: "word",
        targetType: "review_due",
        limit: DEFAULT_LIMIT,
        order: "due",
        studyMode: "meaning-jp",
        title: "Revisão vencida",
      };
      recommendedReason = "Há palavras prontas para revisão espaçada. Recuperar da memória vem antes de conteúdo novo.";
    } else if (difficultWordCount > 0) {
      recommendedConfig = {
        entityType: "word",
        targetType: "difficult_words",
        limit: DEFAULT_LIMIT,
        order: "priority",
        studyMode: "meaning-jp",
        title: "Palavras difíceis",
      };
      recommendedReason = "Há palavras com erro ou baixa memória. Reforçar agora evita acumular lacunas.";
    } else if (continuity.sourceId) {
      recommendedReason = continuity.offset > 0
        ? "Continue a fonte em um bloco curto, com contexto e quiz ao final."
        : "Comece pela primeira fonte disponível, em um bloco curto e guiado.";
    }

    return {
      sources,
      savedCustomSessions,
      recommendedSourceId: continuity.sourceId,
      recommendedSourceTitle: continuity.title,
      recommendedConfig,
      recommendedReason,
      dueWordCount,
      difficultWordCount,
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
      if (sentences.length > 0 && offset < sentences.length) {
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
