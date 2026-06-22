import React from "react";
import {
  GraduationCap, Compass, AlertCircle, Play, Target, Filter, Calendar,
  TrendingUp, Sparkles, Zap, Clock, Flame, ChevronRight, CheckCircle2,
} from "lucide-react";
import { LearnerProfile, Recommendation, TutorAction, Tone } from "../../services/tutorService";
import { CompetencyBar } from "./FlashcardAtoms";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  compass: Compass, alert: AlertCircle, play: Play, target: Target, filter: Filter,
  calendar: Calendar, trending: TrendingUp, sparkles: Sparkles, zap: Zap, clock: Clock,
  flame: Flame, brain: GraduationCap,
};

const TONE_STYLE: Record<Tone, { ring: string; iconBg: string; iconText: string }> = {
  urgent:    { ring: "border-rose-200 bg-rose-50/40",    iconBg: "bg-rose-100",    iconText: "text-rose-600" },
  suggest:   { ring: "border-indigo-200 bg-indigo-50/30", iconBg: "bg-indigo-100",  iconText: "text-indigo-600" },
  celebrate: { ring: "border-emerald-200 bg-emerald-50/40", iconBg: "bg-emerald-100", iconText: "text-emerald-600" },
  info:      { ring: "border-slate-200 bg-slate-50/60",  iconBg: "bg-slate-100",   iconText: "text-slate-600" },
};

const STAGE_LABEL: Record<LearnerProfile["stage"], string> = {
  novato: "Começando", iniciante: "Iniciante", construindo: "Construindo base",
  avancado: "Avançado", mestre: "Mestre",
};

interface TutorViewProps {
  profile: LearnerProfile;
  onAction: (action?: TutorAction) => void;
}

export default function TutorView({ profile, onAction }: TutorViewProps) {
  const { stage, headline, competencies, recommendations, plan, bestHour } = profile;

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {/* Stage / headline */}
      <div className="bg-gradient-to-br from-indigo-600 to-violet-600 rounded-3xl p-5 text-white shadow-lg shadow-indigo-200">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-200">Tutor · {STAGE_LABEL[stage]}</p>
            <p className="text-sm font-black leading-tight">{headline}</p>
          </div>
        </div>
      </div>

      {/* Today plan */}
      <div className="bg-white rounded-2xl border border-[#E5E5E7] p-4 space-y-3">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500" /> Plano de Hoje
        </span>
        <div className="space-y-2">
          {plan.map((step, i) => (
            <button key={step.id} onClick={() => onAction(step.action)}
              className="w-full flex items-center gap-3 p-3 rounded-2xl bg-slate-50 hover:bg-indigo-50/60 transition-colors text-left group">
              <span className="w-7 h-7 rounded-full bg-indigo-600 text-white text-xs font-black flex items-center justify-center shrink-0">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-gray-900">
                  {step.label}{step.count !== undefined ? ` · ${step.count}` : ""}
                </p>
                <p className="text-[11px] text-gray-500 leading-tight">{step.detail}</p>
              </div>
              {step.action && step.action.kind !== "none" && (
                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-indigo-500 shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Competency diagnosis */}
      <div className="bg-white rounded-2xl border border-[#E5E5E7] p-4 space-y-3">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5 text-indigo-500" /> Diagnóstico de Competências
        </span>
        <div className="space-y-3">
          {competencies.map((c) => (
            <div key={c.key}>
              <CompetencyBar label={c.label} score={c.score} level={c.level} hint={c.hint} />
            </div>
          ))}
        </div>
      </div>

      {/* Recommendations */}
      <div className="space-y-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 px-1">
          Orientações para Você
        </span>
        {recommendations.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E5E5E7] p-5 text-center text-sm text-gray-400 font-medium">
            Estude alguns cards para o tutor montar suas orientações.
          </div>
        ) : (
          recommendations.map((r) => <div key={r.id}><RecommendationCard rec={r} onAction={onAction} /></div>)
        )}
      </div>

      {bestHour && (
        <p className="text-center text-[10px] text-gray-400 pb-2">
          Análise baseada no seu histórico de estudo · 100% do sistema
        </p>
      )}
    </div>
  );
}

function RecommendationCard({ rec, onAction }: { rec: Recommendation; onAction: (a?: TutorAction) => void }) {
  const Icon = ICONS[rec.icon] || Sparkles;
  const s = TONE_STYLE[rec.tone];
  return (
    <div className={`rounded-2xl border ${s.ring} p-4 space-y-2.5`}>
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-xl ${s.iconBg} ${s.iconText} flex items-center justify-center shrink-0`}>
          <Icon className="w-4.5 h-4.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-gray-900 leading-tight">{rec.title}</p>
        </div>
      </div>
      <p className="text-[12px] text-gray-600 leading-relaxed">{rec.body}</p>
      {rec.action && rec.actionLabel && rec.action.kind !== "none" && (
        <button onClick={() => onAction(rec.action)}
          className={`w-full mt-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide flex items-center justify-center gap-1.5 transition-all active:scale-95 ${s.iconBg} ${s.iconText} hover:brightness-95`}>
          {rec.actionLabel} <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
