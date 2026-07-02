import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Play, Check, Edit2, Star, EyeOff, RotateCcw, BookOpen, AlertCircle,
  StickyNote, Volume2, Keyboard,
} from "lucide-react";
import { DictionaryEntry, DictionaryProgress, Sentence } from "../../types";
import { SpeechService } from "../../services/speechService";
import {
  FSRSRating, fsrsPreviewIntervals, cardRetention, classifyCardState, isLeech,
} from "../../repositories/utils";
import { CardItem, CardMode, FlashcardSettings } from "../../services/flashcardService";
import { RetentionRing, StateBadge } from "./FlashcardAtoms";

export interface SessionResult {
  again: number; hard: number; good: number; easy: number; learned: number;
  buried: number; total: number; durationMs: number;
  newCount: number; reviewCount: number;
}

interface RunnerProps {
  initialQueue: CardItem[];
  mode: CardMode;
  settings: FlashcardSettings;
  onGrade: (item: CardItem, rating: FSRSRating) => Promise<DictionaryProgress | null>;
  onMarkLearned: (item: CardItem) => Promise<void>;
  onSetFields: (item: CardItem, fields: Partial<DictionaryProgress>) => Promise<DictionaryProgress | null>;
  onUndo: (item: CardItem, prev: DictionaryProgress | null) => Promise<void>;
  onSaveEdit: (entryId: string, updates: Partial<DictionaryEntry>) => Promise<DictionaryEntry | null>;
  loadExample: (entryId: string) => Promise<Sentence | null>;
  onFinish: (result: SessionResult) => void;
}

const RATING_KEYS = ["again", "hard", "good", "easy"] as const;
const RATING_META = [
  { r: 1 as FSRSRating, label: "De Novo", cls: "border-rose-200 hover:bg-rose-50", txt: "text-rose-600", key: "1" },
  { r: 2 as FSRSRating, label: "Difícil", cls: "border-orange-200 hover:bg-orange-50", txt: "text-orange-600", key: "2" },
  { r: 3 as FSRSRating, label: "Bom", cls: "border-emerald-200 hover:bg-emerald-50", txt: "text-emerald-600", key: "3" },
  { r: 4 as FSRSRating, label: "Fácil", cls: "border-blue-200 hover:bg-blue-50", txt: "text-blue-600", key: "4" },
];

interface HistoryEntry { index: number; item: CardItem; prev: DictionaryProgress | null; kind: typeof RATING_KEYS[number] | "learned"; }

