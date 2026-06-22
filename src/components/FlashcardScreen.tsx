import React, { useState, useEffect, useMemo, useCallback } from "react";
import { ArrowLeft, BarChart3, Settings2, GraduationCap, X } from "lucide-react";
import {
  DictionaryRepository,
  ProgressRepository,
  TermRepository,
  SentenceRepository,
  SourceRepository,
  StudySessionRepository,
} from "../repositories";
import { DictionaryEntry, DictionaryProgress, Sentence, Source } from "../types";
import { FSRSRating, forecastDueReviews } from "../repositories/utils";
import { useModal } from "./ModalProvider";
import {
  FlashcardStore, computeDeckStats, buildQueue, quickModeConfig, getStudyTip,
  SessionConfig, CardItem, QuickMode, CustomDeck, FlashcardSettings, CardMode,
} from "../services/flashcardService";
import FlashcardHub from "./flashcards/FlashcardHub";
import SessionBuilder from "./flashcards/SessionBuilder";
import StudyRunner, { SessionResult } from "./flashcards/StudyRunner";
import SessionSummary from "./flashcards/SessionSummary";
import FlashcardInsights from "./flashcards/FlashcardInsights";
import TutorView from "./flashcards/TutorView";
import { analyzeLearner, TutorAction } from "../services/tutorService";

type View = "hub" | "builder" | "session" | "summary" | "insights" | "tutor";

const RATING_KEYS = ["again", "hard", "good", "easy"] as const;

