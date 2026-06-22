import React from "react";
import {
  Zap, Flame, Clock, Sparkles, Star, AlertCircle, Plus, Trash2,
  SlidersHorizontal, BarChart3, Brain, BookOpen, Volume2, Moon, Shuffle, ChevronRight,
} from "lucide-react";
import { CustomDeck, DeckStats, QuickMode } from "../../services/flashcardService";
import { ProgressRing, StatPill, SegmentedBar } from "./FlashcardAtoms";

const TIP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  brain: Brain, clock: Clock, volume: Volume2, book: BookOpen, moon: Moon,
  shuffle: Shuffle, alert: AlertCircle, flame: Flame, sparkles: Sparkles,
};

const DECK_COLOR_CLASSES: Record<string, string> = {
  indigo: "from-indigo-500 to-indigo-600", violet: "from-violet-500 to-violet-600",
  emerald: "from-emerald-500 to-emerald-600", sky: "from-sky-500 to-sky-600",
  amber: "from-amber-500 to-amber-600", rose: "from-rose-500 to-rose-600",
  teal: "from-teal-500 to-teal-600", fuchsia: "from-fuchsia-500 to-fuchsia-600",
};

interface HubProps {
  stats: DeckStats;
  streak: number;
  todayReviews: number;
  dailyGoal: number;
  decks: CustomDeck[];
  tip: { icon: string; title: string; text: string };
  onQuickStart: (mode: QuickMode) => void;
  onStartDeck: (deck: CustomDeck) => void;
  onDeleteDeck: (id: string) => void;
  onCustomize: () => void;
  onInsights: () => void;
}

