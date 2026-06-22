import React, { useMemo } from "react";
import { Flame, TrendingUp, Calendar, AlertCircle, Target, Layers, Award } from "lucide-react";
import { DictionaryEntry, DictionaryProgress } from "../../types";
import { forecastDueReviews, isLeech, cardRetention } from "../../repositories/utils";
import { DeckStats } from "../../services/flashcardService";
import { SegmentedBar, Heatmap, MiniBars, StatPill, ProgressRing } from "./FlashcardAtoms";

interface InsightsProps {
  stats: DeckStats;
  streak: number;
  heatmap: { date: string; count: number }[];
  progressList: DictionaryProgress[];
  entries: DictionaryEntry[];
  onStudyLeeches: () => void;
  onReactivateCard: (entryId: string) => void;
  onReturnToReview: (entryId: string) => void;
  onResetProgress: (entryId: string) => void;
}

const DAY_LABELS = ["Hoje", "+1", "+2", "+3", "+4", "+5", "+6"];

export default function FlashcardInsights({
  stats, streak, heatmap, progressList, entries, onStudyLeeches,
  onReactivateCard, onReturnToReview, onResetProgress,
}: InsightsProps) {
  const forecast = useMemo(() => forecastDueReviews(progressList, 7), [progressList]);

  const trueRetention = useMemo(() => {
    const reviewCards = progressList.filter((p) => (p.srs_interval_minutes ?? 0) >= 1440 && (p.mastery ?? 0) < 999999 && !p.suspended);
    const rs = reviewCards.map((p) => cardRetention(p)).filter((r): r is number => r !== null);
    if (rs.length === 0) return null;
    return Math.round(rs.reduce((a, b) => a + b, 0) / rs.length);
  }, [progressList]);

  const totalReviews = useMemo(() => progressList.reduce((s, p) => s + (p.seen_count || 0), 0), [progressList]);
  const last30 = heatmap.slice(-30).reduce((s, d) => s + d.count, 0);

  const leeches = useMemo(() => {
    const map = new Map(entries.map((e) => [e.id, e]));
    return progressList
      .filter((p) => isLeech(p))
      .map((p) => ({ entry: map.get(p.dictionary_entry_id), wrong: p.wrong_count }))
      .filter((x) => x.entry)
      .sort((a, b) => b.wrong - a.wrong)
      .slice(0, 8);
  }, [progressList, entries]);

  const masteredPct = stats.total + stats.mastered > 0
    ? Math.round((stats.mastered / (stats.total + stats.mastered)) * 100) : 0;

  const hiddenCards = useMemo(() => {
    const map = new Map(entries.map((e) => [e.id, e]));
    return progressList
      .filter((p) => p.suspended || (p.mastery ?? 0) >= 999999)
      .map((p) => ({ progress: p, entry: map.get(p.dictionary_entry_id) }))
      .filter((x) => x.entry)
      .slice(0, 12);
  }, [progressList, entries]);

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {/* Streak + retention hero */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-orange-500 to-rose-500 rounded-2xl p-4 text-white flex flex-col justify-between">
          <Flame className="w-6 h-6 fill-white/30" />
          <div>
            <span className="text-3xl font-black leading-none">{streak}</span>
            <p className="text-[10px] font-bold uppercase tracking-wide text-orange-100 mt-1">dias seguidos</p>
          </div>
        </div>
        <div className="bg-white border border-[#E5E5E7] rounded-2xl p-4 flex flex-col items-center justify-center">
          <ProgressRing value={trueRetention ?? 0} size={76} stroke={7}
            label={trueRetention !== null ? `${trueRetention}%` : "—"}
            color={(trueRetention ?? 0) >= 85 ? "#10b981" : (trueRetention ?? 0) >= 70 ? "#f59e0b" : "#ef4444"} />
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mt-1">Retenção média</p>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatPill value={totalReviews} label="Revisões totais" bg="bg-indigo-50" text="text-indigo-700" />
        <StatPill value={last30} label="Últimos 30 dias" bg="bg-violet-50" text="text-violet-700" />
        <StatPill value={`${masteredPct}%`} label="Dominado" bg="bg-teal-50" text="text-teal-700" />
      </div>

      {/* Maturity */}
      <div className="bg-white rounded-2xl border border-[#E5E5E7] p-4 space-y-3">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> Maturidade</span>
        <SegmentedBar segments={[
          { value: stats.new, color: "#8b5cf6", label: "Novos" },
          { value: stats.learning, color: "#f59e0b", label: "Aprend." },
          { value: stats.young, color: "#0ea5e9", label: "Jovens" },
          { value: stats.mature, color: "#10b981", label: "Maduros" },
          { value: stats.mastered, color: "#14b8a6", label: "Dominados" },
        ]} />
      </div>

      {/* Forecast */}
      <div className="bg-white rounded-2xl border border-[#E5E5E7] p-4 space-y-3">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" /> Próximas Revisões (7 dias)</span>
        <MiniBars values={forecast} labels={DAY_LABELS} />
      </div>

      {/* Activity heatmap */}
      <div className="bg-white rounded-2xl border border-[#E5E5E7] p-4 space-y-3">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Atividade</span>
        <Heatmap data={heatmap} />
        <div className="flex items-center justify-end gap-1.5 text-[8px] font-bold text-gray-400 uppercase">
          Menos
          <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: "#f1f5f9" }} />
          <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: "#c7d2fe" }} />
          <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: "#6366f1" }} />
          <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: "#4338ca" }} />
          Mais
        </div>
      </div>

      {/* Leeches */}
      {leeches.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#E5E5E7] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-rose-500 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Palavras Difíceis</span>
            <button onClick={onStudyLeeches} className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700">Estudar →</button>
          </div>
          <div className="space-y-1.5">
            {leeches.map(({ entry, wrong }) => (
              <div key={entry!.id} className="flex items-center justify-between bg-rose-50/50 rounded-lg px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-black text-gray-900">{entry!.lemma}</span>
                  <span className="text-[11px] text-gray-500">{entry!.main_meaning}</span>
                </div>
                <span className="text-[10px] font-black text-rose-600">{wrong} erros</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {hiddenCards.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#E5E5E7] p-4 space-y-3">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Cards ocultos</span>
          <div className="space-y-1.5">
            {hiddenCards.map(({ entry, progress }) => {
              const mastered = (progress.mastery ?? 0) >= 999999;
              return (
                <div key={entry!.id} className="bg-slate-50 rounded-xl px-3 py-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-gray-900 truncate">{entry!.lemma}</p>
                      <p className="text-[11px] text-gray-500 truncate">{entry!.main_meaning}</p>
                    </div>
                    <span className="text-[9px] font-black uppercase text-slate-500">{progress.suspended ? "Suspenso" : "Dominado"}</span>
                  </div>
                  <div className="flex gap-1.5">
                    {progress.suspended && (
                      <button onClick={() => onReactivateCard(entry!.id)} className="flex-1 py-1.5 text-[10px] font-black uppercase rounded-lg bg-white border border-slate-200 text-slate-700">Reativar</button>
                    )}
                    {mastered && (
                      <button onClick={() => onReturnToReview(entry!.id)} className="flex-1 py-1.5 text-[10px] font-black uppercase rounded-lg bg-white border border-slate-200 text-slate-700">Revisao</button>
                    )}
                    <button onClick={() => onResetProgress(entry!.id)} className="flex-1 py-1.5 text-[10px] font-black uppercase rounded-lg bg-rose-50 border border-rose-100 text-rose-700">Resetar</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {stats.total === 0 && stats.mastered === 0 && (
        <div className="text-center py-8 text-gray-400">
          <Award className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm font-bold">Estude alguns cards para ver suas estatísticas.</p>
        </div>
      )}
    </div>
  );
}
