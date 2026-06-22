import React from "react";
import { CardState } from "../../repositories/utils";

// ─── Color tokens ──────────────────────────────────────────────────────────────

export const STATE_META: Record<CardState, { label: string; bg: string; text: string; dot: string }> = {
  new:      { label: "Novo",      bg: "bg-violet-100",  text: "text-violet-700",  dot: "#8b5cf6" },
  learning: { label: "Aprendendo", bg: "bg-amber-100",  text: "text-amber-700",   dot: "#f59e0b" },
  young:    { label: "Jovem",     bg: "bg-sky-100",     text: "text-sky-700",     dot: "#0ea5e9" },
  mature:   { label: "Maduro",    bg: "bg-emerald-100", text: "text-emerald-700", dot: "#10b981" },
  mastered: { label: "Dominado",  bg: "bg-teal-100",    text: "text-teal-700",    dot: "#14b8a6" },
};

// ─── Progress ring ─────────────────────────────────────────────────────────────

interface RingProps {
  value: number;        // 0-100
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  label?: string;
  sublabel?: string;
}

export function ProgressRing({ value, size = 88, stroke = 8, color = "#6366f1", track = "#eef2ff", label, sublabel }: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${(pct / 100) * c} ${c}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {label !== undefined && <span className="text-lg font-black text-gray-900 leading-none">{label}</span>}
        {sublabel && <span className="text-[8px] font-bold uppercase tracking-wider text-gray-400 mt-0.5">{sublabel}</span>}
      </div>
    </div>
  );
}

// ─── Small retention ring (in-card) ────────────────────────────────────────────

export function RetentionRing({ value }: { value: number }) {
  const r = 16, c = 2 * Math.PI * r;
  const color = value >= 80 ? "#22c55e" : value >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" stroke="#f1f5f9" strokeWidth="3.5" />
        <circle cx="20" cy="20" r={r} fill="none" stroke={color} strokeWidth="3.5"
          strokeDasharray={`${(value / 100) * c} ${c}`} strokeLinecap="round" transform="rotate(-90 20 20)" />
        <text x="20" y="24" textAnchor="middle" fontSize="10" fontWeight="900" fill={color}>{value}</text>
      </svg>
      <span className="text-[7px] text-gray-400 font-bold uppercase tracking-wider">Retenção</span>
    </div>
  );
}

// ─── Segmented bar (maturity breakdown) ────────────────────────────────────────

interface Segment { value: number; color: string; label: string; }

export function SegmentedBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="space-y-2">
      <div className="h-3 w-full rounded-full overflow-hidden flex bg-gray-100">
        {segments.map((s, i) => s.value > 0 && (
          <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            className="h-full transition-all duration-500" />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
            <span className="text-[10px] font-bold text-gray-500">{s.label}</span>
            <span className="text-[10px] font-black text-gray-800">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── State badge ───────────────────────────────────────────────────────────────

export function StateBadge({ state }: { state: CardState }) {
  const m = STATE_META[state];
  return <span className={`px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${m.bg} ${m.text} rounded-md`}>{m.label}</span>;
}

// ─── Heatmap ───────────────────────────────────────────────────────────────────

export function Heatmap({ data }: { data: { date: string; count: number }[] }) {
  // group into weeks (columns), 7 rows
  const weeks: { date: string; count: number }[][] = [];
  for (let i = 0; i < data.length; i += 7) weeks.push(data.slice(i, i + 7));
  const max = Math.max(1, ...data.map((d) => d.count));
  const shade = (count: number) => {
    if (count === 0) return "#f1f5f9";
    const t = count / max;
    if (t > 0.66) return "#4338ca";
    if (t > 0.33) return "#6366f1";
    return "#c7d2fe";
  };
  return (
    <div className="flex gap-[3px] overflow-x-auto pb-1">
      {weeks.map((week, wi) => (
        <div key={wi} className="flex flex-col gap-[3px]">
          {week.map((d, di) => (
            <div key={di} title={`${d.date}: ${d.count} revisões`}
              className="w-2.5 h-2.5 rounded-[2px]" style={{ background: shade(d.count) }} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Mini bar chart (forecast) ─────────────────────────────────────────────────

export function MiniBars({ values, labels, color = "#6366f1" }: { values: number[]; labels: string[]; color?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end justify-between gap-1.5 h-24">
      {values.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
          <span className="text-[9px] font-black text-gray-600">{v || ""}</span>
          <div className="w-full rounded-t-md transition-all duration-500 min-h-[2px]"
            style={{ height: `${(v / max) * 100}%`, background: v ? color : "#e5e7eb" }} />
          <span className="text-[8px] font-bold text-gray-400 uppercase">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Stat pill ─────────────────────────────────────────────────────────────────

export function StatPill({ value, label, bg, text }: { value: number | string; label: string; bg: string; text: string }) {
  return (
    <div className={`${bg} rounded-2xl p-3 flex flex-col items-center justify-center`}>
      <span className={`text-xl font-black ${text} leading-none`}>{value}</span>
      <span className="text-[8px] font-bold uppercase tracking-wider text-gray-500 mt-1 text-center leading-tight">{label}</span>
    </div>
  );
}
