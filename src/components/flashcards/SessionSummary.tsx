import React from "react";
import { Brain, RotateCcw, Clock, Target, TrendingUp, Home } from "lucide-react";
import { SessionResult } from "./StudyRunner";

interface SummaryProps {
  result: SessionResult;
  upcomingTomorrow: number;
  onNewSession: () => void;
  onHome: () => void;
}

export default function SessionSummary({ result, upcomingTomorrow, onNewSession, onHome }: SummaryProps) {
  const graded = result.again + result.hard + result.good + result.easy;
  const correct = result.hard + result.good + result.easy + result.learned;
  const accuracy = result.total > 0 ? Math.round((correct / result.total) * 100) : 0;
  const minutes = Math.floor(result.durationMs / 60000);
  const seconds = Math.floor((result.durationMs % 60000) / 1000);
  const avgSec = result.total > 0 ? (result.durationMs / 1000 / result.total).toFixed(1) : "0";

  const cells = [
    { key: "again", label: "De Novo", v: result.again, bg: "bg-rose-50", t: "text-rose-900", s: "text-rose-500" },
    { key: "hard", label: "Difícil", v: result.hard, bg: "bg-orange-50", t: "text-orange-900", s: "text-orange-500" },
    { key: "good", label: "Bom", v: result.good, bg: "bg-emerald-50", t: "text-emerald-900", s: "text-emerald-500" },
    { key: "easy", label: "Fácil", v: result.easy, bg: "bg-blue-50", t: "text-blue-900", s: "text-blue-500" },
    { key: "learned", label: "Dominado", v: result.learned, bg: "bg-teal-50", t: "text-teal-900", s: "text-teal-500" },
  ];

  return (
    <div className="flex-1 overflow-auto p-4 flex flex-col justify-center gap-5">
      <div className="text-center space-y-2">
        <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto border border-indigo-100">
          <Brain className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black uppercase text-gray-900">Sessão Concluída</h2>
        <p className="text-sm text-gray-500">{result.total} cards · {result.newCount} novos · {result.reviewCount} revisões</p>
      </div>

      {/* Hero metrics */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { Icon: Target, v: `${accuracy}%`, l: "Acerto", c: accuracy >= 80 ? "text-emerald-600" : accuracy >= 60 ? "text-amber-600" : "text-rose-600" },
          { Icon: Clock, v: minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`, l: "Tempo", c: "text-slate-700" },
          { Icon: TrendingUp, v: `${avgSec}s`, l: "Por card", c: "text-indigo-600" },
        ].map(({ Icon, v, l, c }) => (
          <div key={l} className="bg-white border border-[#E5E5E7] rounded-2xl p-3 flex flex-col items-center gap-1">
            <Icon className={`w-4 h-4 ${c}`} />
            <span className={`text-base font-black ${c} leading-none`}>{v}</span>
            <span className="text-[8px] font-bold uppercase tracking-wide text-gray-400">{l}</span>
          </div>
        ))}
      </div>

      {/* Rating breakdown */}
      <div className="grid grid-cols-5 gap-1.5">
        {cells.map((c) => (
          <div key={c.key} className={`${c.bg} p-2 rounded-xl flex flex-col items-center`}>
            <span className={`text-[8px] uppercase ${c.s} font-black mb-1 text-center leading-tight`}>{c.label}</span>
            <span className={`text-lg font-black ${c.t}`}>{c.v}</span>
          </div>
        ))}
      </div>

      {upcomingTomorrow > 0 && (
        <div className="bg-gradient-to-br from-slate-50 to-indigo-50/40 rounded-2xl border border-indigo-100/60 p-4 flex items-center gap-3">
          <Clock className="w-5 h-5 text-indigo-500 shrink-0" />
          <p className="text-xs text-gray-600 leading-relaxed">
            <b className="text-indigo-700">{upcomingTomorrow} cards</b> estarão prontos para revisão amanhã. Volte para manter sua sequência! 🔥
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onHome}
          className="flex-1 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-black uppercase tracking-wider rounded-2xl text-xs flex items-center justify-center gap-2 transition-all">
          <Home className="w-4 h-4" /> Início
        </button>
        <button onClick={onNewSession}
          className="flex-1 py-3.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-black uppercase tracking-wider rounded-2xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-200 transition-all">
          <RotateCcw className="w-4 h-4" /> Nova Sessão
        </button>
      </div>
    </div>
  );
}
