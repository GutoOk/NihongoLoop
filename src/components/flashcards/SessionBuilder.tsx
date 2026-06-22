import React, { useState } from "react";
import { Zap, Save, Check } from "lucide-react";
import { Source } from "../../types";
import { CardState } from "../../repositories/utils";
import { SessionConfig, CardMode, SessionOrder, FlashcardSettings } from "../../services/flashcardService";
import { STATE_META } from "./FlashcardAtoms";

interface BuilderProps {
  sources: Source[];
  types: string[];
  levels: string[];
  settings: FlashcardSettings;
  onStart: (config: SessionConfig) => void;
  onSaveDeck: (name: string, config: SessionConfig) => void;
}

const SELECTABLE_STATES: CardState[] = ["new", "learning", "young", "mature"];
const MODES: { value: CardMode; label: string }[] = [
  { value: "ja_pt", label: "JP → PT" },
  { value: "pt_ja", label: "PT → JP" },
  { value: "audio_pt", label: "Áudio → PT" },
];
const ORDERS: { value: SessionOrder; label: string }[] = [
  { value: "due", label: "Vencimento" },
  { value: "difficulty", label: "Dificuldade" },
  { value: "jlpt", label: "Nível JLPT" },
  { value: "random", label: "Aleatório" },
];

export default function SessionBuilder({ sources, types, levels, settings, onStart, onSaveDeck }: BuilderProps) {
  const [filterBy, setFilterBy] = useState<"all" | "source" | "type" | "level">("all");
  const [sourceId, setSourceId] = useState("");
  const [type, setType] = useState("");
  const [level, setLevel] = useState("");
  const [states, setStates] = useState<CardState[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [mode, setMode] = useState<CardMode>(settings.defaultMode);
  const [order, setOrder] = useState<SessionOrder>("due");
  const [onlyDue, setOnlyDue] = useState(true);
  const [newLimit, setNewLimit] = useState(settings.dailyNewLimit);
  const [reviewLimit, setReviewLimit] = useState(settings.dailyReviewLimit || 0);
  const [showSave, setShowSave] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  const buildConfig = (): SessionConfig => ({
    sourceId: filterBy === "source" ? sourceId || undefined : undefined,
    type: filterBy === "type" ? type || undefined : undefined,
    jlpt_level: filterBy === "level" ? level || undefined : undefined,
    states: states.length ? states : undefined,
    favoritesOnly: favoritesOnly || undefined,
    mode, order, onlyDue, newLimit, reviewLimit,
  });

  const toggleState = (s: CardState) =>
    setStates((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);

  const handleSave = () => {
    if (!deckName.trim()) return;
    onSaveDeck(deckName.trim(), buildConfig());
    setSavedFlash(true);
    setShowSave(false);
    setDeckName("");
    setTimeout(() => setSavedFlash(false), 1800);
  };

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {/* Filter scope */}
      <div className="bg-white rounded-2xl border border-[#E5E5E7] p-4 space-y-3">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Escopo</span>
        <select className="form-select" value={filterBy} onChange={(e) => setFilterBy(e.target.value as any)}>
          <option value="all">Todas as Palavras</option>
          <option value="source">Por Fonte</option>
          <option value="type">Por Tipo</option>
          <option value="level">Por Nível JLPT</option>
        </select>
        {filterBy === "source" && (
          <select className="form-select" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">Selecione a fonte…</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        )}
        {filterBy === "type" && (
          <select className="form-select" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Selecione o tipo…</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {filterBy === "level" && (
          <select className="form-select" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Selecione o nível…</option>
            {levels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
      </div>

      {/* States */}
      <div className="bg-white rounded-2xl border border-[#E5E5E7] p-4 space-y-3">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Estados dos cards</span>
        <p className="text-[10px] text-gray-400 -mt-1">Vazio = todos os estados</p>
        <div className="flex flex-wrap gap-2">
          {SELECTABLE_STATES.map((s) => {
            const active = states.includes(s);
            const m = STATE_META[s];
            return (
              <button key={s} onClick={() => toggleState(s)}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wide border-2 transition-all ${active ? `${m.bg} ${m.text} border-transparent` : "bg-white text-gray-400 border-gray-200"}`}>
                {m.label}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-3 cursor-pointer pt-1" onClick={() => setFavoritesOnly((v) => !v)}>
          <div className={`w-10 h-5 rounded-full transition-colors relative ${favoritesOnly ? "bg-indigo-500" : "bg-gray-200"}`}>
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${favoritesOnly ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
          <span className="text-xs font-bold text-gray-700">Apenas favoritos</span>
        </label>
      </div>

      {/* Direction */}
      <div className="bg-white rounded-2xl border border-[#E5E5E7] p-4 space-y-3">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Direção</span>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button key={m.value} onClick={() => setMode(m.value)}
              className={`py-2.5 rounded-xl text-xs font-black uppercase tracking-wide border-2 transition-all ${mode === m.value ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-500 bg-white"}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Order + limits */}
      <div className="bg-white rounded-2xl border border-[#E5E5E7] p-4 space-y-4">
        <div className="space-y-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Ordem</span>
          <div className="grid grid-cols-4 gap-1.5">
            {ORDERS.map((o) => (
              <button key={o.value} onClick={() => setOrder(o.value)}
                className={`py-2 rounded-xl text-[10px] font-black border-2 transition-all ${order === o.value ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-500 bg-white"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="field-label">Novos (máx)</label>
            <input type="number" min={0} max={200} value={newLimit}
              onChange={(e) => setNewLimit(Math.max(0, Number(e.target.value)))}
              className="form-input text-center font-black" />
          </div>
          <div className="space-y-1">
            <label className="field-label">Revisões (0=∞)</label>
            <input type="number" min={0} max={500} value={reviewLimit}
              onChange={(e) => setReviewLimit(Math.max(0, Number(e.target.value)))}
              className="form-input text-center font-black" />
          </div>
        </div>

        <label className="flex items-center gap-3 cursor-pointer" onClick={() => setOnlyDue((v) => !v)}>
          <div className={`w-10 h-5 rounded-full transition-colors relative ${onlyDue ? "bg-indigo-500" : "bg-gray-200"}`}>
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${onlyDue ? "translate-x-5" : "translate-x-0.5"}`} />
          </div>
          <span className="text-xs font-bold text-gray-700">Somente revisões vencidas</span>
        </label>
      </div>

      {/* Save as deck */}
      {showSave ? (
        <div className="bg-white rounded-2xl border-2 border-indigo-200 p-4 space-y-3">
          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Nome do baralho</span>
          <input autoFocus value={deckName} onChange={(e) => setDeckName(e.target.value)}
            placeholder="Ex.: Verbos N5 difíceis" className="form-input font-bold"
            onKeyDown={(e) => e.key === "Enter" && handleSave()} />
          <div className="flex gap-2">
            <button onClick={() => setShowSave(false)} className="flex-1 py-2.5 text-xs bg-gray-50 hover:bg-gray-100 font-bold border border-gray-200 text-slate-500 rounded-xl uppercase tracking-wide">Cancelar</button>
            <button onClick={handleSave} disabled={!deckName.trim()}
              className="flex-1 py-2.5 text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 font-bold text-white rounded-xl flex items-center justify-center gap-1 uppercase tracking-wide">
              <Save className="w-3.5 h-3.5" /> Salvar
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowSave(true)}
          className="w-full py-3 border-2 border-gray-200 hover:border-indigo-300 rounded-2xl text-xs font-black uppercase tracking-wider text-gray-600 flex items-center justify-center gap-2 transition-all">
          {savedFlash ? <><Check className="w-4 h-4 text-emerald-500" /> Baralho salvo!</> : <><Save className="w-4 h-4" /> Salvar como Baralho</>}
        </button>
      )}

      {/* Start */}
      <button onClick={() => onStart(buildConfig())}
        className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-black uppercase tracking-wider rounded-2xl text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-200 transition-all">
        <Zap className="w-4 h-4" /> Iniciar Sessão
      </button>
    </div>
  );
}
