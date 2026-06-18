import React, { useEffect, useState } from "react";
import {
  BarChart3,
  Brain,
  HelpCircle,
  Layers,
  Play,
  Search,
  Settings,
} from "lucide-react";
import { SourceRepository } from "../repositories";
import { Source } from "../types";
import { AppNavigate, ScreenType } from "../navigation";

declare const __APP_VERSION_INFO__: {
  version: string;
  commit: string;
  commitDate: string;
  commitCount: string;
};

interface HomeScreenProps {
  onNavigate: AppNavigate;
}

interface NavCard {
  screen: ScreenType;
  icon: React.ReactNode;
  label: string;
  description: string;
  iconColor: string;
  iconBg: string;
  hover: string;
  wide?: boolean;
}

const NAV_CARDS: NavCard[] = [
  {
    screen: "sources",
    icon: <Layers className="w-5 h-5" />,
    label: "Minhas Fontes",
    description: "Gerenciar textos salvos",
    iconColor: "text-sky-600",
    iconBg: "bg-sky-50",
    hover: "hover:border-sky-200 hover:bg-sky-50/70",
  },
  {
    screen: "study",
    icon: <Play className="w-5 h-5" />,
    label: "Estudar",
    description: "Sessões de repetição",
    iconColor: "text-emerald-600",
    iconBg: "bg-emerald-50",
    hover: "hover:border-emerald-200 hover:bg-emerald-50/70",
  },
  {
    screen: "dictionary",
    icon: <Search className="w-5 h-5" />,
    label: "Dicionário",
    description: "Vocabulário extraído",
    iconColor: "text-violet-600",
    iconBg: "bg-violet-50",
    hover: "hover:border-violet-200 hover:bg-violet-50/70",
  },
  {
    screen: "statistics",
    icon: <BarChart3 className="w-5 h-5" />,
    label: "Estatísticas",
    description: "Progresso geral",
    iconColor: "text-amber-600",
    iconBg: "bg-amber-50",
    hover: "hover:border-amber-200 hover:bg-amber-50/70",
  },
  {
    screen: "flashcards",
    icon: <Brain className="w-5 h-5" />,
    label: "Flashcards (SRS)",
    description: "Estudo espaçado",
    iconColor: "text-rose-600",
    iconBg: "bg-rose-50",
    hover: "hover:border-rose-200 hover:bg-rose-50/70",
  },
  {
    screen: "quiz",
    icon: <HelpCircle className="w-5 h-5" />,
    label: "Quiz Diário",
    description: "Teste sua retenção",
    iconColor: "text-indigo-600",
    iconBg: "bg-indigo-50",
    hover: "hover:border-indigo-200 hover:bg-indigo-50/70",
    wide: true,
  },
];

function formatCommitDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export default function HomeScreen({ onNavigate }: HomeScreenProps) {
  const [lastSource, setLastSource] = useState<Source | null>(null);
  const versionInfo = typeof __APP_VERSION_INFO__ !== "undefined" ? __APP_VERSION_INFO__ : null;

  useEffect(() => {
    SourceRepository.getAll().then((sources) => {
      if (sources.length > 0) setLastSource(sources[0]);
    });
  }, []);

  return (
    <div className="screen-gray" id="screen_home">
      <header className="px-6 py-4 bg-white border-b border-[#E5E5E7] shrink-0">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#E63946] rounded-full flex items-center justify-center shrink-0">
              <div className="w-3.5 h-3.5 bg-white rounded-full" />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-widest text-[#1D1D1F] leading-none uppercase">
                Nihongo Loop
              </h1>
              <span className="text-[9px] text-[#86868B] font-extrabold uppercase tracking-[0.16em] block mt-0.5">
                Estudo léxico e contextual
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("settings")}
            className="btn-back"
            aria-label="Configurações"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-xl w-full mx-auto px-6 py-6 space-y-5">
        <section className="bg-white border border-[#E5E5E7] p-5 rounded-2xl shadow-sm space-y-3">
          <div className="space-y-1">
            <h2 className="text-base font-black text-[#1D1D1F]">
              {lastSource ? "Pronto para continuar" : "Bem-vindo ao Nihongo Loop"}
            </h2>
            <p className="text-xs text-[#6E6E73] leading-relaxed">
              {lastSource
                ? `Continue estudando a partir de ${lastSource.title}.`
                : "Importe uma fonte para começar a criar seu vocabulário e estudar frases em contexto."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate(lastSource ? "study" : "import_source")}
            className="btn btn-primary w-full"
          >
            {lastSource ? "Continuar estudando" : "Importar primeira fonte"}
          </button>
        </section>

        {versionInfo && (
          <div className="bg-white border border-[#E5E5E7] rounded-xl px-4 py-3 text-center shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#1D1D1F]">
              Versão {versionInfo.version}
            </p>
            <p className="mt-1 text-[10px] font-bold text-[#86868B]">
              Commit {versionInfo.commit} · {formatCommitDate(versionInfo.commitDate)}
            </p>
          </div>
        )}

        <section className="grid grid-cols-2 gap-3">
          {NAV_CARDS.map(({ screen, icon, label, description, iconColor, iconBg, hover, wide }) => (
            <button
              key={screen}
              type="button"
              onClick={() => onNavigate(screen)}
              className={`p-4 bg-white border border-[#E5E5E7] ${hover} hover:shadow-sm rounded-2xl flex flex-col items-start gap-2 transition-all cursor-pointer text-left${wide ? " col-span-2" : ""}`}
            >
              <span className={`mb-0.5 inline-flex h-8 w-8 items-center justify-center rounded-xl ${iconBg} ${iconColor}`}>
                {icon}
              </span>
              <span className="font-bold text-sm text-[#1D1D1F]">{label}</span>
              <span className="text-[10px] text-[#86868B]">{description}</span>
            </button>
          ))}
        </section>
      </main>
    </div>
  );
}
