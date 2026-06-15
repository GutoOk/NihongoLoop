import React, { useState, useEffect } from "react";
import {
  Play,
  Search,
  BarChart3,
  HelpCircle,
  Layers,
  Settings,
  FileText,
  Brain,
} from "lucide-react";
import { SourceRepository } from "../repositories";
import { Source } from "../types";
import { AppNavigate, ScreenType } from "../navigation";

interface HomeScreenProps {
  onNavigate: AppNavigate;
}

interface NavCard {
  screen: ScreenType;
  icon: React.ReactNode;
  label: string;
  description: string;
  wide?: boolean;
}

const NAV_CARDS: NavCard[] = [
  {
    screen: "sources",
    icon: <Layers className="w-5 h-5" />,
    label: "Minhas Fontes",
    description: "Gerenciar textos salvos",
  },
  {
    screen: "study",
    icon: <Play className="w-5 h-5" />,
    label: "Estudar",
    description: "Sessões de repetição",
  },
  {
    screen: "dictionary",
    icon: <Search className="w-5 h-5" />,
    label: "Dicionário",
    description: "Vocabulário extraído",
  },
  {
    screen: "pending_ai",
    icon: <FileText className="w-5 h-5" />,
    label: "Pendências / IA",
    description: "Traduções e revisões",
  },
  {
    screen: "statistics",
    icon: <BarChart3 className="w-5 h-5" />,
    label: "Estatísticas",
    description: "Progresso geral",
  },
  {
    screen: "flashcards",
    icon: <Brain className="w-5 h-5" />,
    label: "Flashcards (SRS)",
    description: "Estudo espaçado",
  },
  {
    screen: "quiz",
    icon: <HelpCircle className="w-5 h-5" />,
    label: "Quiz Diário",
    description: "Teste sua retenção",
    wide: true,
  },
];

export default function HomeScreen({ onNavigate }: HomeScreenProps) {
  const [lastSource, setLastSource] = useState<Source | null>(null);

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

      <main className="flex-1 max-w-xl w-full mx-auto px-6 py-6 space-y-6">
        {!lastSource && (
          <div className="bg-indigo-50 border border-indigo-100 p-6 rounded-2xl text-center space-y-3">
            <h2 className="text-base font-black text-indigo-900">
              Bem-vindo ao Nihongo Loop
            </h2>
            <p className="text-xs text-indigo-700 leading-relaxed">
              Importe uma fonte para começar a criar seu vocabulário e estudar
              frases em contexto.
            </p>
            <button
              type="button"
              onClick={() => onNavigate("import_source")}
              className="btn btn-primary mt-2 w-auto px-5"
            >
              Importar Primeira Fonte
            </button>
          </div>
        )}

        <section className="grid grid-cols-2 gap-3">
          {NAV_CARDS.map(({ screen, icon, label, description, wide }) => (
            <button
              key={screen}
              type="button"
              onClick={() => onNavigate(screen)}
              className={`p-4 bg-white border border-[#E5E5E7] hover:border-indigo-300 hover:shadow-sm rounded-2xl flex flex-col items-start gap-1.5 transition-all cursor-pointer text-left${wide ? " col-span-2" : ""}`}
            >
              <span className="text-indigo-600 mb-0.5">{icon}</span>
              <span className="font-bold text-sm text-[#1D1D1F]">{label}</span>
              <span className="text-[10px] text-[#86868B]">{description}</span>
            </button>
          ))}
        </section>
      </main>
    </div>
  );
}