export default function StudyRunner({
  initialQueue, mode, settings,
  onGrade, onMarkLearned, onSetFields, onUndo, onSaveEdit, loadExample, onFinish,
}: RunnerProps) {
  const [queue, setQueue] = useState<CardItem[]>(initialQueue);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [anim, setAnim] = useState(false);
  const [example, setExample] = useState<Sentence | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [stats, setStats] = useState({ again: 0, hard: 0, good: 0, easy: 0, learned: 0, buried: 0 });
  const statsRef = useRef(stats);
  const bumpStat = useCallback((key: keyof typeof stats, delta: number) => {
    const next = { ...statsRef.current, [key]: Math.max(0, statsRef.current[key] + delta) };
    statsRef.current = next; // sync for finish()
    setStats(next);          // async for display
  }, []);

  const historyRef = useRef<HistoryEntry[]>([]);
  const startRef = useRef<number>(Date.now());
  const current = queue[index];

  // Remaining counters (new / learning / review) from current position.
  const remaining = useMemo(() => {
    const rest = queue.slice(index);
    let n = 0, l = 0, r = 0;
    for (const it of rest) {
      const st = it.state;
      if (st === "new") n++;
      else if (st === "learning") l++;
      else r++;
    }
    return { n, l, r };
  }, [queue, index]);

  const intervals = useMemo(
    () => current ? fsrsPreviewIntervals(current.progress) : { 1: "", 2: "", 3: "", 4: "" } as Record<FSRSRating, string>,
    [current],
  );
  const retention = current ? cardRetention(current.progress) : null;

  // Load example + autoplay when card changes.
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setFlipped(false); setAnim(false); setShowNotes(false);
    setNotesDraft(current.progress?.notes || "");
    setExample(null);
    setSaveError("");
    if (settings.showExamples) {
      loadExample(current.entry.id).then((sentence) => {
        if (!cancelled) setExample(sentence);
      });
    }
    // Speak on the front only when the Japanese is the prompt (ja_pt) or the
    // card is audio-first. For pt_ja the Japanese is the answer → speak on flip.
    const speakOnFront = mode === "audio_pt" || (settings.autoplayAudio && mode === "ja_pt");
    if (speakOnFront) setTimeout(() => SpeechService.speakJapaneseText(current.entry.lemma), 250);
    return () => { cancelled = true; };
  }, [current?.entry.id]);

  // Autoplay the answer audio after flipping in pt_ja mode (avoids spoiling it).
  useEffect(() => {
    if (flipped && settings.autoplayAudio && mode === "pt_ja" && current) {
      SpeechService.speakJapaneseText(current.entry.lemma);
    }
  }, [flipped]);

  const finish = useCallback(() => {
    const s = statsRef.current;
    const answered = historyRef.current.filter((h) => h.kind !== "learned");
    const learned = historyRef.current.filter((h) => h.kind === "learned");
    const newCount = historyRef.current.filter((h) => h.item.state === "new").length;
    onFinish({
      ...s, total: s.again + s.hard + s.good + s.easy + s.learned,
      durationMs: Date.now() - startRef.current,
      newCount,
      reviewCount: answered.length + learned.length - newCount,
    });
  }, [onFinish]);

  const advance = useCallback(() => {
    if (index + 1 >= queue.length) finish();
    else setIndex((i) => i + 1);
  }, [index, queue.length, finish]);

  const doFlip = useCallback(() => {
    if (flipped) return;
    setAnim(true);
    setTimeout(() => { setAnim(false); setFlipped(true); }, 140);
  }, [flipped]);

  const grade = useCallback(async (rating: FSRSRating) => {
    if (!current || !flipped || isSaving) return;
    const key = RATING_KEYS[rating - 1];
    setIsSaving(true);
    setSaveError("");
    try {
      const updated = await onGrade(current, rating);
      if (updated) setQueue((q) => q.map((it, i) => i === index ? { ...it, progress: updated } : it));
      historyRef.current.push({ index, item: current, prev: current.progress, kind: key });
      bumpStat(key, 1);
      advance();
    } catch (err: any) {
      setSaveError(err?.message || "Nao foi possivel salvar a resposta. Tente novamente.");
    } finally {
      setIsSaving(false);
    }
  }, [current, flipped, isSaving, index, onGrade, advance, bumpStat]);

  const markLearned = useCallback(async () => {
    if (!current || !flipped || isSaving) return;
    if (!window.confirm("Marcar este card como dominado? Voce podera reativar em Progresso.")) return;
    setIsSaving(true);
    setSaveError("");
    try {
      await onMarkLearned(current);
      historyRef.current.push({ index, item: current, prev: current.progress, kind: "learned" });
      bumpStat("learned", 1);
      advance();
    } catch (err: any) {
      setSaveError(err?.message || "Nao foi possivel marcar como dominado.");
    } finally {
      setIsSaving(false);
    }
  }, [current, flipped, isSaving, index, onMarkLearned, advance, bumpStat]);

  const undo = useCallback(async () => {
    if (isSaving) return;
    const last = historyRef.current.pop();
    if (!last) return;
    setIsSaving(true);
    setSaveError("");
    try {
      await onUndo(last.item, last.prev);
      bumpStat(last.kind, -1);
      setQueue((q) => q.map((it, i) => i === last.index ? { ...it, progress: last.prev } : it));
      setIndex(last.index);
      setFlipped(true);
    } catch (err: any) {
      historyRef.current.push(last);
      setSaveError(err?.message || "Nao foi possivel desfazer.");
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, onUndo, bumpStat]);

  const toggleFavorite = useCallback(async () => {
    if (!current || isSaving) return;
    const next = !current.isFavorite;
    setQueue((q) => q.map((it, i) => i === index ? { ...it, isFavorite: next } : it));
    await onSetFields(current, { favorite: next });
  }, [current, isSaving, index, onSetFields]);

  const suspend = useCallback(async () => {
    if (!current || isSaving) return;
    if (!window.confirm("Suspender este card? Voce podera reativar em Progresso.")) return;
    setIsSaving(true);
    setSaveError("");
    try {
      await onSetFields(current, { suspended: true });
      bumpStat("buried", 1);
      const wasLast = index >= queue.length - 1;
      historyRef.current = [];
      setQueue((q) => q.filter((_, i) => i !== index));
      setFlipped(false);
      if (wasLast) setTimeout(finish, 0);
    } catch (err: any) {
      setSaveError(err?.message || "Nao foi possivel suspender o card.");
    } finally {
      setIsSaving(false);
    }
  }, [current, isSaving, index, queue.length, onSetFields, finish, bumpStat]);

  const playAudio = useCallback(() => {
    if (current) SpeechService.speakJapaneseText(current.entry.lemma);
  }, [current]);

  const saveNotes = useCallback(async () => {
    if (!current) return;
    await onSetFields(current, { notes: notesDraft });
    setQueue((q) => q.map((it, i) => i === index
      ? { ...it, progress: { ...(it.progress as DictionaryProgress), notes: notesDraft } as DictionaryProgress }
      : it));
  }, [current, index, notesDraft, onSetFields]);

  // Keyboard shortcuts (kept fresh via ref).
  const handlersRef = useRef<any>({});
  handlersRef.current = { flipped, doFlip, grade, undo, toggleFavorite, suspend, playAudio, markLearned, editing, showHelp, isSaving, openEdit: () => setEditing(true) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = handlersRef.current;
      if (h.editing || h.isSaving) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!h.flipped) h.doFlip(); }
      else if (h.flipped && ["1", "2", "3", "4"].includes(e.key)) { e.preventDefault(); h.grade(Number(e.key) as FSRSRating); }
      else if (e.key.toLowerCase() === "u") h.undo();
      else if (e.key.toLowerCase() === "f") h.toggleFavorite();
      else if (e.key.toLowerCase() === "s") h.suspend();
      else if (e.key.toLowerCase() === "a") h.playAudio();
      else if (e.key.toLowerCase() === "e") h.openEdit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!current) return null;

  const { entry } = current;
  const isLeechCard = isLeech(current.progress);
  const liveState = classifyCardState(current.progress);

  // ── Card faces ──
  const hideText = mode === "audio_pt" && !flipped;
  const showJaFront = mode === "ja_pt";

  return (
    <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden">
      {/* Top meta */}
      <div className="shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-1.5 flex-wrap">
          <StateBadge state={liveState} />
          {isLeechCard && (
            <span className="px-1.5 py-0.5 text-[9px] font-black uppercase bg-rose-100 text-rose-700 rounded-md flex items-center gap-0.5">
              <AlertCircle className="w-2.5 h-2.5" /> Difícil
            </span>
          )}
          {entry.jlpt_level && <span className="px-1.5 py-0.5 text-[9px] font-black uppercase bg-purple-100 text-purple-700 rounded-md">{entry.jlpt_level}</span>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={toggleFavorite} disabled={isSaving} title="Favoritar (F)"
            aria-label={current.isFavorite ? "Remover flashcard dos favoritos" : "Favoritar flashcard"}
            aria-pressed={Boolean(current.isFavorite)}
            className={`tap-icon-sm rounded-lg transition-colors ${current.isFavorite ? "text-yellow-500" : "text-gray-300 hover:text-yellow-500"}`}>
            <Star className={`w-4 h-4 ${current.isFavorite ? "fill-yellow-500" : ""}`} />
          </button>
          <button onClick={() => setEditing(true)} disabled={isSaving} title="Editar (E)" aria-label="Editar flashcard" className="tap-icon-sm text-gray-300 hover:text-indigo-500 rounded-lg transition-colors disabled:opacity-50"><Edit2 className="w-4 h-4" /></button>
          <button onClick={suspend} disabled={isSaving} title="Suspender (S)" aria-label="Suspender flashcard" className="tap-icon-sm text-gray-300 hover:text-rose-500 rounded-lg transition-colors disabled:opacity-50"><EyeOff className="w-4 h-4" /></button>
          <button onClick={() => setShowHelp((v) => !v)} title="Atalhos" aria-label={showHelp ? "Ocultar atalhos" : "Mostrar atalhos"} aria-pressed={showHelp} className="tap-icon-sm text-gray-300 hover:text-gray-600 rounded-lg transition-colors"><Keyboard className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Remaining counters + progress */}
      <div className="shrink-0 flex items-center gap-2">
        <div className="flex items-center gap-2 text-[10px] font-black">
          <span className="text-violet-600">{remaining.n}</span>
          <span className="text-amber-600">{remaining.l}</span>
          <span className="text-sky-600">{remaining.r}</span>
        </div>
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${(index / queue.length) * 100}%` }} />
        </div>
        <span className="text-[9px] font-black text-gray-400">{index + 1}/{queue.length}</span>
      </div>

      {showHelp && (
        <div className="shrink-0 bg-slate-900 text-white rounded-2xl p-3 text-[10px] grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
          <span><b>Espaço</b> revelar</span><span><b>1-4</b> avaliar</span>
          <span><b>U</b> desfazer</span><span><b>F</b> favoritar</span>
          <span><b>S</b> suspender</span><span><b>A</b> áudio</span>
          <span><b>E</b> editar</span><span />
        </div>
      )}

      {saveError && (
        <div className="shrink-0 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
          {saveError}
        </div>
      )}

      {/* Card */}
      <div className={`flex-1 relative cursor-pointer select-none overflow-hidden transition-all duration-150 ${anim ? "opacity-0 scale-95" : "opacity-100 scale-100"}`}
        onClick={!flipped ? doFlip : undefined}>
        <div className="h-full bg-white rounded-3xl border border-[#E5E5E7] shadow-sm flex flex-col">
          {/* FRONT */}
          {!flipped && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
              {hideText ? (
                <button onClick={(e) => { e.stopPropagation(); playAudio(); }}
                  aria-label="Reproduzir áudio"
                  className="w-24 h-24 rounded-full bg-indigo-50 hover:bg-indigo-100 text-indigo-500 flex items-center justify-center transition-colors">
                  <Volume2 className="w-10 h-10" />
                </button>
              ) : showJaFront ? (
                <div className="flex flex-col items-center gap-4">
                  <p className="text-5xl font-black text-gray-900 leading-tight tracking-tight text-center">{entry.lemma}</p>
                  <button onClick={(e) => { e.stopPropagation(); playAudio(); }}
                    aria-label="Reproduzir áudio"
                    className="p-3 bg-gray-50 hover:bg-indigo-50 text-gray-400 hover:text-indigo-500 rounded-full transition-colors">
                    <Play className="w-5 h-5 fill-current" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-3xl font-black text-gray-900 leading-tight text-center px-2">{entry.main_meaning}</p>
                  {entry.type && <span className="text-[10px] text-gray-400 font-bold uppercase">{entry.type}</span>}
                </div>
              )}
              <p className="absolute bottom-4 text-[10px] text-gray-300 font-bold uppercase tracking-widest">
                {mode === "audio_pt" ? "Ouça e identifique" : "Toque para revelar"}
              </p>
            </div>
          )}

          {/* ANSWER */}
          {flipped && (
            <div className="flex-1 flex flex-col overflow-auto">
              <div className="flex-1 flex flex-col items-center justify-center p-6 gap-2 text-center">
                <p className="text-4xl font-black text-gray-900 leading-tight">{entry.lemma}</p>
                {entry.kana && entry.kana !== entry.lemma && <p className="text-lg text-gray-500 font-bold">{entry.kana}</p>}
                {entry.romaji && <p className="text-xs font-mono text-gray-400 uppercase tracking-widest">{entry.romaji}</p>}
                <button onClick={(e) => { e.stopPropagation(); playAudio(); }}
                  aria-label="Reproduzir áudio"
                  className="my-1 p-2.5 bg-gray-50 hover:bg-indigo-50 text-gray-400 hover:text-indigo-500 rounded-full inline-flex transition-colors">
                  <Play className="w-4 h-4 fill-current" />
                </button>
                <p className="text-2xl font-black text-indigo-700 pt-1">{entry.main_meaning}</p>
                {entry.type && <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-slate-100 text-slate-600 rounded mt-1">{entry.type}</span>}
                {retention !== null && <div className="pt-2"><RetentionRing value={retention} /></div>}
              </div>

              {example && (
                <div className="mx-4 mb-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1"><BookOpen className="w-3 h-3" /> Exemplo</p>
                  <p className="text-sm text-slate-800 font-medium leading-relaxed">{example.japanese}</p>
                  {example.portuguese && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{example.portuguese}</p>}
                </div>
              )}

              {/* Notes / mnemonic */}
              <div className="mx-4 mb-4">
                {showNotes ? (
                  <textarea autoFocus value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)}
                    onBlur={() => { saveNotes(); if (!notesDraft) setShowNotes(false); }}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Crie um mnemônico ou nota…"
                    className="w-full text-xs p-3 bg-amber-50 border border-amber-100 rounded-xl outline-none resize-none focus:ring-2 focus:ring-amber-300" rows={2} />
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); setShowNotes(true); }}
                    className="w-full flex items-center gap-2 text-[11px] font-bold text-amber-600 bg-amber-50/60 hover:bg-amber-50 rounded-xl px-3 py-2 transition-colors">
                    <StickyNote className="w-3.5 h-3.5" />
                    {notesDraft ? <span className="text-amber-800 font-medium truncate">{notesDraft}</span> : "Adicionar mnemônico / nota"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      {!flipped ? (
        <div className="shrink-0 flex gap-2">
          {historyRef.current.length > 0 && (
            <button onClick={undo} disabled={isSaving} title="Desfazer (U)"
              aria-label="Desfazer resposta anterior"
              className="px-4 py-4 bg-white border-2 border-gray-200 hover:bg-gray-50 rounded-2xl text-gray-500 transition-all active:scale-95 disabled:opacity-50">
              <RotateCcw className="w-5 h-5" />
            </button>
          )}
          <button onClick={doFlip} disabled={isSaving}
            className="flex-1 py-4 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-black uppercase tracking-wider rounded-2xl text-sm transition-all shadow-lg shadow-indigo-100 disabled:opacity-60">
            Mostrar Resposta
          </button>
        </div>
      ) : (
        <div className="shrink-0 space-y-2">
          <div className="grid grid-cols-4 gap-1.5">
            {RATING_META.map(({ r, label, cls, txt }) => (
              <button key={r} onClick={() => grade(r)} disabled={isSaving}
                className={`py-3.5 bg-white border-2 ${cls} active:scale-95 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all disabled:opacity-60`}>
                <span className={`${txt} font-black text-[10px] uppercase leading-tight`}>{label}</span>
                <span className="text-[9px] text-gray-400 font-bold">{intervals[r]}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {historyRef.current.length > 0 && (
              <button onClick={undo} disabled={isSaving} className="px-4 py-3 bg-white border-2 border-gray-200 hover:bg-gray-50 rounded-2xl text-gray-500 transition-all active:scale-95 disabled:opacity-50">
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            <button onClick={markLearned} disabled={isSaving}
              className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 active:scale-95 text-white font-black uppercase tracking-wider rounded-2xl text-xs flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-60">
              <Check className="w-4 h-4" /> Dominado
            </button>
          </div>
        </div>
      )}

      {editing && (
        <EditOverlay entry={entry} onClose={() => setEditing(false)}
          onSave={async (updates) => {
            const updated = await onSaveEdit(entry.id, updates);
            if (updated) setQueue((q) => q.map((it, i) => i === index ? { ...it, entry: { ...it.entry, ...updates } } : it));
            setEditing(false);
          }} />
      )}
    </div>
  );
}

// ─── Inline edit overlay ───────────────────────────────────────────────────────

function EditOverlay({ entry, onClose, onSave }: { entry: DictionaryEntry; onClose: () => void; onSave: (u: Partial<DictionaryEntry>) => Promise<void> }) {
  const [lemma, setLemma] = useState(entry.lemma || "");
  const [kana, setKana] = useState(entry.kana || "");
  const [romaji, setRomaji] = useState(entry.romaji || "");
  const [meaning, setMeaning] = useState(entry.main_meaning || "");
  const [type, setType] = useState(entry.type || "");
  const [jlpt, setJlpt] = useState(entry.jlpt_level || "");
  const [saving, setSaving] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-3xl p-5 w-full max-w-sm shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-black text-slate-900 border-b border-gray-100 pb-2">Editar Flashcard</h3>
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
          {[
            { l: "Kanji / Lema", v: lemma, s: setLemma, c: "font-bold" },
            { l: "Leitura Kana", v: kana, s: setKana, c: "" },
            { l: "Romaji", v: romaji, s: setRomaji, c: "font-mono text-xs" },
            { l: "Significado PT", v: meaning, s: setMeaning, c: "" },
          ].map((f) => (
            <div key={f.l} className="space-y-1">
              <label className="field-label">{f.l}</label>
              <input value={f.v} onChange={(e) => f.s(e.target.value)}
                className={`w-full px-3 py-2 text-sm bg-white border border-[#E5E5E7] rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 ${f.c}`} />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="field-label">Categoria</label>
              <select value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2 text-xs bg-white border border-[#E5E5E7] rounded-xl outline-none font-bold text-slate-700">
                {["substantivo", "verbo", "adjetivo", "advérbio", "partícula", "pronome", "expressão", "conector", "outro"].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="field-label">JLPT</label>
              <select value={jlpt} onChange={(e) => setJlpt(e.target.value)} className="w-full px-3 py-2 text-xs bg-white border border-[#E5E5E7] rounded-xl outline-none font-bold text-slate-700">
                <option value="">—</option>
                {["N5", "N4", "N3", "N2", "N1"].map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-xs bg-gray-50 hover:bg-gray-100 font-bold border border-gray-200 text-slate-500 rounded-xl uppercase tracking-wide">Cancelar</button>
          <button disabled={saving} onClick={async () => { setSaving(true); await onSave({ lemma: lemma.trim(), kana: kana.trim(), romaji: romaji.trim(), main_meaning: meaning.trim(), type: type.trim(), jlpt_level: jlpt.trim(), status: "reviewed" }); }}
            className="flex-1 py-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 font-bold text-white rounded-xl uppercase tracking-wide disabled:opacity-60">Salvar</button>
        </div>
      </div>
    </div>
  );
}
