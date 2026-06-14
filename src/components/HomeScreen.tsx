/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import {
  Play,
  Plus,
  BookOpen,
  Search,
  BarChart3,
  Radio,
  HelpCircle,
  Network,
  Layers,
  Settings,
  FileText,
} from "lucide-react";
import { SourceRepository } from "../repositories";
import { Source } from "../types";

interface HomeScreenProps {
  onNavigate: (
    screen:
      | "import_source"
      | "sources"
      | "reading"
      | "study"
      | "dictionary"
      | "pending_ai"
      | "statistics"
      | "network"
      | "quiz"
      | "settings"
      | "flashcards",
    params?: any,
  ) => void;
}

export default function HomeScreen({ onNavigate }: HomeScreenProps) {
  const [lastSource, setLastSource] = useState<Source | null>(null);

  useEffect(() => {
    SourceRepository.getAll().then((sources) => {
      if (sources.length > 0) {
        setLastSource(sources[0]);
      }
    });
  }, []);

  return (
    <div
      className="flex flex-col min-h-screen bg-[#F5F5F7] text-[#1D1D1F] select-none text-xs"
      id="screen_home"
    >
      <header className="px-6 py-4.5 bg-white border-b border-[#E5E5E7] shrink-0">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#E63946] rounded-full flex items-center justify-center relative shadow-xs shrink-0 animate-scale-in">
              <div className="w-3.5 h-3.5 bg-white rounded-full"></div>
            </div>
            <div>
              <h1 className="text-sm font-black tracking-widest text-[#1D1D1F] leading-none uppercase">
                Nihongo Loop
              </h1>
              <span className="text-[9px] text-[#86868B] font-extrabold uppercase tracking-[0.16em] block mt-0.5">
                ESTUDO LÉXICO E CONTEXTUAL
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("settings")}
            className="p-2 text-[#86868B] hover:text-[#1D1D1F] hover:bg-[#F5F5F7] rounded-xl transition-all border border-transparent hover:border-gray-200 cursor-pointer"
            title="Configurações"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-xl w-full mx-auto px-6 py-6 space-y-6">
        {!lastSource && (
          <div className="bg-indigo-50 border border-indigo-100 p-6 rounded-3xl text-center space-y-3">
            <h2 className="text-lg font-black text-indigo-900">
              Bem-vindo ao Nihongo Loop
            </h2>
            <p className="text-xs text-indigo-700">
              Importe uma fonte para começar a criar seu vocabulário e estudar
              frases em contexto.
            </p>
            <button
              onClick={() => onNavigate("import_source")}
              className="mt-2 bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm"
            >
              Importar Primeira Fonte
            </button>
          </div>
        )}

        <section className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onNavigate("sources")}
            className="p-4 bg-white border border-[#E5E5E7] hover:border-emerald-300 rounded-2xl flex flex-col items-start gap-2 transition-all cursor-pointer shadow-sm"
          >
            <Layers className="w-6 h-6 text-emerald-600 mb-1" />
            <span className="font-bold text-sm">Minhas Fontes</span>
            <span className="text-[10px] text-gray-500 text-left">
              Gerenciar textos salvos
            </span>
          </button>

          <button
            onClick={() => onNavigate("study")}
            className="p-4 bg-white border border-[#E5E5E7] hover:border-amber-300 rounded-2xl flex flex-col items-start gap-2 transition-all cursor-pointer shadow-sm"
          >
            <Play className="w-6 h-6 text-amber-600 mb-1" />
            <span className="font-bold text-sm">Estudar</span>
            <span className="text-[10px] text-gray-500 text-left">
              Sessões de repetição
            </span>
          </button>

          <button
            onClick={() => onNavigate("dictionary")}
            className="p-4 bg-white border border-[#E5E5E7] hover:border-purple-300 rounded-2xl flex flex-col items-start gap-2 transition-all cursor-pointer shadow-sm"
          >
            <Search className="w-6 h-6 text-purple-600 mb-1" />
            <span className="font-bold text-sm">Dicionário</span>
            <span className="text-[10px] text-gray-500 text-left">
              Vocabulário extraído
            </span>
          </button>

          <button
            onClick={() => onNavigate("pending_ai")}
            className="p-4 bg-white border border-[#E5E5E7] hover:border-rose-300 rounded-2xl flex flex-col items-start gap-2 transition-all cursor-pointer shadow-sm"
          >
            <FileText className="w-6 h-6 text-rose-600 mb-1" />
            <span className="font-bold text-sm">Pendências / IA</span>
            <span className="text-[10px] text-gray-500 text-left">
              Traduções e revisões
            </span>
          </button>

          <button
            onClick={() => onNavigate("statistics")}
            className="p-4 bg-white border border-[#E5E5E7] hover:border-teal-300 rounded-2xl flex flex-col items-start gap-2 transition-all cursor-pointer shadow-sm"
          >
            <BarChart3 className="w-6 h-6 text-teal-600 mb-1" />
            <span className="font-bold text-sm">Estatísticas</span>
            <span className="text-[10px] text-gray-500 text-left">
              Progresso geral
            </span>
          </button>

          <button
            onClick={() => onNavigate("flashcards")}
            className="p-4 bg-white border border-[#E5E5E7] hover:border-blue-300 rounded-2xl flex flex-col items-start gap-2 transition-all cursor-pointer shadow-sm"
          >
            <Layers className="w-6 h-6 text-blue-600 mb-1" />
            <span className="font-bold text-sm">Flashcards (SRS)</span>
            <span className="text-[10px] text-gray-500 text-left">
              Estudo espaçado
            </span>
          </button>

          <button
            onClick={() => onNavigate("quiz")}
            className="p-4 bg-white border border-[#E5E5E7] hover:border-orange-300 rounded-2xl flex flex-col items-start gap-2 transition-all cursor-pointer shadow-sm col-span-2"
          >
            <HelpCircle className="w-6 h-6 text-orange-600 mb-1" />
            <span className="font-bold text-sm">Quiz Diário</span>
            <span className="text-[10px] text-gray-500 text-left">
              Teste sua retenção
            </span>
          </button>
        </section>
      </main>
    </div>
  );
}
