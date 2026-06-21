export type TermColor = {
  name: string;
  text: string;
  bg: string;
  border: string;
};

export const TERM_COLORS: Record<string, TermColor> = {
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
  adverbio: {
    name: "Adverbio",
    text: "text-teal-700",
    bg: "bg-teal-50 border border-teal-200 hover:bg-teal-100",
    border: "border-teal-200",
  },
  pronome: {
    name: "Pronome",
    text: "text-sky-700",
    bg: "bg-sky-50 border border-sky-200 hover:bg-sky-100",
    border: "border-sky-200",
  },
  particula: {
    name: "Particula",
    text: "text-slate-600",
    bg: "bg-transparent border border-emerald-100 hover:bg-emerald-50",
    border: "border-emerald-100",
  },
  expressao: {
    name: "Expressao",
    text: "text-purple-700",
    bg: "bg-purple-50 border border-purple-200 hover:bg-purple-100",
    border: "border-purple-200",
  },
  conector: {
    name: "Conector",
    text: "text-slate-600",
    bg: "bg-transparent border border-cyan-100 hover:bg-cyan-50",
    border: "border-cyan-100",
  },
  auxiliar: {
    name: "Auxiliar",
    text: "text-slate-600",
    bg: "bg-transparent border border-slate-200 hover:bg-slate-50",
    border: "border-slate-200",
  },
  tempo: {
    name: "Tempo",
    text: "text-blue-700",
    bg: "bg-blue-50 border border-blue-200 hover:bg-blue-100",
    border: "border-blue-200",
  },
  lugar: {
    name: "Lugar",
    text: "text-yellow-700",
    bg: "bg-yellow-50 border border-yellow-200 hover:bg-yellow-100",
    border: "border-yellow-200",
  },
  outro: {
    name: "Outro",
    text: "text-slate-600",
    bg: "bg-slate-50 border border-slate-200 hover:bg-slate-100",
    border: "border-slate-200",
  },
};

export function normalizeTypeKey(type?: string | null): string {
  const value = (type || "outro")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const aliases: Record<string, string> = {
    particle: "particula",
    adverb: "adverbio",
    expression: "expressao",
    auxiliary: "auxiliar",
  };
  return aliases[value] || value;
}

export function isLowEmphasisTerm(type?: string | null): boolean {
  return ["particula", "auxiliar", "conector"].includes(normalizeTypeKey(type));
}

export function getTermColor(type?: string | null): TermColor {
  return TERM_COLORS[normalizeTypeKey(type)] || TERM_COLORS.outro;
}
