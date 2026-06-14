import React, { useState, useEffect } from "react";
import { ArrowLeft, Play, Settings2, BookOpen } from "lucide-react";
import { SourceRepository } from "../repositories";
import { Source } from "../types";

interface StudySourceSelectorScreenProps {
  onBack: () => void;
  onStartStandard: (sourceId: string, mode: "sentences" | "words") => void;
  onStartCustom: () => void;
}

export default function StudySourceSelectorScreen({
  onBack,
  onStartStandard,
  onStartCustom,
}: StudySourceSelectorScreenProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSource, setSelectedSource] = useState("");

  useEffect(() => {
    SourceRepository.getAll().then(setSources);
  }, []);

  return (
    <div className="flex flex-col h-full bg-white text-[#1D1D1F]">
      <header className="px-4 py-4 border-b border-[#E5E5E7] flex items-center gap-3 shrink-0">
        <button
          onClick={onBack}
          className="p-2 -ml-2 text-[#86868B] hover:text-[#1D1D1F] transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-sm font-black uppercase tracking-widest text-[#1D1D1F]">
          Estudar
        </h1>
      </header>

      <main className="flex-1 overflow-auto p-6 space-y-6">
        <div className="space-y-4">
          <div className="text-center space-y-2 mb-8">
            <h2 className="text-2xl font-black text-gray-900">Estudo Padrão</h2>
            <p className="text-sm text-gray-500">
              O sistema guia você fonte por fonte, de 10 em 10 frases,
              garantindo a fixação do vocabulário através de flashcards gerados
              automaticamente.
            </p>
          </div>

          <label className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider block">
            Escolha uma Fonte para Estudar
          </label>
          <select
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            className="w-full p-4 bg-[#F5F5F7] border border-[#E5E5E7] rounded-2xl text-sm font-bold outline-none text-slate-800"
          >
            <option value="">Selecione uma fonte...</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || "Fonte sem título"}
              </option>
            ))}
          </select>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => onStartStandard(selectedSource, "sentences")}
              disabled={!selectedSource}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 focus:ring-4 ring-indigo-500/20 text-white font-bold rounded-2xl flex items-center justify-center gap-2 uppercase text-[11px] tracking-wider transition-all disabled:opacity-50"
            >
              <Play className="w-4 h-4 fill-current" /> Frases (Pt→Jp) + Quiz
            </button>
            <button
              onClick={() => onStartStandard(selectedSource, "words")}
              disabled={!selectedSource}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 focus:ring-4 ring-emerald-500/20 text-white font-bold rounded-2xl flex items-center justify-center gap-2 uppercase text-[11px] tracking-wider transition-all disabled:opacity-50"
            >
              <BookOpen className="w-4 h-4 fill-current" /> Palavras (Pt→Jp) + Quiz Rev.
            </button>
          </div>
        </div>

        <div className="pt-8 mt-8 border-t border-gray-100">
          <div className="text-center space-y-2 mb-6">
            <h2 className="text-xl font-bold text-gray-900">Modo Livre</h2>
            <p className="text-xs text-gray-500">
              Crie uma sessão de estudos personalizada escolhendo o que estudar
              e o modo de reprodução. Sem quizzes.
            </p>
          </div>
          <button
            onClick={onStartCustom}
            className="w-full py-4 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-2xl flex items-center justify-center gap-2 uppercase text-[11px] tracking-wider transition-all"
          >
            <Settings2 className="w-4 h-4" /> Estudo Personalizado
          </button>
        </div>
      </main>
    </div>
  );
}
