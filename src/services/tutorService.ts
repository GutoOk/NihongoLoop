import { DictionaryEntry, DictionaryProgress } from "../types";
import { cardRetention, isLeech, MASTERED_SENTINEL } from "../repositories/utils";
import { DeckStats, FlashcardSettings, QuickMode } from "./flashcardService";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type TutorActionKind = "quick" | "builder" | "settings" | "insights" | "none";
export interface TutorAction { kind: TutorActionKind; mode?: QuickMode; }

export type Tone = "urgent" | "suggest" | "celebrate" | "info";

export interface Recommendation {
  id: string;
  priority: number;
  tone: Tone;
  icon: string;
  title: string;
  body: string;
  actionLabel?: string;
  action?: TutorAction;
}

export type CompetencyLevel = "low" | "mid" | "good" | "great";
export interface Competency {
  key: string;
  label: string;
  score: number; // 0-100
  level: CompetencyLevel;
  hint: string;
}

export interface PlanStep {
  id: string;
  label: string;
  detail: string;
  count?: number;
  action?: TutorAction;
}

export interface LearnerProfile {
  stage: "novato" | "iniciante" | "construindo" | "avancado" | "mestre";
  headline: string;
  competencies: Competency[];
  recommendations: Recommendation[];
  plan: PlanStep[];
  bestHour: { hour: number; label: string } | null;
}

