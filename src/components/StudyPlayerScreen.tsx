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
} from "lucide-react";
import {
  SentenceRepository,
  ProgressRepository,
  DictionaryRepository,
  TermRepository,
} from "../repositories";
import { Sentence, DictionaryEntry } from "../types";
import { SpeechService } from "../services/speechService";
import { Database } from "../database/db"; // for TTS settings

const TERM_COLORS: Record<
  string,
  { name: string; text: string; bg: string; border: string }
> = {
  substantivo: {
    name: "Substantivo",
    text: "text-indigo-700",
    bg: "bg-indigo-50 border border-indigo-200 hover:bg-indigo-100",
    border: "border-indigo-200",
  },
  verbo: {
    name: "Verbo",
    text: "text-amber-700",
    bg: "bg-amber-50 border border-amber-200 hover:bg-amber-100",
    border: "border-amber-200",
  },
  adjetivo: {
    name: "Adjetivo",
    text: "text-rose-700",
    bg: "bg-rose-50 border border-rose-200 hover:bg-rose-100",
    border: "border-rose-200",
  },
  advérbio: {
    name: "Advérbio",
    text: "text-teal-700",
    bg: "bg-teal-50 border border-teal-200 hover:bg-teal-100",
    border: "border-teal-200",
  },
  partícula: {
    name: "Partícula",
    text: "text-emerald-700",
    bg: "bg-emerald-50 border border-emerald-200 hover:bg-emerald-100",
    border: "border-emerald-200",
  },
  pronome: {
    name: "Pronome",
    text: "text-sky-700",
    bg: "bg-sky-50 border border-sky-200 hover:bg-sky-100",
    border: "border-sky-200",
  },
  expressão: {
    name: "Expressão",
    text: "text-purple-700",
    bg: "bg-purple-50 border border-purple-200 hover:bg-purple-100",
    border: "border-purple-200",
  },
  conector: {
    name: "Conector",
    text: "text-cyan-700",
    bg: "bg-cyan-50 border border-cyan-200 hover:bg-cyan-100",
    border: "border-cyan-200",
  },
  auxiliar: {
    name: "Auxiliar",
    text: "text-pink-700",
    bg: "bg-pink-50 border border-pink-200 hover:bg-pink-100",
    border: "border-pink-200",
  },
  tempo: {
    name: "Tempo",
    text: "text-blue-700",
    bg: "bg-blue-50 border border-blue-200 hover:bg-blue-105",
    border: "border-blue-200",
  },
  lugar: {
    name: "Lugar",
    text: "text-yellow-700",
    bg: "bg-yellow-50 border border-yellow-200 hover:bg-yellow-105",
    border: "border-yellow-200",
  },
  outro: {
    name: "Outro",
    text: "text-slate-600",
    bg: "bg-slate-50 border border-slate-200 hover:bg-slate-100",
    border: "border-slate-200",
  },
};

function getTermColor(type?: string | null) {
  const t = (type || "outro").toLowerCase().trim();
  return TERM_COLORS[t] || TERM_COLORS["outro"];
}

interface StudySetupScreenProps {
  config: any;
  onBack: () => void;
  onNavigate?: (screen: string, params?: any) => void;
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
  const [activeDictionaryPopup, setActiveDictionaryPopup] = useState<
    any | null
  >(null);
  const [showLegendModal, setShowLegendModal] = useState(false);
  const playActiveRef = useRef(false);

