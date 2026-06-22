import React, { useEffect, useState, useRef } from "react";
import {
  X,
  Play,
  Pause,
  FastForward,
  Rewind,
  Star,
  AlertCircle,
  RefreshCw,
  Info,
  PictureInPicture,
  Edit2,
  Save,
  Plus,
  BookmarkPlus,
  Layers,
  Database as DatabaseIcon,
} from "lucide-react";
import {
  SentenceRepository,
  ProgressRepository,
  DictionaryRepository,
  DictionaryFormRepository,
  DictionarySenseRepository,
  TermRepository,
  SourceRepository,
} from "../repositories";
import { Sentence, DictionaryEntry, DictionaryForm, DictionarySense, DictionaryProgress, SentenceTerm, Source } from "../types";
import { SpeechService } from "../services/speechService";
import { Database } from "../database/db"; // for TTS settings
import { TERM_COLORS, getTermColor, isLowEmphasisTerm } from "../ui/termColors";
import { normalizeTermOffsets, sliceCodePoints, toCodePoints } from "../ui/termOffsets";
import { AppNavigate } from "../navigation";
import { drawStudyPipCanvas } from "./studyPlayer/pipCanvas";

interface StudySetupScreenProps {
  config: any;
  onBack: () => void;
  onNavigate?: AppNavigate;
  onFinishStandardFlow?: (sentenceIds: string[]) => void;
  isFinishingStandardFlow?: boolean;
}

type StudyItem = {
  id: string;
  japanese: string;
  kana?: string | null;
  romaji?: string | null;
  portuguese?: string | null;
  isFavorite: boolean;
  isDifficult: boolean;
  type: "sentence" | "word" | "word_context";
  targetWordId?: string;
  targetSurface?: string;
  rawRef: any;
};