export interface TutorInput {
  entries: DictionaryEntry[];
  progress: DictionaryProgress[];
  stats: DeckStats;
  settings: FlashcardSettings;
  streak: number;
  daysStudied7: number;
  daysStudied30: number;
  todayReviews: number;
  todayNewCards: number;
  hourHistogram: number[];
  recentAgainRate: number | null;
  now?: Date;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function levelOf(score: number): CompetencyLevel {
  if (score >= 85) return "great";
  if (score >= 70) return "good";
  if (score >= 40) return "mid";
  return "low";
}

const TYPE_FRIENDLY: Record<string, string> = {
  "partícula": "as partículas", "verbo": "os verbos", "adjetivo": "os adjetivos",
  "substantivo": "os substantivos", "advérbio": "os advérbios", "expressão": "as expressões",
  "pronome": "os pronomes", "conector": "os conectores",
};

function formatHourRange(hour: number): string {
  const end = (hour + 1) % 24;
  return `${String(hour).padStart(2, "0")}h–${String(end).padStart(2, "0")}h`;
}

// ─── Core analysis ─────────────────────────────────────────────────────────────

export function analyzeLearner(input: TutorInput): LearnerProfile {
  const { entries, progress, stats, settings, streak, daysStudied7, daysStudied30, todayReviews, todayNewCards, hourHistogram, recentAgainRate } = input;

  // Aggregate signals -----------------------------------------------------------
  const started = progress.filter((p) => (p.seen_count || 0) > 0);
  const startedCount = started.length;
  const lifetimeSeen = started.reduce((s, p) => s + (p.seen_count || 0), 0);
  const lifetimeCorrect = started.reduce((s, p) => s + (p.correct_count || 0), 0);
  const accuracy = lifetimeSeen > 0 ? lifetimeCorrect / lifetimeSeen : null;

  const reviewCards = progress.filter((p) => (p.srs_interval_minutes ?? 0) >= 1440 && (p.mastery ?? 0) < MASTERED_SENTINEL && !p.suspended);
  const retentions = reviewCards.map((p) => cardRetention(p)).filter((r): r is number => r !== null);
  const trueRetention = retentions.length ? Math.round(retentions.reduce((a, b) => a + b, 0) / retentions.length) : null;

  const totalDeck = stats.total + stats.mastered; // active + mastered (excludes suspended)
  const startedActive = stats.learning + stats.young + stats.mature + stats.mastered;
  const coverage = totalDeck > 0 ? startedActive / totalDeck : 0;
  const maturePct = startedActive > 0 ? (stats.mature + stats.mastered) / startedActive : 0;

  const dueCount = stats.due;
  const newAvailable = stats.new;
  const leeches = stats.leeches;
  const newBudgetLeft = Math.max(0, settings.dailyNewLimit - todayNewCards);
  const MANAGEABLE = 60;
  const overwhelmed = dueCount > MANAGEABLE;

  // Per-type weakness -----------------------------------------------------------
  const typeById = new Map(entries.map((e) => [e.id, e.type]));
  const typeAgg: Record<string, { seen: number; wrong: number }> = {};
  for (const p of started) {
    const t = typeById.get(p.dictionary_entry_id);
    if (!t) continue;
    typeAgg[t] = typeAgg[t] || { seen: 0, wrong: 0 };
    typeAgg[t].seen += p.seen_count || 0;
    typeAgg[t].wrong += p.wrong_count || 0;
  }
  let weakestType: { type: string; rate: number } | null = null;
  for (const [type, agg] of Object.entries(typeAgg)) {
    if (agg.seen < 8) continue;
    const rate = agg.wrong / agg.seen;
    if (rate > 0.3 && (!weakestType || rate > weakestType.rate)) weakestType = { type, rate };
  }

  // Best study hour -------------------------------------------------------------
  const totalSessions = hourHistogram.reduce((a, b) => a + b, 0);
  let bestHour: { hour: number; label: string } | null = null;
  if (totalSessions >= 4) {
    let peak = 0;
    for (let h = 1; h < 24; h++) if (hourHistogram[h] > hourHistogram[peak]) peak = h;
    if (hourHistogram[peak] >= 3) bestHour = { hour: peak, label: formatHourRange(peak) };
  }

  // Competencies ----------------------------------------------------------------
  const consistencyScore = Math.round(Math.min(100, (daysStudied7 / 7) * 70 + (Math.min(streak, 14) / 14) * 30));
  const retentionScore = trueRetention ?? (accuracy !== null ? Math.round(accuracy * 100) : 0);
  const coverageScore = Math.round(coverage * 100);
  const balanceScore = dueCount <= MANAGEABLE ? 100 : Math.max(0, Math.round(100 - ((dueCount - MANAGEABLE) / MANAGEABLE) * 100));
  const masteryScore = Math.round(maturePct * 100);

  const competencies: Competency[] = [
    { key: "consistencia", label: "Consistência", score: consistencyScore, level: levelOf(consistencyScore), hint: "Estudar um pouco todos os dias." },
    { key: "retencao", label: "Retenção", score: retentionScore, level: levelOf(retentionScore), hint: "O quanto você lembra no momento certo." },
    { key: "cobertura", label: "Cobertura", score: coverageScore, level: levelOf(coverageScore), hint: "Quanto do seu vocabulário você já iniciou." },
    { key: "equilibrio", label: "Equilíbrio", score: balanceScore, level: levelOf(balanceScore), hint: "Revisões em dia, sem acúmulo." },
    { key: "dominio", label: "Domínio", score: masteryScore, level: levelOf(masteryScore), hint: "Cartas que viraram memória de longo prazo." },
  ];

  // Stage -----------------------------------------------------------------------
  let stage: LearnerProfile["stage"];
  if (startedCount < 5) stage = "novato";
  else if (startedCount < 50) stage = "iniciante";
  else if (maturePct < 0.5) stage = "construindo";
  else if (coverage < 0.9 || newAvailable > 0) stage = "avancado";
  else stage = "mestre";

  // Recommendations -------------------------------------------------------------
  const recs: Recommendation[] = [];
  const push = (r: Recommendation | null) => { if (r) recs.push(r); };

  // A — Onboarding
  if (startedCount < 5) {
    push({
      id: "onboarding", priority: 100, tone: "info", icon: "compass",
      title: "Bem-vindo! Vamos começar pelo essencial",
      body: "Comece com poucas cartas novas por dia (10 a 15 é o ideal). O sistema vai te mostrar cada palavra de novo no momento exato em que você está prestes a esquecê-la — é assim que a memória se fixa sem esforço. Não tente decorar tudo de uma vez: confie no espaçamento.",
      actionLabel: "Aprender meus primeiros cards", action: { kind: "quick", mode: "new" },
    });
  }

  // B — Overdue backlog
  if (overwhelmed) {
    push({
      id: "backlog", priority: 92, tone: "urgent", icon: "alert",
      title: "Vamos colocar as revisões em dia",
      body: `Você tem ${dueCount} cartas vencidas. Não se preocupe com a pilha: priorize as revisões antes de adicionar cartas novas e faça sessões curtas e frequentes (15–20 cartas por vez). Cada revisão atrasada ainda conta — o importante é reduzir aos poucos, sem ansiedade.`,
      actionLabel: "Revisar vencidas agora", action: { kind: "quick", mode: "due" },
    });
  }

  // D — Today's review pending
  if (todayReviews === 0 && (dueCount > 0 || newAvailable > 0) && startedCount >= 5 && !overwhelmed) {
    push({
      id: "today", priority: 90, tone: "suggest", icon: "play",
      title: "Sua dose de hoje está esperando",
      body: dueCount > 0
        ? `Há ${dueCount} cartas prontas para revisão. Revisar hoje mantém a curva de memória no ponto certo — adiar faz a retenção cair e torna a próxima sessão mais difícil. Bastam alguns minutos.`
        : "Você está em dia com as revisões! Que tal aprender algumas cartas novas para continuar avançando hoje?",
      actionLabel: "Começar agora", action: { kind: "quick", mode: "smart" },
    });
  }

  // J — Low retention
  if (trueRetention !== null && reviewCards.length >= 12 && trueRetention < 75) {
    push({
      id: "low-retention", priority: 85, tone: "urgent", icon: "target",
      title: "Reforce a base antes de acelerar",
      body: `Sua retenção média está em ${trueRetention}%. Isso indica que cartas novas estão entrando rápido demais. Reduza a meta de novos por alguns dias, priorize as revisões e ative as frases de exemplo e o áudio — associar som, contexto e significado fortalece a memória.`,
      actionLabel: "Ajustar meta de novos", action: { kind: "settings" },
    });
  }

  // E — Leeches
  if (leeches >= 3) {
    push({
      id: "leeches", priority: 76, tone: "suggest", icon: "alert",
      title: "Domine as palavras teimosas",
      body: `${leeches} palavras vêm escapando com frequência. Para cada uma, crie um mnemônico (uma imagem ou história absurda gruda melhor), decomponha o kanji em partes e estude-a dentro de uma frase. Repetir a mesma carta sem mudar a estratégia raramente funciona.`,
      actionLabel: "Treinar palavras difíceis", action: { kind: "quick", mode: "leech" },
    });
  }

  // F — Type weakness
  if (weakestType) {
    const friendly = TYPE_FRIENDLY[weakestType.type] || `os termos do tipo "${weakestType.type}"`;
    push({
      id: "type-weak", priority: 70, tone: "suggest", icon: "filter",
      title: `Atenção especial para ${friendly}`,
      body: `Seus erros se concentram em ${friendly} (${Math.round(weakestType.rate * 100)}% de tropeços). Faça uma sessão focada nesse tipo e estude-os sempre em contexto: ${weakestType.type === "partícula" ? "partículas só fazem sentido dentro da frase, nunca isoladas." : "ver o termo em uso revela nuances que a tradução sozinha esconde."}`,
      actionLabel: "Sessão personalizada", action: { kind: "builder" },
    });
  }

  // C — Inconsistent habit
  if (startedCount >= 10 && daysStudied7 < 3 && streak < 2) {
    push({
      id: "consistency", priority: 66, tone: "suggest", icon: "calendar",
      title: "Construa o hábito diário",
      body: "Consistência vence volume: 10 minutos todos os dias rendem muito mais que uma maratona semanal. Escolha um horário fixo e ancore o estudo a algo que você já faz (após o café, antes de dormir). Revisar à noite ainda ajuda o cérebro a consolidar durante o sono.",
      actionLabel: "Estudo rápido", action: { kind: "quick", mode: "smart" },
    });
  }

  // G — Plateau / advance
  if (dueCount === 0 && newAvailable > 0 && newBudgetLeft > 0 && !overwhelmed && startedCount >= 20) {
    push({
      id: "advance", priority: 56, tone: "suggest", icon: "trending",
      title: "Tudo revisado — hora de avançar",
      body: `Você está em dia e ainda há ${newAvailable} palavras esperando. Este é o momento perfeito para introduzir cartas novas no seu ritmo. Avançar com a base em ordem é o jeito mais seguro de crescer sem acumular dívida de revisões.`,
      actionLabel: "Aprender cards novos", action: { kind: "quick", mode: "new" },
    });
  }

  // H — Caught up, nothing new to add
  if (dueCount === 0 && newAvailable === 0 && startedCount >= 30) {
    push({
      id: "expand", priority: 50, tone: "celebrate", icon: "sparkles",
      title: "Você esgotou seu baralho atual!",
      body: "Todas as cartas disponíveis já estão em rotação. Para continuar crescendo, importe novos textos na tela inicial e estude o vocabulário em contexto — frases reais consolidam o que os cartões iniciam. Considerar materiais de um nível JLPT acima também abre espaço para evoluir.",
    });
  }

  // I — High performer optimize
  if (trueRetention !== null && trueRetention >= 90 && reviewCards.length >= 30) {
    push({
      id: "optimize", priority: 46, tone: "info", icon: "zap",
      title: "Otimize seu tempo de estudo",
      body: "Sua retenção está excelente — sinal de que você pode trabalhar com mais cartas novas por dia sem perder qualidade. Se quiser ganhar eficiência, uma retenção-alvo um pouco menor espaça mais as revisões, liberando tempo para conteúdo novo. Você está pronto para acelerar.",
      actionLabel: "Aumentar meta diária", action: { kind: "settings" },
    });
  }

  // L — Best time insight
  if (bestHour) {
    push({
      id: "best-time", priority: 32, tone: "info", icon: "clock",
      title: "Seu melhor horário de estudo",
      body: `Você costuma estudar com mais frequência por volta das ${bestHour.label}. Aproveitar o horário em que você já é constante torna o hábito mais fácil de manter. Que tal reservar esse momento como seu compromisso diário de estudo?`,
    });
  }

  // K — Streak celebrate
  if (streak >= 7) {
    push({
      id: "streak", priority: 22, tone: "celebrate", icon: "flame",
      title: `${streak} dias seguidos — excelente!`,
      body: "Sua constância está construindo memória de longo prazo de forma quase automática. Mantenha o ritmo, mesmo nos dias corridos: uma sessão curta preserva a sequência e a curva de retenção. O progresso composto é silencioso, mas poderoso.",
    });
  }

  recs.sort((a, b) => b.priority - a.priority);

  // Today plan ------------------------------------------------------------------
  const plan: PlanStep[] = [];
  if (dueCount > 0) {
    plan.push({ id: "p-due", label: "Revisar vencidas", detail: "Comece pelas revisões para fixar o que já aprendeu.", count: Math.min(dueCount, settings.dailyReviewLimit || dueCount), action: { kind: "quick", mode: "due" } });
  }
  if (newBudgetLeft > 0 && newAvailable > 0 && dueCount < 80) {
    plan.push({ id: "p-new", label: "Aprender novas", detail: `Introduza até ${Math.min(newBudgetLeft, newAvailable)} cartas novas no seu ritmo.`, count: Math.min(newBudgetLeft, newAvailable), action: { kind: "quick", mode: "new" } });
  }
  if (leeches >= 3) {
    plan.push({ id: "p-leech", label: "Reforçar difíceis", detail: "Dedique atenção às palavras que mais escapam.", count: leeches, action: { kind: "quick", mode: "leech" } });
  }
  if (plan.length === 0) {
    plan.push({ id: "p-free", label: "Praticar livremente", detail: dueCount === 0 && newAvailable === 0 ? "Acervo em dia! Importe novos textos para crescer." : "Sem pendências agora — revise favoritos ou descanse.", action: { kind: "quick", mode: "smart" } });
  }

  // Headline / stage --------------------------------------------------------------
  const STAGE_HEADLINES: Record<LearnerProfile["stage"], string> = {
    novato: "Vamos dar os primeiros passos no japonês.",
    iniciante: "Você está formando sua base — continue firme.",
    construindo: "Boa base! Agora é consolidar e ganhar profundidade.",
    avancado: "Ótimo progresso. Falta pouco para dominar o acervo.",
    mestre: "Nível avançado — hora de expandir horizontes.",
  };
  const headline = recs[0]?.title || STAGE_HEADLINES[stage];

  return { stage, headline, competencies, recommendations: recs, plan, bestHour };
}