  // Picture-in-Picture feature support
  const [isPipActive, setIsPipActive] = useState(false);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const drawWrappedText = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number
  ): number => {
    const isSpaceToken = text.includes(" ");
    const tokens = isSpaceToken ? text.split(" ") : text.split("");
    let line = "";
    let currentY = y;
    
    for (let n = 0; n < tokens.length; n++) {
      const testLine = line + tokens[n] + (isSpaceToken ? " " : "");
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;
      if (testWidth > maxWidth && n > 0) {
        ctx.fillText(line, x, currentY);
        line = tokens[n] + (isSpaceToken ? " " : "");
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currentY);
    return currentY;
  };

  const drawPipCanvas = () => {
    const canvas = pipCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const currentItem = items[currentIndex];
    if (!currentItem) return;

    ctx.fillStyle = "#1E293B"; // slate-800 border
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#0F172A"; // slate-900 background area
    ctx.fillRect(12, 12, canvas.width - 24, canvas.height - 24);

    // Decorative top bar
    ctx.fillStyle = "#1E293B";
    ctx.fillRect(12, 12, canvas.width - 24, 38);

    // App header labels
    ctx.fillStyle = "#94A3B8";
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("NIHONGO LOOP • PIP STUDY", 26, 36);

    ctx.textAlign = "right";
    ctx.fillText(`${currentIndex + 1} / ${items.length}`, canvas.width - 26, 36);

    ctx.textAlign = "center";
    ctx.fillStyle = "#FFFFFF";

    let yPos = 110;

    // Japanese kanji text
    ctx.font = "bold 28px sans-serif";
    yPos = drawWrappedText(ctx, currentItem.japanese || "", canvas.width / 2, yPos, canvas.width - 70, 36);

    // Kana pronunciation assistance
    if (currentItem.kana) {
      yPos += 26;
      ctx.fillStyle = "#A78BFA"; // purple violet
      ctx.font = "bold 15px sans-serif";
      yPos = drawWrappedText(ctx, currentItem.kana, canvas.width / 2, yPos, canvas.width - 70, 20);
    }

    // Romaji
    if (currentItem.romaji) {
      yPos += 22;
      ctx.fillStyle = "#94A3B8";
      ctx.font = "italic 12px system-ui, monospace";
      yPos = drawWrappedText(ctx, currentItem.romaji.toUpperCase(), canvas.width / 2, yPos, canvas.width - 70, 16);
    }

    // Divider
    yPos += 14;
    ctx.strokeStyle = "#334155";
    ctx.beginPath();
    ctx.moveTo(80, yPos);
    ctx.lineTo(canvas.width - 80, yPos);
    ctx.stroke();

    // Portuguese translation
    if (currentItem.portuguese) {
      yPos += 26;
      ctx.fillStyle = "#FDE047"; // bright translation yellow
      ctx.font = "bold 16px system-ui, sans-serif";
      drawWrappedText(ctx, currentItem.portuguese, canvas.width / 2, yPos, canvas.width - 90, 20);
    } else {
      yPos += 22;
      ctx.fillStyle = "#475569";
      ctx.font = "italic 12px system-ui, sans-serif";
      ctx.fillText("Sem tradução disponível", canvas.width / 2, yPos);
    }

    // Active playing status bar at the bottom
    ctx.fillStyle = isPlaying ? "#059669" : "#334155";
    ctx.fillRect(12, canvas.height - 48, canvas.width - 24, 36);
    
    ctx.textAlign = "center";
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.fillText(
      isPlaying ? "● TOCANDO AUTOMÁTICO • SESSÃO DE ESTHDO ATIVA" : "■ SESSÃO PAUSADA (CLIQUE PLAY PARA CONTINUAR)",
      canvas.width / 2,
      canvas.height - 26
    );
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
      let entries = await DictionaryRepository.getAll();
      let limitForWords = config.limit;
      if (config.targetType === "specific" && config.wordId) {
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

        if (config.targetType === "source" && config.sourceId) {
          const sourceSents = await SentenceRepository.getBySourceId(
            config.sourceId,
          );
          const sourceSentIds = sourceSents.map((s) => s.id);
          const terms = await TermRepository.getBySentences(sourceSentIds);
          const validEntryIds = new Set(
            terms.map((t) => t.dictionary_entry_id).filter(Boolean),
          );
          entries = entries.filter((e) => validEntryIds.has(e.id));
        }

        if (config.targetType === "custom_word_filter") {
          // Filter by source
          if (config.sourceId) {
            let sourceSents = await SentenceRepository.getBySourceId(
              config.sourceId,
            );
            const sourceSentIds = sourceSents.map((s) => s.id);
            let terms = await TermRepository.getBySentences(sourceSentIds);

            if (!terms || terms.length === 0) {
              const { TermDetectionService } =
                await import("../services/termDetectionService");
              await TermDetectionService.detectWordsInSource(config.sourceId);
              terms = await TermRepository.getBySentences(sourceSentIds);
              entries = await DictionaryRepository.getAll();
            }

            const validEntryIds = new Set(
              terms.map((t) => t.dictionary_entry_id).filter(Boolean),
            );
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

            // Because detection creates new pending entries, we need to refresh 'entries' from DB
            entries = await DictionaryRepository.getAll();
          }

          const validEntryIds = new Set(
            terms.map((t) => t.dictionary_entry_id).filter(Boolean),
          );
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
      if (
        (config.targetType === "source" ||
          config.targetType === "standard_flow") &&
        config.sourceId
      ) {
        sents = await SentenceRepository.getBySourceId(config.sourceId);
      } else {
        sents = await SentenceRepository.getAll();
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
      await SentenceRepository.update(item.id, { favorite: updated });
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
      await SentenceRepository.update(item.id, { difficulty: nextDiff });
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
              setActiveDictionaryPopup({
                term: { surface: itm.japanese, type: itm.rawRef.type },
                entry: itm.rawRef,
              });
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

    const validTerms = currentTerms
      .filter(
        (t) =>
          t.start_index !== undefined &&
          t.end_index !== undefined &&
          t.start_index >= 0 &&
          t.end_index <= txt.length &&
          t.start_index < t.end_index,
      )
      .sort((a, b) => a.start_index - b.start_index);

    let filteredTerms: any[] = [];
    for (const term of validTerms) {
      if (term.start_index >= lastIdx) {
        filteredTerms.push(term);
        lastIdx = term.end_index;
      }
    }

    lastIdx = 0;
    filteredTerms.forEach((term, idx) => {
      if (term.start_index > lastIdx) {
        elements.push(
          <span key={`text-${lastIdx}`}>
            {txt.substring(lastIdx, term.start_index)}
          </span>,
        );
      }

      const termColor = getTermColor(term.type);
      const cleanBg = termColor.bg
        .split(" ")
        .filter((c) => !c.startsWith("hover:"))
        .join(" ");

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
              const entry = await DictionaryRepository.getById(
                term.dictionary_entry_id,
              );
              setActiveDictionaryPopup({ term, entry: entry || null });
            }
          }}
          className={`${termColor.text} ${cleanBg} border-b-2 border-dotted border-current rounded px-1.5 py-0.5 mx-[2px] font-black text-2xl md:text-3xl inline-block cursor-pointer active:scale-95 transition-transform outline-none`}
        >
          {itm.japanese.substring(term.start_index, term.end_index)}
        </button>,
      );
      lastIdx = term.end_index;
    });

    if (lastIdx < txt.length) {
      elements.push(<span key={`text-end`}>{txt.substring(lastIdx)}</span>);
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

      {/* Mini Dictionary Popup when clicked in Pause Mode */}
      {activeDictionaryPopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => setActiveDictionaryPopup(null)}
        >
          <div
            className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl space-y-4 text-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center space-y-1 relative">
              <button
                onClick={() => setActiveDictionaryPopup(null)}
                className="absolute -top-1 -right-1 text-slate-400 p-2 hover:bg-slate-100 rounded-full transition-colors"
              >
                ✕
              </button>
              {activeDictionaryPopup?.entry?.kana && (
                <p className="text-xs text-slate-400 font-medium tracking-wide">
                  {activeDictionaryPopup.entry.kana}
                </p>
              )}
              <h3 className="text-3xl font-black text-slate-900">
                {activeDictionaryPopup?.term?.surface ||
                  activeDictionaryPopup?.term?.japanese ||
                  ""}
              </h3>
              {activeDictionaryPopup?.entry?.romaji && (
                <p className="text-[10px] font-mono text-slate-400 uppercase pt-1 tracking-widest">
                  {activeDictionaryPopup.entry.romaji}
                </p>
              )}
            </div>

            <div className="space-y-3 pt-3">
              <div className="bg-indigo-50/70 p-4 rounded-2xl text-center border border-indigo-100/30">
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
              <div className="flex justify-center gap-2">
                <span className="bg-slate-100 px-3 py-1 rounded-full text-[10px] font-mono font-bold text-slate-500 uppercase">
                  {activeDictionaryPopup?.entry?.type ||
                    activeDictionaryPopup?.term?.type ||
                    "Outro"}
                </span>
              </div>
            </div>

            <div className="pt-2 space-y-2">
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
                  Ver Ficha Completa
                </button>
              )}
              <button
                onClick={() => setActiveDictionaryPopup(null)}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-3.5 rounded-xl uppercase tracking-widest transition-colors shadow-md"
              >
                Continuar
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
    </div>
  );
}