export default function StudyPlayerScreen({
  config,
  onBack,
  onNavigate: parentNavigate,
  onFinishStandardFlow,
  isFinishingStandardFlow = false,
}: StudySetupScreenProps) {
  const [items, setItems] = useState<StudyItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentTerms, setCurrentTerms] = useState<any[]>([]);
  const [activeDictionaryPopup, setActiveDictionaryPopup] = useState<{
    term: any;
    entry: DictionaryEntry | null;
    forms?: DictionaryForm[];
    senses?: DictionarySense[];
    occurrences?: Array<{ sentence: Sentence; term: SentenceTerm; sourceTitle: string }>;
    sources?: Array<{ sourceId: string; title: string; count: number }>;
    progress?: DictionaryProgress | null;
    loading?: boolean;
  } | null>(null);
  const [showLegendModal, setShowLegendModal] = useState(false);
  const playActiveRef = useRef(false);

  // Active study item editing states
  const [isEditingActiveItem, setIsEditingActiveItem] = useState(false);
  const [editItemJapanese, setEditItemJapanese] = useState("");
  const [editItemKana, setEditItemKana] = useState("");
  const [editItemRomaji, setEditItemRomaji] = useState("");
  const [editItemPortuguese, setEditItemPortuguese] = useState("");
  const [editItemType, setEditItemType] = useState("");
  const [editItemJlpt, setEditItemJlpt] = useState("");

  const handleStartEditCurrentItem = () => {
    const active = items[currentIndex];
    if (!active) return;
    setIsPlaying(false);
    playActiveRef.current = false;
    SpeechService.stop();

    setEditItemJapanese(active.japanese || "");
    setEditItemKana(active.kana || "");
    setEditItemRomaji(active.romaji || "");
    setEditItemPortuguese(active.portuguese || "");
    
    if ((active.type === "word" || active.type === "word_context") && active.rawRef) {
      setEditItemType(active.rawRef.type || "");
      setEditItemJlpt(active.rawRef.jlpt_level || "");
    } else {
      setEditItemType("");
      setEditItemJlpt("");
    }
    setIsEditingActiveItem(true);
  };

  const handleSaveActiveItem = async () => {
    const active = items[currentIndex];
    if (!active) return;

    try {
      if (active.type === "sentence") {
        const updates = {
          japanese: editItemJapanese.trim(),
          kana: editItemKana.trim(),
          romaji: editItemRomaji.trim(),
          portuguese: editItemPortuguese.trim(),
          status: "reviewed" as const,
        };
        await SentenceRepository.update(active.id, updates);
        
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === currentIndex
              ? { ...it, ...updates, rawRef: { ...it.rawRef, ...updates } }
              : it
          )
        );
      } else {
        const updates = {
          lemma: editItemJapanese.trim(),
          kana: editItemKana.trim(),
          romaji: editItemRomaji.trim(),
          main_meaning: editItemPortuguese.trim(),
          type: editItemType.trim(),
          jlpt_level: editItemJlpt.trim(),
          status: "reviewed" as const,
        };
        const entryId = active.targetWordId || active.id;
        await DictionaryRepository.update(entryId, updates);

        setItems((prev) =>
          prev.map((it, idx) =>
            idx === currentIndex
              ? {
                  ...it,
                  japanese: editItemJapanese.trim(),
                  kana: editItemKana.trim(),
                  romaji: editItemRomaji.trim(),
                  portuguese: editItemPortuguese.trim(),
                  rawRef: { ...it.rawRef, ...updates },
                }
              : it
          )
        );
      }

      setIsEditingActiveItem(false);
      if (active.type === "sentence") {
        const terms = await TermRepository.getBySentence(active.id);
        setCurrentTerms(terms);
      }
    } catch (e) {
      console.error(e);
      alert("Erro ao salvar alterações no banco de dados.");
    }
  };

  const openDictionaryPanel = async (term: any, entryHint?: DictionaryEntry | null) => {
    const entryId = entryHint?.id || term?.dictionary_entry_id || term?.id;
    let entry = entryHint || null;
    let forms: DictionaryForm[] = [];
    let senses: DictionarySense[] = [];
    let occurrences: Array<{ sentence: Sentence; term: SentenceTerm; sourceTitle: string }> = [];
    let sources: Array<{ sourceId: string; title: string; count: number }> = [];
    let progress: DictionaryProgress | null = null;

    setActiveDictionaryPopup({ term, entry, forms, senses, occurrences, sources, progress, loading: Boolean(entryId) });

    if (entryId) {
      const [loadedEntry, loadedForms, loadedSenses, allTerms, loadedProgress] = await Promise.all([
        entry ? Promise.resolve(entry) : DictionaryRepository.getById(entryId),
        DictionaryFormRepository.getByEntryId(entryId),
        DictionarySenseRepository.getByEntryId(entryId),
        TermRepository.getByDictionaryEntry(entryId),
        ProgressRepository.getDictionaryProgress(entryId),
      ]);
      entry = loadedEntry;
      forms = loadedForms;
      senses = loadedSenses;
      progress = loadedProgress;

      const sentenceIds = Array.from(new Set(allTerms.map((t) => t.sentence_id)));
      const relatedSentences = await SentenceRepository.getByIds(sentenceIds);
      const sentenceMap = new Map(relatedSentences.map((sentence) => [sentence.id, sentence]));
      const sourceCounts = new Map<string, number>();
      for (const sentence of relatedSentences) {
        sourceCounts.set(sentence.source_id, (sourceCounts.get(sentence.source_id) || 0) + 1);
      }
      const sourceRows = await Promise.all(
        Array.from(sourceCounts.keys()).map((id) => SourceRepository.getById(id)),
      );
      const sourceTitleMap = new Map(
        sourceRows.filter((item): item is Source => Boolean(item)).map((item) => [item.id, item.title]),
      );
      occurrences = allTerms
        .map((item) => {
          const sentence = sentenceMap.get(item.sentence_id);
          if (!sentence) return null;
          return {
            sentence,
            term: item,
            sourceTitle: sourceTitleMap.get(sentence.source_id) || "Fonte sem titulo",
          };
        })
        .filter((item): item is { sentence: Sentence; term: SentenceTerm; sourceTitle: string } => Boolean(item));
      sources = Array.from(sourceCounts.entries())
        .map(([sourceId, count]) => ({
          sourceId,
          count,
          title: sourceTitleMap.get(sourceId) || "Fonte sem titulo",
        }))
        .sort((a, b) => b.count - a.count);
    }

    setActiveDictionaryPopup({ term, entry, forms, senses, occurrences, sources, progress, loading: false });
  };

  // Picture-in-Picture feature support
  const [isPipActive, setIsPipActive] = useState(false);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const drawPipCanvas = () => {
    const canvas = pipCanvasRef.current;
    if (!canvas) return;

    const currentItem = items[currentIndex];
    if (!currentItem) return;

    drawStudyPipCanvas({
      canvas,
      item: currentItem,
      currentIndex,
      totalItems: items.length,
      isPlaying,
    });
  };

  const togglePictureInPicture = async () => {
    if (isPipActive) {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
      setIsPipActive(false);
      return;
    }

    try {
      let canvas = pipCanvasRef.current;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        pipCanvasRef.current = canvas;
      }

      drawPipCanvas();

      let video = pipVideoRef.current;
      if (!video) {
        video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        const stream = (canvas as any).captureStream(10);
        video.srcObject = stream;
        pipVideoRef.current = video;
      }

      await video.play();
      await video.requestPictureInPicture();
      setIsPipActive(true);

      video.addEventListener("leavepictureinpicture", () => {
        setIsPipActive(false);
      });
    } catch (err) {
      console.error("Picture-in-Picture activation error:", err);
      alert("Infelizmente o recurso Picture-in-Picture não é compatível com esse dispositivo ou navegador, ou requer permissões de reprodução adicionais.");
    }
  };

  useEffect(() => {
    if (isPipActive) {
      drawPipCanvas();
    }
  }, [currentIndex, isPlaying, items, isPipActive]);

  useEffect(() => {
    // Clear previous terms synchronously to prevent weird layout mismatch while loading
    setCurrentTerms([]);

    const fetchTermsForCurrentInstance = async () => {
      if (items.length > 0 && items[currentIndex]) {
        const current = items[currentIndex];
        if (current.type === "sentence" || current.type === "word_context") {
          try {
            const t = await TermRepository.getBySentence(current.id);
            t.sort((a, b) => (a.start_index || 0) - (b.start_index || 0));
            setCurrentTerms(t);
          } catch (e) {
            console.error(e);
            setCurrentTerms([]);
          }
        } else {
          setCurrentTerms([]);
        }
      } else {
        setCurrentTerms([]);
      }
    };
    fetchTermsForCurrentInstance();
  }, [currentIndex, items]);

  const loadItems = async () => {
    setLoading(true);
    let loadedItems: StudyItem[] = [];

    if (config.entityType === "word") {
      let entries = (await DictionaryRepository.getPage({ limit: Math.min(Math.max(config.limit || 1000, 100), 1000) })).entries;
      let limitForWords = config.limit;
      if (Array.isArray(config.entryIds) && config.entryIds.length > 0) {
        entries = await DictionaryRepository.getByIds(config.entryIds);
        limitForWords = config.entryIds.length;
      } else if (config.targetType === "specific" && config.wordId) {
        entries = entries.filter((e) => e.id === config.wordId);
      } else {
        if (config.targetType === "pending")
          entries = entries.filter((e) => e.status === "pending");
        if (config.targetType === "reviewed")
          entries = entries.filter((e) => e.status === "reviewed");
        if (config.targetType === "ai_enriched")
          entries = entries.filter((e) => e.status === "ai_enriched");
        if (config.targetType === "verb")
          entries = entries.filter((e) => e.type.toLowerCase() === "verbo");
        if (config.targetType === "particle")
          entries = entries.filter((e) => e.type.toLowerCase() === "partícula");
        if (config.targetType === "proper_noun")
          entries = entries.filter(
            (e) => e.type.toLowerCase() === "nome próprio",
          );
        if (config.targetType === "expression")
          entries = entries.filter((e) => e.type.toLowerCase() === "expressão");
        if (config.targetType === "no_meaning")
          entries = entries.filter((e) => !e.main_meaning);

        if ((config.targetType === "source" && config.sourceId) || (config.targetType === "source_group" && Array.isArray(config.sourceIds))) {
          const sourceSents = Array.isArray(config.sourceIds) && config.sourceIds.length > 0
            ? await SentenceRepository.getBySourceIds(config.sourceIds)
            : await SentenceRepository.getBySourceId(config.sourceId);
          const sourceSentIds = sourceSents.map((s) => s.id);
          const terms = await TermRepository.getBySentences(sourceSentIds);
          const validEntryIds = new Set(
            terms.map((t) => t.dictionary_entry_id).filter(Boolean),
          );
          entries = entries.filter((e) => validEntryIds.has(e.id));
        }

        if (config.targetType === "custom_word_filter") {
          // Filter by source
          if (config.sourceId || (Array.isArray(config.sourceIds) && config.sourceIds.length > 0)) {
            let sourceSents = Array.isArray(config.sourceIds) && config.sourceIds.length > 0
              ? await SentenceRepository.getBySourceIds(config.sourceIds)
              : await SentenceRepository.getBySourceId(config.sourceId);
            const sourceSentIds = sourceSents.map((s) => s.id);
            let terms = await TermRepository.getBySentences(sourceSentIds);

            if ((!terms || terms.length === 0) && config.sourceId) {
              const { TermDetectionService } =
                await import("../services/termDetectionService");
              await TermDetectionService.detectWordsInSource(config.sourceId);
              terms = await TermRepository.getBySentences(sourceSentIds);
            }

            const validEntryIds = new Set(
              terms.map((t) => t.dictionary_entry_id).filter(Boolean),
            );
            entries = await DictionaryRepository.getByIds(Array.from(validEntryIds) as string[]);
            entries = entries.filter((e) => validEntryIds.has(e.id));
          }

          // Filter by type
          if (config.filterWordType && config.filterWordType !== "all") {
            if (config.filterWordType === "sem_significado") {
              entries = entries.filter((e) => !e.main_meaning);
            } else {
              entries = entries.filter(
                (e) => e.type.toLowerCase() === config.filterWordType,
              );
            }
          }

          // Filter by JLPT level
          if (config.filterWordLevel && config.filterWordLevel !== "all") {
            entries = entries.filter(
              (e) => e.jlpt_level === config.filterWordLevel,
            );
          }
        }

        if (config.targetType === "standard_word_flow" && config.sourceId) {
          const _offset = config.offset || 0;
          const _limit = config.limit || 10;
          let sourceSents = await SentenceRepository.getBySourceId(
            config.sourceId,
          );
          sourceSents = sourceSents.slice(_offset, _offset + _limit);
          const sourceSentIds = sourceSents.map((s) => s.id);

          let terms = await TermRepository.getBySentences(sourceSentIds);

          if (!terms || terms.length === 0) {
            const { TermDetectionService } =
              await import("../services/termDetectionService");
            await TermDetectionService.detectWordsInSentences(sourceSentIds);
            terms = await TermRepository.getBySentences(sourceSentIds);
          }

          const validEntryIds = new Set(
            terms.map((t) => t.dictionary_entry_id).filter(Boolean),
          );
          entries = await DictionaryRepository.getByIds(Array.from(validEntryIds) as string[]);
          entries = entries.filter((e) => validEntryIds.has(e.id) && e.main_meaning);
          // Do not slice the resulting words by the sentence limit
          limitForWords = 9999;
        }
      }

      if (config.order === "random") {
        entries.sort(() => Math.random() - 0.5);
      }
      if (limitForWords && limitForWords < entries.length) {
        entries = entries.slice(0, limitForWords);
      }

      loadedItems = entries.map((e) => ({
        id: e.id,
        type: "word",
        japanese: e.lemma,
        kana: e.kana,
        romaji: e.romaji,
        portuguese: e.main_meaning,
        isFavorite: false,
        isDifficult: false,
        rawRef: e,
      }));
    } else if (config.entityType === "word_context") {
      const terms = await TermRepository.getByDictionaryEntry(config.wordId);
      const contextsRaw = await Promise.all(terms.map(async (t) => {
        const s = await SentenceRepository.getById(t.sentence_id);
        return s ? { s, t } : null;
      }));
      let contexts = contextsRaw.filter(Boolean) as { s: Sentence, t: any }[];

      if (config.order === "random") {
        contexts.sort(() => Math.random() - 0.5);
      }
      if (config.limit && config.limit < contexts.length) {
        contexts = contexts.slice(0, config.limit);
      }

      loadedItems = contexts.map((ctx) => ({
        id: ctx.s.id,
        type: "word_context",
        japanese: ctx.s.japanese,
        kana: ctx.s.kana,
        romaji: ctx.s.romaji,
        portuguese: ctx.s.portuguese,
        isFavorite: ctx.s.favorite || false,
        isDifficult: ctx.s.difficulty && ctx.s.difficulty > 0 ? true : false,
        targetWordId: config.wordId,
        targetSurface: ctx.t.surface,
        rawRef: ctx.s,
      }));
    } else {
      // sentences
      let sents: Sentence[] = [];
      if (Array.isArray(config.sentenceIds) && config.sentenceIds.length > 0) {
        const orderedIds = config.sentenceIds as string[];
        const byId = new Map((await SentenceRepository.getByIds(orderedIds)).map((sentence) => [sentence.id, sentence]));
        sents = orderedIds.map((id) => byId.get(id)).filter((item): item is Sentence => Boolean(item));
      } else if (
        (config.targetType === "source" ||
          config.targetType === "source_group" ||
          config.targetType === "standard_flow") &&
        (config.sourceId || (Array.isArray(config.sourceIds) && config.sourceIds.length > 0))
      ) {
        sents = Array.isArray(config.sourceIds) && config.sourceIds.length > 0
          ? await SentenceRepository.getBySourceIds(config.sourceIds)
          : await SentenceRepository.getBySourceId(config.sourceId);
      } else {
        sents = await SentenceRepository.getPage(0, Math.min(Math.max(config.limit || 100, 50), 500));
      }

      if (config.targetType === "favorites") {
        sents = sents.filter((s) => s.favorite);
      } else if (config.targetType === "difficult") {
        sents = sents.filter((s) => s.difficulty && s.difficulty > 0);
      } else if (config.targetType === "new") {
        const progressList =
          await ProgressRepository.getSentenceProgressForSentences(
            sents.map((s) => s.id),
          );
        const seenIds = new Set(
          progressList
            .filter((p) => p.seen_count && p.seen_count > 0)
            .map((p) => p.sentence_id),
        );
        sents = sents.filter((s) => !seenIds.has(s.id));
      } else if (config.targetType === "untranslated") {
        sents = sents.filter((s) => !s.portuguese);
      } else if (config.targetType === "unread") {
        sents = sents.filter((s) => !s.kana && !s.romaji);
      }

      if (config.targetType === "standard_flow") {
        const _offset = config.offset || 0;
        const _limit = config.limit || 10;
        sents = sents.slice(_offset, _offset + _limit);
      } else {
        if (config.order === "random") {
          sents.sort(() => Math.random() - 0.5);
        }
        if (config.limit && config.limit < sents.length) {
          sents = sents.slice(0, config.limit);
        }
      }

      loadedItems = sents.map((s) => ({
        id: s.id,
        type: "sentence",
        japanese: s.japanese,
        kana: s.kana,
        romaji: s.romaji,
        portuguese: s.portuguese,
        isFavorite: s.favorite || false,
        isDifficult: s.difficulty && s.difficulty > 0 ? true : false,
        rawRef: s,
      }));
    }

    setItems(loadedItems);
    setLoading(false);
  };

  useEffect(() => {
    loadItems();
    return () => {
      playActiveRef.current = false;
      SpeechService.stop();
    };
  }, [JSON.stringify(config)]);

  const handleToggleFavorite = async () => {
    if (!items[currentIndex]) return;
    const item = items[currentIndex];
    if (item.type === "sentence") {
      const updated = !item.isFavorite;
      await ProgressRepository.upsertSentenceProgress({
        sentence_id: item.id,
        favorite: updated,
      });
      setItems((prev) =>
        prev.map((s, i) =>
          i === currentIndex ? { ...s, isFavorite: updated } : s,
        ),
      );
    }
  };

  const handleToggleDifficulty = async () => {
    if (!items[currentIndex]) return;
    const item = items[currentIndex];
    if (item.type === "sentence") {
      const nextDiff = item.isDifficult ? 0 : 1;
      await ProgressRepository.upsertSentenceProgress({
        sentence_id: item.id,
        difficulty: nextDiff,
      });
      setItems((prev) =>
        prev.map((s, i) =>
          i === currentIndex ? { ...s, isDifficult: nextDiff === 1 } : s,
        ),
      );
    }
  };

  const loopIdRef = useRef(0);

  const executePlayLoop = async (index: number) => {
    if (!playActiveRef.current || !items[index]) return;

    loopIdRef.current++;
    const currentLoopId = loopIdRef.current;
    const isCurrentLoop = () =>
      playActiveRef.current && currentLoopId === loopIdRef.current;

    const item = items[index];
    const settings = Database.getSettings();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Update progress seen
    if (item.type === "sentence") {
      const existingProg = await ProgressRepository.getSentenceProgress(
        item.id,
      );
      if (!existingProg) {
        await ProgressRepository.upsertSentenceProgress({
          sentence_id: item.id,
          mastery: 10,
          seen_count: 1,
          last_seen_at: new Date().toISOString(),
        });
      } else {
        await ProgressRepository.upsertSentenceProgress({
          id: existingProg.id,
          sentence_id: item.id,
          mastery: Math.min(100, (existingProg.mastery || 0) + 5),
          seen_count: existingProg.seen_count + 1,
          last_seen_at: new Date().toISOString(),
        });
      }
    } else {
      const targetId =
        item.type === "word_context" && item.targetWordId
          ? item.targetWordId
          : item.id;
      const existingProg =
        await ProgressRepository.getDictionaryProgress(targetId);
      if (!existingProg) {
        await ProgressRepository.upsertDictionaryProgress({
          dictionary_entry_id: targetId,
          mastery: 10,
          seen_count: 1,
          last_seen_at: new Date().toISOString(),
        });
      } else {
        await ProgressRepository.upsertDictionaryProgress({
          id: existingProg.id,
          dictionary_entry_id: targetId,
          mastery: Math.min(100, (existingProg.mastery || 0) + 5),
          seen_count: existingProg.seen_count + 1,
          last_seen_at: new Date().toISOString(),
        });
      }
    }

    const { studyMode } = config;
    const sJa = settings.speedJa || 1;
    const sPt = settings.speedPt || 1;
    const pSpeech = (settings.pauseBetweenSpeeches || 0.5) * 1000;
    const pItems = (settings.pauseBetweenItems || 1.5) * 1000;

    const speakAndWait = async (text: string, lang: "ja" | "pt") => {
      if (!isCurrentLoop()) return;
      return new Promise<void>((resolve) => {
        if (lang === "ja")
          SpeechService.speakJapaneseText(text, sJa, () => resolve());
        else SpeechService.speakPortugueseText(text, sPt, () => resolve());
      });
    };

    if (studyMode === "jp-pt") {
      await speakAndWait(item.japanese, "ja");
      if (isCurrentLoop()) await sleep(pSpeech);
      if (item.portuguese) await speakAndWait(item.portuguese, "pt");
    } else if (studyMode === "pt-jp") {
      if (item.portuguese) await speakAndWait(item.portuguese, "pt");
      if (isCurrentLoop()) await sleep(pSpeech);
      await speakAndWait(item.japanese, "ja");
    } else if (studyMode === "pt-jp-jp") {
      if (item.portuguese) await speakAndWait(item.portuguese, "pt");
      if (isCurrentLoop()) await sleep(pSpeech);
      await speakAndWait(item.japanese, "ja");
      if (isCurrentLoop()) await sleep(pSpeech);
      await speakAndWait(item.japanese, "ja");
    } else if (studyMode === "jp-repeat") {
      await speakAndWait(item.japanese, "ja");
      if (isCurrentLoop()) await sleep(pSpeech);
      await speakAndWait(item.japanese, "ja");
    } else {
      // shadowing
      await speakAndWait(item.japanese, "ja");
    }

    if (!isCurrentLoop()) return;
    await sleep(pItems);

    if (isCurrentLoop()) {
      if (index + 1 < items.length) {
        setCurrentIndex(index + 1);
      } else {
        setIsPlaying(false);
        playActiveRef.current = false;
      }
    }
  };

  useEffect(() => {
    if (isPlaying) {
      executePlayLoop(currentIndex);
    }
  }, [currentIndex, isPlaying]);

  const togglePlay = () => {
    if (isPlaying) {
      SpeechService.stop();
      playActiveRef.current = false;
      setIsPlaying(false);
    } else {
      playActiveRef.current = true;
      setIsPlaying(true);
      // It will trigger useEffect for executing loop
    }
  };

  const nextItem = () => {
    if (currentIndex < items.length - 1) {
      SpeechService.stop();
      setCurrentIndex((c) => c + 1);
    }
  };

  const prevItem = () => {
    if (currentIndex > 0) {
      SpeechService.stop();
      setCurrentIndex((c) => c - 1);
    }
  };

  const addPopupWordToFlashcards = async () => {
    const entryId = activeDictionaryPopup?.entry?.id;
    if (!entryId) {
      alert("Esta palavra ainda nao possui verbete para virar flashcard.");
      return;
    }
    const saved = await ProgressRepository.setDictionaryProgressFields(
      entryId,
      { favorite: true, suspended: false },
      activeDictionaryPopup.progress || null,
    );
    setActiveDictionaryPopup((current) => (current ? { ...current, progress: saved } : current));
  };

  const studyPopupWordAsSource = () => {
    const entryId = activeDictionaryPopup?.entry?.id;
    if (!entryId || !parentNavigate) return;
    setActiveDictionaryPopup(null);
    parentNavigate("study_player", {
      config: {
        entityType: "word_context",
        targetType: "specific",
        wordId: entryId,
        limit: 30,
        order: "original",
        studyMode: "jp-pt",
      },
    });
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-xs">
        Carregando sessão...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4 bg-white text-[#1D1D1F]">
        <AlertCircle className="w-10 h-10 text-gray-300" />
        <p className="text-sm font-bold">
          Nenhum item encontrado para esta configuração.
        </p>
        <button
          onClick={onBack}
          className="px-5 py-2 bg-indigo-600 text-white rounded-lg font-bold text-[10px] uppercase tracking-wider"
        >
          Voltar e Reconfigurar
        </button>
      </div>
    );
  }

  const item = items[currentIndex];

  const renderStudyJapanese = (itm: StudyItem) => {
    if (!currentTerms || currentTerms.length === 0) {
      if (itm.type === "word" && itm.rawRef) {
        return (
          <button
            onClick={() => {
              if (isPlaying) {
                SpeechService.stop();
                playActiveRef.current = false;
                setIsPlaying(false);
              }
              void openDictionaryPanel(
                { surface: itm.japanese, type: itm.rawRef.type },
                itm.rawRef,
              );
            }}
            className="hover:text-indigo-600 transition-colors cursor-pointer underline decoration-indigo-200 decoration-2 underline-offset-4"
          >
            {itm.japanese}
          </button>
        );
      }
      return <span>{itm.japanese}</span>;
    }

    const txt = itm.japanese;
    const elements: React.ReactNode[] = [];
    let lastIdx = 0;

    const filteredTerms = normalizeTermOffsets(txt, currentTerms);
    filteredTerms.forEach((term, idx) => {
      if (term.start_index > lastIdx) {
        elements.push(
          <span key={`text-${lastIdx}`}>
            {sliceCodePoints(txt, lastIdx, term.start_index)}
          </span>,
        );
      }

      const termColor = getTermColor(term.type);
      const cleanBg = termColor.bg
        .split(" ")
        .filter((c) => !c.startsWith("hover:"))
        .join(" ");
      const lowEmphasis = isLowEmphasisTerm(term.type);
      const termClassName = lowEmphasis
        ? `${termColor.text} border-b border-dotted border-current rounded-none px-0 py-0 font-normal text-2xl md:text-3xl cursor-pointer active:scale-95 transition-transform outline-none`
        : `${termColor.text} ${cleanBg} border-b-2 border-dotted border-current rounded px-1.5 py-0.5 mx-[2px] font-black text-2xl md:text-3xl inline-block cursor-pointer active:scale-95 transition-transform outline-none`;

      elements.push(
        <button
          key={`term-${term.id || idx}`}
          onClick={async (e) => {
            e.stopPropagation();
            if (isPlaying) {
              SpeechService.stop();
              playActiveRef.current = false;
              setIsPlaying(false);
            }
            if (term.dictionary_entry_id) {
              await openDictionaryPanel(term);
            }
          }}
          className={termClassName}
        >
          {sliceCodePoints(txt, term.start_index, term.end_index)}
        </button>,
      );
      lastIdx = term.end_index;
    });

    if (lastIdx < toCodePoints(txt).length) {
      elements.push(<span key={`text-end`}>{sliceCodePoints(txt, lastIdx, toCodePoints(txt).length)}</span>);
    }

    return <>{elements}</>;
  };

  return (
    <div className="flex flex-col h-full bg-white text-slate-900 overflow-hidden relative">
      <header className="px-6 py-5 flex items-center justify-between shrink-0 border-b border-slate-100">
        <button
          onClick={() => {
            playActiveRef.current = false;
            SpeechService.stop();
            onBack();
          }}
          className="p-2 -ml-2 text-slate-400 hover:text-slate-900 transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
        <div className="text-[10px] font-mono tracking-widest text-slate-400 uppercase">
          {currentIndex + 1} / {items.length}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowLegendModal(true)}
            className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors"
            title="Legenda de Cores"
            id="btn-show-legend"
          >
            <Info className="w-5 h-5" />
          </button>
          {item.type === "sentence" && (
            <>
              <button
                onClick={handleToggleDifficulty}
                className={`text-slate-300 hover:text-slate-600 transition-colors ${item.isDifficult ? "text-rose-500 hover:text-rose-600" : ""}`}
              >
                <AlertCircle
                  className={`w-5 h-5 ${item.isDifficult ? "fill-current" : ""}`}
                />
              </button>
              <button
                onClick={handleToggleFavorite}
                className={`text-slate-300 hover:text-slate-600 transition-colors ${item.isFavorite ? "text-amber-500 hover:text-amber-600" : ""}`}
              >
                <Star
                  className={`w-5 h-5 ${item.isFavorite ? "fill-current" : ""}`}
                />
              </button>
            </>
          )}
          <button
            onClick={togglePictureInPicture}
            className={`p-1.5 transition-colors ${
              isPipActive ? "text-indigo-600 hover:text-indigo-700 font-bold" : "text-slate-400 hover:text-slate-600"
            }`}
            title="Picture in Picture (Mini-tela)"
            id="btn-toggle-pip"
          >
            <PictureInPicture className="w-5 h-5" />
          </button>
          <button
            onClick={handleStartEditCurrentItem}
            className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors"
            title="Editar Ficha Atual"
            id="btn-edit-active-item"
          >
            <Edit2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col justify-center items-center px-6 text-center space-y-8 select-none">
        <div className="w-full space-y-2">
          <div
            className={`${item.type === "word" ? "text-4xl" : "text-3xl"} font-black tracking-tight text-slate-900 break-words leading-tight`}
          >
            {renderStudyJapanese(item)}
          </div>
          {item.kana && (
            <div className="text-xs font-semibold tracking-widest text-[#86868B] pt-1">
              {item.kana}
            </div>
          )}
          {item.romaji && (
            <div className="text-[11px] font-mono tracking-widest text-slate-400 pt-1 uppercase">
              {item.romaji}
            </div>
          )}
        </div>

        <div className="pt-8 w-full max-w-sm mx-auto border-t border-slate-100">
          {item.portuguese ? (
            <div className="text-sm font-bold text-slate-800 bg-slate-50/70 py-4 px-6 rounded-2xl border border-slate-100">
              {item.portuguese}
            </div>
          ) : (
            <div className="text-[10px] text-slate-400 italic uppercase tracking-widest">
              Sem {item.type === "word" ? "significado" : "tradução"}
            </div>
          )}
        </div>
      </main>

      <footer className="shrink-0 pb-10 pt-6 px-8 border-t border-slate-100 bg-slate-50/40">
        <div className="flex items-center justify-center gap-8 mb-6">
          <button
            id="study-btn-prev"
            onClick={prevItem}
            disabled={currentIndex === 0}
            className="p-3 text-slate-400 hover:text-indigo-600 disabled:opacity-20 transition-colors"
          >
            <Rewind className="w-6 h-6" />
          </button>
          <button
            id="study-btn-play"
            onClick={togglePlay}
            className="w-16 h-16 bg-indigo-600 hover:bg-indigo-700 shrink-0 hover:scale-105 active:scale-95 text-white rounded-full flex items-center justify-center transition-all shadow-[0_10px_25px_rgba(99,102,241,0.25)]"
          >
            {isPlaying ? (
              <Pause className="w-7 h-7 fill-current" />
            ) : (
              <Play className="w-7 h-7 fill-current ml-1" />
            )}
          </button>
          <button
            id="study-btn-next"
            onClick={nextItem}
            disabled={currentIndex === items.length - 1}
            className="p-3 text-slate-400 hover:text-indigo-600 disabled:opacity-20 transition-colors"
          >
            <FastForward className="w-6 h-6" />
          </button>
        </div>

        {(config.targetType === "standard_flow" ||
          config.targetType === "standard_word_flow") &&
          currentIndex === items.length - 1 && (
            <div className="flex justify-center mt-4">
              <button
                id="study-btn-advance-quiz"
                onClick={() => {
                  if (isFinishingStandardFlow) return;
                  if (onFinishStandardFlow) {
                    onFinishStandardFlow(items.map((i) => i.id));
                  }
                }}
                disabled={isFinishingStandardFlow}
                className="w-full max-w-sm py-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 disabled:opacity-60 disabled:cursor-wait font-bold rounded-2xl flex items-center justify-center gap-2 uppercase tracking-wider text-xs transition-colors border border-indigo-200"
              >
                {isFinishingStandardFlow ? "Preparando Quiz..." : "Avançar para o Quiz"} <FastForward className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
      </footer>

      {/* Side dictionary panel when clicking a word */}
      {activeDictionaryPopup && (
        <div
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl"
        >
          <div
            className="flex h-full flex-col overflow-y-auto text-gray-900"
          >
            <div className="relative shrink-0 border-b border-slate-100 p-4 text-center space-y-1">
              <button
                onClick={() => setActiveDictionaryPopup(null)}
                className="absolute right-3 top-3 rounded-lg p-2 text-[0px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Fechar painel da palavra"
              >
                <X className="h-4 w-4" />
                ✕
              </button>
              {activeDictionaryPopup?.entry?.kana && (
                <p className="text-xs text-slate-400 font-medium tracking-wide">
                  {activeDictionaryPopup.entry.kana}
                </p>
              )}
              <h3 className="text-3xl font-black text-slate-900">
                {activeDictionaryPopup?.entry?.lemma ||
                  activeDictionaryPopup?.term?.surface ||
                  activeDictionaryPopup?.term?.japanese ||
                  ""}
              </h3>
              {activeDictionaryPopup?.entry?.romaji && (
                <p className="text-[10px] font-mono text-slate-400 uppercase pt-1 tracking-widest">
                  {activeDictionaryPopup.entry.romaji}
                </p>
              )}
            </div>

            <div className="space-y-4 p-4">
              <div className="bg-indigo-50/70 p-4 rounded-lg text-center border border-indigo-100/30">
                {activeDictionaryPopup?.entry?.main_meaning ? (
                  <span className="text-sm font-bold text-indigo-900">
                    {activeDictionaryPopup.entry.main_meaning}
                  </span>
                ) : (
                  <span className="text-xs text-indigo-400 italic">
                    Sem significado cadastrado
                  </span>
                )}
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <span className="bg-slate-100 px-3 py-1 rounded-full text-[10px] font-mono font-bold text-slate-500 uppercase">
                  {activeDictionaryPopup?.entry?.type ||
                    activeDictionaryPopup?.term?.type ||
                    "Outro"}
                </span>
                {activeDictionaryPopup?.entry?.subtype && (
                  <span className="bg-indigo-50 px-3 py-1 rounded-full text-[10px] font-mono font-bold text-indigo-700 uppercase">
                    {activeDictionaryPopup.entry.subtype}
                  </span>
                )}
                {activeDictionaryPopup?.entry?.jlpt_level && (
                  <span className="bg-emerald-50 px-3 py-1 rounded-full text-[10px] font-mono font-black text-emerald-800 uppercase">
                    {activeDictionaryPopup.entry.jlpt_level}
                  </span>
                )}
              </div>

              {activeDictionaryPopup.loading && (
                <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 p-4 text-xs font-bold text-slate-500">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Carregando dados da palavra
                </div>
              )}

              {getPanelMeanings(activeDictionaryPopup).length > 1 && (
                <PanelSection title="Acepcoes">
                  <ol className="space-y-2">
                    {getPanelMeanings(activeDictionaryPopup).map((meaning, idx) => (
                      <li key={`${meaning}-${idx}`} className="flex gap-2 text-xs font-semibold leading-relaxed text-slate-700">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-black text-indigo-700">
                          {idx + 1}
                        </span>
                        <span>{meaning}</span>
                      </li>
                    ))}
                  </ol>
                </PanelSection>
              )}

              {activeDictionaryPopup?.entry?.short_note && (
                <PanelSection title="Nota rapida">
                  <p className="text-xs font-semibold leading-relaxed text-amber-950">
                    {activeDictionaryPopup.entry.short_note}
                  </p>
                </PanelSection>
              )}

              {(activeDictionaryPopup?.entry?.grammar_info || activeDictionaryPopup?.entry?.subtype) && (
                <PanelSection title="Regras de uso e gramatica">
                  {activeDictionaryPopup?.entry?.subtype && (
                    <p className="text-xs font-bold text-indigo-800">
                      {activeDictionaryPopup.entry.type} - {activeDictionaryPopup.entry.subtype}
                    </p>
                  )}
                  {activeDictionaryPopup?.entry?.grammar_info && (
                    <p className="whitespace-pre-wrap text-xs font-semibold leading-relaxed text-slate-700">
                      {activeDictionaryPopup.entry.grammar_info}
                    </p>
                  )}
                </PanelSection>
              )}

              {activeDictionaryPopup?.senses && activeDictionaryPopup.senses.length > 0 && (
                <PanelSection title="Sentidos detalhados">
                  {activeDictionaryPopup.senses.map((sense) => (
                    <div key={sense.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-black text-slate-900">{sense.meaning}</span>
                        {sense.meaning_type && (
                          <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                            {sense.meaning_type}
                          </span>
                        )}
                      </div>
                      {sense.explanation && (
                        <p className="mt-2 text-xs font-semibold leading-relaxed text-slate-600">
                          {sense.explanation}
                        </p>
                      )}
                      {(sense.example_japanese || sense.example_portuguese) && (
                        <div className="mt-2 rounded-lg bg-white p-2 text-xs">
                          {sense.example_japanese && <p className="font-black text-slate-900">{sense.example_japanese}</p>}
                          {sense.example_portuguese && <p className="mt-1 font-medium text-slate-500">{sense.example_portuguese}</p>}
                        </div>
                      )}
                    </div>
                  ))}
                </PanelSection>
              )}

              {activeDictionaryPopup?.entry?.components &&
                Array.isArray(activeDictionaryPopup.entry.components) &&
                activeDictionaryPopup.entry.components.length > 0 && (
                  <PanelSection title="Estrutura dos ideogramas">
                    <div className="space-y-2">
                      {activeDictionaryPopup.entry.components.map((component: any, idx: number) => (
                        <div key={`${component.kanji || idx}`} className="flex items-center gap-3 rounded-lg border border-teal-100 bg-teal-50/50 p-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-2xl font-black text-teal-700">
                            {component.kanji}
                          </div>
                          <div className="min-w-0">
                            {component.reading && (
                              <p className="text-[9px] font-bold uppercase tracking-wide text-teal-600">
                                {component.reading}
                              </p>
                            )}
                            <p className="truncate text-xs font-black text-slate-800">
                              {component.meaning}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </PanelSection>
                )}

              {activeDictionaryPopup?.forms && activeDictionaryPopup.forms.length > 0 && (
                <PanelSection title="Formas e inflexoes">
                  <div className="flex flex-wrap gap-2">
                    {activeDictionaryPopup.forms.map((form) => (
                      <span
                        key={form.id}
                        className="rounded-lg border border-orange-100 bg-orange-50 px-3 py-2 text-xs font-bold text-orange-950"
                        title={form.grammar_note || undefined}
                      >
                        {form.form}
                        {form.form_type && <span className="ml-1 text-[9px] uppercase text-orange-500">{form.form_type}</span>}
                      </span>
                    ))}
                  </div>
                </PanelSection>
              )}

              {activeDictionaryPopup?.occurrences && activeDictionaryPopup.occurrences.length > 0 && (
                <PanelSection title={`Frases de exemplo (${activeDictionaryPopup.occurrences.length})`}>
                  {activeDictionaryPopup.occurrences.slice(0, 12).map(({ sentence, term, sourceTitle }) => (
                    <div key={`${sentence.id}-${term.id}`} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <p className="text-[9px] font-black uppercase text-slate-400">{sourceTitle}</p>
                      <p className="mt-1 text-sm font-black text-slate-900">{sentence.japanese}</p>
                      {sentence.portuguese && (
                        <p className="mt-1 text-xs font-medium leading-relaxed text-slate-600">{sentence.portuguese}</p>
                      )}
                      {term.context_meaning && (
                        <p className="mt-2 rounded bg-white px-2 py-1 text-[10px] font-bold text-indigo-800">{term.context_meaning}</p>
                      )}
                    </div>
                  ))}
                </PanelSection>
              )}

              {activeDictionaryPopup?.sources && activeDictionaryPopup.sources.length > 0 && (
                <PanelSection title={`Textos e fontes (${activeDictionaryPopup.sources.length})`}>
                  {activeDictionaryPopup.sources.map((source) => (
                    <div key={source.sourceId} className="flex items-center justify-between gap-3 rounded-lg border border-purple-100 bg-purple-50/40 p-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <DatabaseIcon className="h-4 w-4 shrink-0 text-purple-500" />
                        <span className="truncate text-xs font-bold text-slate-700">{source.title}</span>
                      </div>
                      <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-black text-purple-700">{source.count}</span>
                    </div>
                  ))}
                </PanelSection>
              )}
            </div>

            <div className="p-4 pt-0 space-y-2">
              {activeDictionaryPopup?.entry && (
                <button
                  type="button"
                  onClick={() => void addPopupWordToFlashcards()}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-3.5 rounded-xl uppercase tracking-widest transition-colors shadow-md flex items-center justify-center gap-2"
                >
                  <BookmarkPlus className="h-4 w-4" />
                  {activeDictionaryPopup.progress?.favorite ? "No baralho de flashcards" : "Adicionar ao baralho"}
                </button>
              )}
              {activeDictionaryPopup?.entry && parentNavigate && (
                <button
                  type="button"
                  onClick={studyPopupWordAsSource}
                  className="w-full bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-700 text-xs font-bold py-3.5 rounded-xl uppercase tracking-widest transition-colors shadow-sm flex items-center justify-center gap-2"
                >
                  <Layers className="h-4 w-4" />
                  Usar como fonte de estudos
                </button>
              )}
              {activeDictionaryPopup?.entry && parentNavigate && (
                <button
                  onClick={() => {
                    setActiveDictionaryPopup(null);
                    parentNavigate("dictionary_entry", {
                      entryId: activeDictionaryPopup.entry.id,
                    });
                  }}
                  className="w-full bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-xs font-bold py-3.5 rounded-xl uppercase tracking-widest transition-colors shadow-sm"
                >
                  Editar ficha
                </button>
              )}
              <button
                onClick={() => setActiveDictionaryPopup(null)}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-3.5 rounded-xl uppercase tracking-widest transition-colors shadow-md"
              >
                Fechar painel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Legend modal listing all grammatical color codings */}
      {showLegendModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => setShowLegendModal(false)}
        >
          <div
            className="bg-white rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-4 text-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center relative">
              <button
                onClick={() => setShowLegendModal(false)}
                className="absolute -top-1 -right-1 text-gray-400 p-2 hover:bg-gray-100 rounded-full transition-colors"
                id="btn-close-legend"
              >
                ✕
              </button>
              <h3 className="text-lg font-black uppercase tracking-wider text-slate-800">
                Legenda de Cores
              </h3>
              <p className="text-xs text-gray-400">
                Identificação por cores aplicada nas palavras das lições e
                estudo
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 max-h-[350px] overflow-y-auto p-1 text-left">
              {Object.entries(TERM_COLORS).map(([key, item]) => (
                <div
                  key={key}
                  className={`p-2.5 rounded-2xl ${item.bg} flex flex-col justify-between h-[72px] transition-all`}
                >
                  <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest leading-none mb-1">
                    {item.name}
                  </span>
                  <span
                    className={`${item.text} font-black text-sm tracking-wide mt-auto leading-none truncate`}
                  >
                    {key === "substantivo"
                      ? "人 (pessoa)"
                      : key === "verbo"
                        ? "落ちる (cair)"
                        : key === "adjetivo"
                          ? "静か (calmo)"
                          : key === "partícula"
                            ? "とも (partícula)"
                            : "サンプル"}
                  </span>
                </div>
              ))}
            </div>

            <div className="pt-2 text-center text-[10px] text-gray-400 italic">
              Clique em qualquer palavra colorida para abrir o minidicionário e
              ver o significado.
            </div>

            <div className="pt-2">
              <button
                onClick={() => setShowLegendModal(false)}
                className="w-full bg-slate-950 hover:bg-slate-900 text-white text-xs font-bold py-3.5 rounded-xl uppercase tracking-widest transition-colors shadow-lg cursor-pointer"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active study item editing modal overlay */}
      {isEditingActiveItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45"
          onClick={() => setIsEditingActiveItem(false)}
        >
          <div
            className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-4 text-slate-800 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center border-b border-gray-100 pb-2">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  Editar {item?.type === "sentence" ? "Frase" : "Palavra"}
                </h3>
                <p className="text-[10px] text-gray-400">Corrige dados e atualiza em tempo real no áudio e texto</p>
              </div>
              <button
                onClick={() => setIsEditingActiveItem(false)}
                className="text-gray-400 p-1.5 hover:text-rose-500 rounded-lg transition-colors"
                type="button"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 max-h-[380px] overflow-y-auto pr-1">
              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-slate-400 font-mono">Original (Japonês)</label>
                <input
                  type="text"
                  value={editItemJapanese}
                  onChange={(e) => setEditItemJapanese(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E5E5E7] rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-slate-400 font-mono">Kana (Leitura)</label>
                <input
                  type="text"
                  value={editItemKana}
                  onChange={(e) => setEditItemKana(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E5E5E7] rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-slate-400 font-mono">Romaji</label>
                <input
                  type="text"
                  value={editItemRomaji}
                  onChange={(e) => setEditItemRomaji(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E5E5E7] rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs"
                />
              </div>

              {item?.type !== "sentence" && (
                <div className="grid grid-cols-2 gap-3.5">
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-bold text-slate-400 font-mono">Categoria</label>
                    <select
                      value={editItemType}
                      onChange={(e) => setEditItemType(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white border border-[#E5E5E7] rounded-xl outline-none font-bold text-slate-700"
                    >
                      <option value="substantivo">Substantivo</option>
                      <option value="verbo">Verbo</option>
                      <option value="adjetivo">Adjetivo</option>
                      <option value="advérbio">Advérbio</option>
                      <option value="partícula">Partícula</option>
                      <option value="pronome">Pronome</option>
                      <option value="expressão">Expressão</option>
                      <option value="conector">Conector</option>
                      <option value="outro">Outro</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-bold text-slate-400 font-mono">Nível JLPT</label>
                    <select
                      value={editItemJlpt}
                      onChange={(e) => setEditItemJlpt(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white border border-[#E5E5E7] rounded-xl outline-none font-bold text-slate-700"
                    >
                      <option value="">Nenhum/Outro</option>
                      <option value="N5">N5</option>
                      <option value="N4">N4</option>
                      <option value="N3">N3</option>
                      <option value="N2">N2</option>
                      <option value="N1">N1</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-slate-400 font-mono">Significado PT</label>
                <input
                  type="text"
                  value={editItemPortuguese}
                  onChange={(e) => setEditItemPortuguese(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#E5E5E7] rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                />
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setIsEditingActiveItem(false)}
                className="flex-1 py-3 text-xs bg-gray-50 hover:bg-gray-100 font-bold border border-gray-200 text-slate-500 rounded-xl transition-colors font-mono uppercase tracking-wider"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveActiveItem}
                className="flex-1 py-3 text-xs bg-emerald-600 hover:bg-emerald-700 font-bold text-white rounded-xl transition-all shadow-md flex items-center justify-center gap-1 font-mono uppercase tracking-wider active:scale-95"
              >
                <Save className="w-3.5 h-3.5" /> Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getPanelMeanings(selection: {
  entry: DictionaryEntry | null;
  senses?: DictionarySense[];
}) {
  const values = [
    selection.entry?.main_meaning,
    ...(selection.senses || []).map((sense) => sense.meaning),
  ].filter((value): value is string => Boolean(value && value.trim()));
  return Array.from(new Set(values)).slice(0, 8);
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 text-left">
      <h4 className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
        {title}
      </h4>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