export default function FlashcardHub({
  stats, streak, todayReviews, dailyGoal, decks, tip,
  onQuickStart, onStartDeck, onDeleteDeck, onCustomize, onInsights,
}: HubProps) {
  const TipIcon = TIP_ICONS[tip.icon] || Sparkles;
  const goalPct = dailyGoal > 0 ? Math.min(100, (todayReviews / dailyGoal) * 100) : 0;
  const pendingTotal = stats.due + Math.min(stats.new, dailyGoal);

  const quickModes: { mode: QuickMode; label: string; count: number; Icon: any; cls: string }[] = [
    { mode: "due", label: "Vencidos", count: stats.due, Icon: Clock, cls: "text-amber-600 bg-amber-50 border-amber-100" },
    { mode: "new", label: "Novos", count: stats.new, Icon: Sparkles, cls: "text-violet-600 bg-violet-50 border-violet-100" },
    { mode: "leech", label: "Difíceis", count: stats.leeches, Icon: AlertCircle, cls: "text-rose-600 bg-rose-50 border-rose-100" },
    { mode: "favorite", label: "Favoritos", count: stats.favorites, Icon: Star, cls: "text-yellow-600 bg-yellow-50 border-yellow-100" },
  ];

  return (
    <div className="flex-1 overflow-auto p-4 space-y-5">
      {/* Daily goal + streak hero */}
      <div className="bg-white rounded-3xl border border-[#E5E5E7] shadow-sm p-5">
        <div className="flex items-center gap-5">
          <ProgressRing
            value={goalPct}
            label={`${todayReviews}`}
            sublabel={`/ ${dailyGoal} meta`}
            color={goalPct >= 100 ? "#10b981" : "#6366f1"}
            track="#eef2ff"
          />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-1.5">
              <Flame className={`w-5 h-5 ${streak > 0 ? "text-orange-500 fill-orange-500" : "text-gray-300"}`} />
              <span className="text-2xl font-black text-gray-900">{streak}</span>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">dias seguidos</span>
            </div>
            <p className="text-xs text-gray-500 leading-snug">
              {goalPct >= 100
                ? "Meta diária concluída! 🎉"
                : todayReviews > 0
                  ? `${dailyGoal - todayReviews} cards para a meta de hoje.`
                  : "Comece sua sessão diária para manter a sequência."}
            </p>
          </div>
        </div>
      </div>

      {/* Smart study CTA */}
      <button onClick={() => onQuickStart("smart")}
        className="w-full bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 active:scale-[0.98] text-white rounded-3xl p-5 shadow-lg shadow-indigo-200 transition-all flex items-center justify-between">
        <div className="text-left">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 fill-white" />
            <span className="text-lg font-black uppercase tracking-wide">Estudo Rápido</span>
          </div>
          <p className="text-xs text-indigo-100 mt-1 font-medium">
            {pendingTotal > 0 ? `${pendingTotal} cards prontos · revisões + novos` : "Tudo em dia — pratique livremente"}
          </p>
        </div>
        <ChevronRight className="w-6 h-6 text-indigo-200" />
      </button>

      {/* Quick modes */}
      <div className="grid grid-cols-4 gap-2">
        {quickModes.map(({ mode, label, count, Icon, cls }) => (
          <button key={mode} onClick={() => onQuickStart(mode)} disabled={count === 0}
            className={`border-2 rounded-2xl p-3 flex flex-col items-center gap-1.5 transition-all active:scale-95 disabled:opacity-40 disabled:active:scale-100 ${cls}`}>
            <Icon className="w-4 h-4" />
            <span className="text-base font-black leading-none">{count}</span>
            <span className="text-[8px] font-bold uppercase tracking-wide text-gray-500">{label}</span>
          </button>
        ))}
      </div>

      {/* Maturity overview */}
      <div className="bg-white rounded-2xl border border-[#E5E5E7] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Maturidade do Acervo</span>
          <button onClick={onInsights} className="text-[10px] font-bold text-indigo-600 flex items-center gap-0.5 hover:text-indigo-700">
            <BarChart3 className="w-3 h-3" /> Progresso
          </button>
        </div>
        <SegmentedBar segments={[
          { value: stats.new, color: "#8b5cf6", label: "Novos" },
          { value: stats.learning, color: "#f59e0b", label: "Aprend." },
          { value: stats.young, color: "#0ea5e9", label: "Jovens" },
          { value: stats.mature, color: "#10b981", label: "Maduros" },
          { value: stats.mastered, color: "#14b8a6", label: "Dominados" },
        ]} />
      </div>

      {/* My decks */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Meus Baralhos</span>
          <button onClick={onCustomize} className="text-[10px] font-bold text-indigo-600 flex items-center gap-0.5 hover:text-indigo-700">
            <Plus className="w-3 h-3" /> Criar
          </button>
        </div>
        {decks.length === 0 ? (
          <button onClick={onCustomize}
            className="w-full border-2 border-dashed border-gray-200 rounded-2xl p-4 text-center hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
            <SlidersHorizontal className="w-5 h-5 text-gray-300 mx-auto mb-1" />
            <p className="text-xs font-bold text-gray-400">Crie baralhos personalizados</p>
            <p className="text-[10px] text-gray-400 mt-0.5">Filtros, direção e limites salvos</p>
          </button>
        ) : (
          <div className="space-y-2">
            {decks.map((deck) => (
              <div key={deck.id}
                className={`bg-gradient-to-br ${DECK_COLOR_CLASSES[deck.color] || DECK_COLOR_CLASSES.indigo} rounded-2xl p-0.5 shadow-sm`}>
                <div className="bg-white rounded-[14px] p-3 flex items-center justify-between">
                  <button onClick={() => onStartDeck(deck)} className="flex-1 text-left flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${DECK_COLOR_CLASSES[deck.color] || DECK_COLOR_CLASSES.indigo} flex items-center justify-center`}>
                      <BookOpen className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-gray-900 leading-tight">{deck.name}</p>
                      <p className="text-[10px] text-gray-400 font-medium">
                        {deck.config.mode === "ja_pt" ? "JP→PT" : deck.config.mode === "pt_ja" ? "PT→JP" : "Áudio"}
                        {" · "}{deck.config.order === "due" ? "por vencimento" : deck.config.order}
                      </p>
                    </div>
                  </button>
                  <button onClick={() => onDeleteDeck(deck.id)} className="p-2 text-gray-300 hover:text-rose-500 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Customize CTA */}
      <button onClick={onCustomize}
        className="w-full py-3 border-2 border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/30 rounded-2xl text-xs font-black uppercase tracking-wider text-gray-600 flex items-center justify-center gap-2 transition-all">
        <SlidersHorizontal className="w-4 h-4" /> Sessão Personalizada
      </button>

      {/* Study tip */}
      <div className="bg-gradient-to-br from-slate-50 to-indigo-50/40 rounded-2xl border border-indigo-100/60 p-4 flex gap-3">
        <div className="w-9 h-9 rounded-xl bg-white shadow-sm flex items-center justify-center shrink-0">
          <TipIcon className="w-4.5 h-4.5 text-indigo-500" />
        </div>
        <div>
          <p className="text-xs font-black text-gray-800">{tip.title}</p>
          <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5">{tip.text}</p>
        </div>
      </div>
    </div>
  );
}