export default function FlashcardScreen({ onBack }: { onBack: () => void }) {
  const { showAlert } = useModal();

  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([]);
  const [allProgress, setAllProgress] = useState<DictionaryProgress[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [settings, setSettings] = useState<FlashcardSettings>(FlashcardStore.getSettings());
  const [decks, setDecks] = useState<CustomDeck[]>([]);
  const [view, setView] = useState<View>("hub");
  const [sessionQueue, setSessionQueue] = useState<CardItem[]>([]);
  const [sessionMode, setSessionMode] = useState<CardMode>("ja_pt");
  const [lastResult, setLastResult] = useState<SessionResult | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionNonce, setSessionNonce] = useState(0);
  const [activityVersion, setActivityVersion] = useState(0);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [entries, progress, srcs, flashcardData] = await Promise.all([
      DictionaryRepository.getAll(), // full deck (getPage is capped at 200)
      ProgressRepository.getAllDictionaryProgress(),
      SourceRepository.getAll(),
      FlashcardStore.hydrateRemote(),
    ]);
    setDictionary(entries);
    setAllProgress(progress);
    setSources(srcs);
    setSettings(flashcardData.settings);
    setDecks(flashcardData.decks);
    setTypes(Array.from(new Set(entries.map((e) => e.type).filter(Boolean))) as string[]);
    setLevels(Array.from(new Set(entries.map((e) => e.jlpt_level).filter(Boolean))) as string[]);
    setActivityVersion((value) => value + 1);
    setLoading(false);
  };

  const progressMap = useMemo(
    () => allProgress.reduce((acc, p) => { acc[p.dictionary_entry_id] = p; return acc; }, {} as Record<string, DictionaryProgress>),
    [allProgress],
  );
  const deckStats = useMemo(() => computeDeckStats(dictionary, progressMap), [dictionary, progressMap]);

  // ─── Local progress sync ─────────────────────────────────────────────────────
  const upsertLocalProgress = useCallback((entryId: string, p: DictionaryProgress | null) => {
    setAllProgress((prev) => {
      if (!p) return prev.filter((x) => x.dictionary_entry_id !== entryId);
      const idx = prev.findIndex((x) => x.dictionary_entry_id === entryId);
      if (idx >= 0) { const copy = [...prev]; copy[idx] = p; return copy; }
      return [...prev, p];
    });
  }, []);

  // ─── Queue construction ──────────────────────────────────────────────────────
  const resolveAllowedIds = async (config: SessionConfig): Promise<Set<string> | null> => {
    if (!config.sourceId) return null;
    try {
      return new Set(await TermRepository.getDictionaryEntryIdsBySourceId(config.sourceId));
    } catch (err) {
      console.warn("Falling back to client-side source filter", err);
      const sentences = await SentenceRepository.getBySourceId(config.sourceId);
      const terms = await TermRepository.getBySentences(sentences.map((s) => s.id));
      return new Set(terms.map((t) => (t as { dictionary_entry_id?: string }).dictionary_entry_id).filter(Boolean) as string[]);
    }
  };

  const startSession = useCallback(async (config: SessionConfig) => {
    const allowedEntryIds = await resolveAllowedIds(config);
    const newIntroducedToday = FlashcardStore.getTodayCounts().newCards;
    let queue = buildQueue({ entries: dictionary, progressMap, config, newIntroducedToday, allowedEntryIds });
    // Smart study should never dead-end: if nothing is due/new, fall back to
    // ahead-of-schedule practice so the user can always review something.
    if (queue.length === 0 && config.quick === "smart") {
      queue = buildQueue({
        entries: dictionary, progressMap, allowedEntryIds, newIntroducedToday,
        config: { ...config, onlyDue: false, newLimit: Math.max(config.newLimit, 10) },
      });
    }
    if (queue.length === 0) {
      showAlert("Nada para estudar", config.onlyDue
        ? "Nenhum card vencido com esses filtros. Tente desativar 'somente vencidas' ou escolher outro modo."
        : "Nenhum card encontrado com esses filtros.");
      return;
    }
    setSessionQueue(queue);
    setSessionMode(config.mode);
    setSessionNonce((n) => n + 1);
    setView("session");
  }, [dictionary, progressMap, showAlert]);

  const handleQuickStart = useCallback((mode: QuickMode) => {
    startSession(quickModeConfig(mode, settings));
  }, [settings, startSession]);

  // ─── Runner callbacks ────────────────────────────────────────────────────────
  const onGrade = useCallback(async (item: CardItem, rating: FSRSRating) => {
    const p = await ProgressRepository.applyFlashcardFeedback(item.entry.id, RATING_KEYS[rating - 1], item.progress, settings.desiredRetention);
    if (p) upsertLocalProgress(item.entry.id, p);
    return p;
  }, [settings.desiredRetention, upsertLocalProgress]);

  const onMarkLearned = useCallback(async (item: CardItem) => {
    const existing = item.progress;
    const p = await ProgressRepository.setDictionaryProgressFields(item.entry.id, {
      seen_count: (existing?.seen_count ?? 0) + 1,
      correct_count: (existing?.correct_count ?? 0) + 1,
      wrong_count: existing?.wrong_count ?? 0,
      last_seen_at: new Date().toISOString(),
      mastery: 999999,
    }, item.progress);
    if (p) upsertLocalProgress(item.entry.id, p);
  }, [upsertLocalProgress]);

  const onSetFields = useCallback(async (item: CardItem, fields: Partial<DictionaryProgress>) => {
    const p = await ProgressRepository.setDictionaryProgressFields(item.entry.id, fields, item.progress);
    if (p) upsertLocalProgress(item.entry.id, p);
    return p;
  }, [upsertLocalProgress]);

  const onUndo = useCallback(async (item: CardItem, prev: DictionaryProgress | null) => {
    if (prev) { await ProgressRepository.restoreDictionaryProgress(prev); upsertLocalProgress(item.entry.id, prev); }
    else { await ProgressRepository.deleteDictionaryProgress(item.entry.id); upsertLocalProgress(item.entry.id, null); }
  }, [upsertLocalProgress]);

  const onSaveEdit = useCallback(async (entryId: string, updates: Partial<DictionaryEntry>) => {
    try {
      const updated = await DictionaryRepository.update(entryId, updates);
      if (updated) setDictionary((prev) => prev.map((e) => e.id === entryId ? updated : e));
      return updated;
    } catch (err: any) {
      showAlert("Nao foi possivel salvar", err?.message || "Verifique os dados do verbete.");
      return null;
    }
  }, [showAlert]);

  const loadExample = useCallback(async (entryId: string): Promise<Sentence | null> => {
    try {
      const terms = await TermRepository.getByDictionaryEntry(entryId);
      if (!terms.length) return null;
      return await SentenceRepository.getById(terms[0].sentence_id);
    } catch { return null; }
  }, []);

  const onFinish = useCallback((result: SessionResult) => {
    void FlashcardStore.recordSessionRemote(result.reviewCount, result.newCount, result.again)
      .then(() => setActivityVersion((value) => value + 1))
      .catch((err) => showAlert("Atividade nao sincronizada", err?.message || "A sessao terminou, mas a contagem diaria nao foi salva no Supabase."));
    void StudySessionRepository.saveSession({
      user_id: "",
      type: "flashcards",
      source_id: null,
      started_at: new Date(Date.now() - result.durationMs).toISOString(),
      completed_at: new Date().toISOString(),
      config: { mode: sessionMode, ...result },
    }).catch((err) => console.warn("Failed to save flashcard session", err));
    setLastResult(result);
    setView("summary");
  }, [sessionMode, showAlert]);

  const handleReactivateCard = useCallback((entryId: string) => {
    void ProgressRepository.setDictionaryProgressFields(entryId, { suspended: false }, progressMap[entryId] || null)
      .then((p) => { if (p) upsertLocalProgress(entryId, p); })
      .catch((err) => showAlert("Nao foi possivel reativar", err?.message || "Tente novamente."));
  }, [progressMap, showAlert, upsertLocalProgress]);

  const handleReturnToReview = useCallback((entryId: string) => {
    void ProgressRepository.setDictionaryProgressFields(entryId, {
      suspended: false,
      mastery: Math.min(progressMap[entryId]?.mastery ?? 80, 80),
      due_at: new Date().toISOString(),
    }, progressMap[entryId] || null)
      .then((p) => { if (p) upsertLocalProgress(entryId, p); })
      .catch((err) => showAlert("Nao foi possivel voltar para revisao", err?.message || "Tente novamente."));
  }, [progressMap, showAlert, upsertLocalProgress]);

  const handleResetProgress = useCallback((entryId: string) => {
    if (!window.confirm("Apagar o historico de progresso deste card?")) return;
    void ProgressRepository.deleteDictionaryProgress(entryId)
      .then(() => upsertLocalProgress(entryId, null))
      .catch((err) => showAlert("Nao foi possivel resetar", err?.message || "Tente novamente."));
  }, [showAlert, upsertLocalProgress]);

  // ─── Settings ────────────────────────────────────────────────────────────────
  const updateSettings = (patch: Partial<FlashcardSettings>) => {
    void FlashcardStore.saveSettingsRemote(patch)
      .then((saved) => {
        setSettings(saved);
        setActivityVersion((value) => value + 1);
      })
      .catch((err) => showAlert("Nao foi possivel salvar preferencias", err?.message || "Tente novamente quando a conexao voltar."));
  };

  // ─── Deck management ─────────────────────────────────────────────────────────
  const handleSaveDeck = (name: string, config: SessionConfig) => {
    void FlashcardStore.saveDeckRemote(name, config)
      .then(() => setDecks(FlashcardStore.getDecks()))
      .catch((err) => showAlert("Nao foi possivel salvar baralho", err?.message || "Tente novamente quando a conexao voltar."));
  };
  const handleDeleteDeck = (id: string) => {
    void FlashcardStore.deleteDeckRemote(id)
      .then(() => setDecks(FlashcardStore.getDecks()))
      .catch((err) => showAlert("Nao foi possivel apagar baralho", err?.message || "Tente novamente quando a conexao voltar."));
  };

  const tip = useMemo(() => getStudyTip(deckStats, FlashcardStore.getStreak()), [deckStats, activityVersion]);
  const upcomingTomorrow = useMemo(() => forecastDueReviews(allProgress, 2)[1] ?? 0, [allProgress]);

  // ─── Tutor (rule-based pedagogical analysis) ─────────────────────────────────
  const tutorProfile = useMemo(() => analyzeLearner({
    entries: dictionary,
    progress: allProgress,
    stats: deckStats,
    settings,
    streak: FlashcardStore.getStreak(),
    daysStudied7: FlashcardStore.getDaysStudied(7),
    daysStudied30: FlashcardStore.getDaysStudied(30),
    todayReviews: FlashcardStore.getTodayCounts().reviews,
    todayNewCards: FlashcardStore.getTodayCounts().newCards,
    hourHistogram: FlashcardStore.getHourHistogram(),
    recentAgainRate: FlashcardStore.getRecentAgainRate(),
  }), [dictionary, allProgress, deckStats, settings, view, activityVersion]);

  const handleTutorAction = useCallback((action?: TutorAction) => {
    if (!action || action.kind === "none") return;
    if (action.kind === "quick" && action.mode) handleQuickStart(action.mode);
    else if (action.kind === "builder") setView("builder");
    else if (action.kind === "settings") setShowSettings(true);
    else if (action.kind === "insights") setView("insights");
  }, [handleQuickStart]);

  const TITLES: Record<View, string> = {
    hub: "Flashcards", builder: "Personalizar", session: "Revisão", summary: "Resumo", insights: "Progresso", tutor: "Tutor",
  };
  const headerBack = view === "hub" ? onBack : () => setView("hub");

  return (
    <div className="screen-gray">
      <header className="screen-header">
        <button type="button" onClick={headerBack} className="btn-back" aria-label="Voltar"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="screen-title">{TITLES[view]}</h1>
        {view === "hub" && (
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => setView("tutor")} className="p-2 text-gray-400 hover:text-indigo-600 rounded-lg transition-colors" aria-label="Tutor"><GraduationCap className="w-4.5 h-4.5" /></button>
            <button onClick={() => setView("insights")} className="p-2 text-gray-400 hover:text-indigo-600 rounded-lg transition-colors" aria-label="Progresso"><BarChart3 className="w-4.5 h-4.5" /></button>
            <button onClick={() => setShowSettings(true)} className="p-2 text-gray-400 hover:text-indigo-600 rounded-lg transition-colors" aria-label="Preferências"><Settings2 className="w-4.5 h-4.5" /></button>
          </div>
        )}
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {view === "hub" && (
            <FlashcardHub
              stats={deckStats}
              streak={FlashcardStore.getStreak()}
              todayReviews={FlashcardStore.getTodayCounts().reviews}
              dailyGoal={Math.max(1, settings.dailyNewLimit + Math.min(deckStats.due, 50))}
              smartCount={deckStats.due + Math.min(deckStats.new, Math.max(0, settings.dailyNewLimit - FlashcardStore.getTodayCounts().newCards))}
              decks={decks}
              tip={tip}
              onQuickStart={handleQuickStart}
              onStartDeck={(deck) => startSession(deck.config)}
              onDeleteDeck={handleDeleteDeck}
              onCustomize={() => setView("builder")}
              onInsights={() => setView("insights")}
              tutorHeadline={tutorProfile.recommendations[0]?.title || tutorProfile.headline}
              tutorTone={tutorProfile.recommendations[0]?.tone || "info"}
              onOpenTutor={() => setView("tutor")}
            />
          )}

          {view === "tutor" && (
            <TutorView profile={tutorProfile} onAction={handleTutorAction} />
          )}

          {view === "builder" && (
            <SessionBuilder
              sources={sources} types={types} levels={levels} settings={settings}
              onStart={startSession}
              onSaveDeck={handleSaveDeck}
            />
          )}

          {view === "session" && (
            <div key={sessionNonce} className="flex-1 flex flex-col overflow-hidden">
              <StudyRunner
                initialQueue={sessionQueue}
                mode={sessionMode}
                settings={settings}
                onGrade={onGrade}
                onMarkLearned={onMarkLearned}
                onSetFields={onSetFields}
                onUndo={onUndo}
                onSaveEdit={onSaveEdit}
                loadExample={loadExample}
                onFinish={onFinish}
              />
            </div>
          )}

          {view === "summary" && lastResult && (
            <SessionSummary
              result={lastResult}
              upcomingTomorrow={upcomingTomorrow}
              onNewSession={() => setView("hub")}
              onHome={() => setView("hub")}
            />
          )}

          {view === "insights" && (
            <FlashcardInsights
              stats={deckStats}
              streak={FlashcardStore.getStreak()}
              heatmap={FlashcardStore.getHeatmap()}
              progressList={allProgress}
              entries={dictionary}
              onStudyLeeches={() => { setView("hub"); handleQuickStart("leech"); }}
              onReactivateCard={handleReactivateCard}
              onReturnToReview={handleReturnToReview}
              onResetProgress={handleResetProgress}
            />
          )}
        </>
      )}

      {showSettings && (
        <SettingsSheet settings={settings} onChange={updateSettings} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

// ─── Settings sheet ────────────────────────────────────────────────────────────

function SettingsSheet({ settings, onChange, onClose }: {
  settings: FlashcardSettings; onChange: (p: Partial<FlashcardSettings>) => void; onClose: () => void;
}) {
  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <div onClick={onClick} className={`w-10 h-5 rounded-full transition-colors relative cursor-pointer ${on ? "bg-indigo-500" : "bg-gray-200"}`}>
      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl p-5 w-full max-w-sm shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center border-b border-gray-100 pb-2">
          <h3 className="text-sm font-black text-slate-900">Preferências de Estudo</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-rose-500 p-1"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-gray-700">Novos cards por dia</p>
              <p className="text-[10px] text-gray-400">Evita sobrecarga cognitiva</p>
            </div>
            <input type="number" min={0} max={200} value={settings.dailyNewLimit}
              onChange={(e) => onChange({ dailyNewLimit: Math.max(0, Number(e.target.value)) })}
              className="w-16 px-2 py-1.5 text-center text-sm font-black bg-white border border-[#E5E5E7] rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-gray-700">Direção padrão</p>
              <p className="text-[10px] text-gray-400">Como os cards aparecem</p>
            </div>
            <select value={settings.defaultMode} onChange={(e) => onChange({ defaultMode: e.target.value as CardMode })}
              className="px-2 py-1.5 text-xs font-bold bg-white border border-[#E5E5E7] rounded-xl outline-none">
              <option value="ja_pt">JP → PT</option>
              <option value="pt_ja">PT → JP</option>
              <option value="audio_pt">Áudio → PT</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-gray-700">Tocar áudio automático</p>
              <p className="text-[10px] text-gray-400">Pronúncia ao mostrar o card</p>
            </div>
            <Toggle on={settings.autoplayAudio} onClick={() => onChange({ autoplayAudio: !settings.autoplayAudio })} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-gray-700">Mostrar frases de exemplo</p>
              <p className="text-[10px] text-gray-400">Aprendizado em contexto</p>
            </div>
            <Toggle on={settings.showExamples} onClick={() => onChange({ showExamples: !settings.showExamples })} />
          </div>
        </div>

        <button onClick={onClose} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-wider rounded-2xl text-xs transition-all">Pronto</button>
      </div>
    </div>
  );
}
