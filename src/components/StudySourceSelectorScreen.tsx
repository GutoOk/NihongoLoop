import React, { useState, useEffect } from "react";
import { ArrowLeft, Play, Settings2, BookOpen, Folder } from "lucide-react";
import { SourceRepository } from "../repositories";
import { Source, SourceGroup } from "../types";

interface StudySourceSelectorScreenProps {
  onBack: () => void;
  onStartStandard: (sourceId: string, mode: "sentences" | "words") => void;
  onStartGroup: (groupId: string, sourceIds: string[]) => void;
  onStartCustom: () => void;
}

export default function StudySourceSelectorScreen({
  onBack,
  onStartStandard,
  onStartGroup,
  onStartCustom,
}: StudySourceSelectorScreenProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [groups, setGroups] = useState<SourceGroup[]>([]);
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");

  useEffect(() => {
    SourceRepository.getAll().then(setSources);
    SourceRepository.getGroups().then(setGroups);
  }, []);

  const handleStartGroup = async () => {
    if (!selectedGroup) return;
    const sourceIds = await SourceRepository.getSourceIdsByGroupId(selectedGroup);
    onStartGroup(selectedGroup, sourceIds);
  };

  return (
    <div className="screen">
      <header className="screen-header">
        <button
          type="button"
          onClick={onBack}
          className="btn-back"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="screen-title">Estudar</h1>
      </header>

      <main className="flex-1 overflow-auto p-6 space-y-6">
        {/* Standard study */}
        <div className="space-y-4">
          <div className="text-center space-y-1.5 mb-6">
            <h2 className="text-lg font-black text-[#1D1D1F]">Estudo Padrão</h2>
            <p className="text-xs text-[#86868B] leading-relaxed max-w-xs mx-auto">
              O sistema guia você fonte por fonte, de 10 em 10 frases,
              garantindo a fixação do vocabulário através de flashcards gerados
              automaticamente.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="field-label">Escolha uma Fonte para Estudar</label>
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="form-select"
            >
              <option value="">Selecione uma fonte…</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title || "Fonte sem título"}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => onStartStandard(selectedSource, "sentences")}
              disabled={!selectedSource}
              className="btn btn-primary"
            >
              <Play className="w-4 h-4 fill-current" />
              Frases (Pt→Jp) + Quiz
            </button>
            <button
              type="button"
              onClick={() => onStartStandard(selectedSource, "words")}
              disabled={!selectedSource}
              className="btn bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <BookOpen className="w-4 h-4 fill-current" />
              Palavras (Pt→Jp) + Quiz
            </button>
          </div>
        </div>

        {/* Free mode */}
        <div className="pt-6 border-t border-[#E5E5E7] space-y-4">
          <div className="text-center space-y-1.5">
            <h2 className="text-base font-bold text-[#1D1D1F]">Modo Livre</h2>
            <p className="text-xs text-[#86868B] leading-relaxed max-w-xs mx-auto">
              Crie uma sessão personalizada escolhendo o que estudar e o modo de
              reprodução. Sem quizzes.
            </p>
          </div>
          <button
            type="button"
            onClick={onStartCustom}
            className="btn btn-secondary"
          >
            <Settings2 className="w-4 h-4" />
            Estudo Personalizado
          </button>
        </div>

        <div className="pt-6 border-t border-[#E5E5E7] space-y-4">
          <div className="space-y-1.5">
            <label className="field-label">Estudar um grupo</label>
            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              className="form-select"
            >
              <option value="">Selecione um grupo...</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleStartGroup}
            disabled={!selectedGroup}
            className="btn bg-slate-800 hover:bg-slate-900 text-white"
          >
            <Folder className="w-4 h-4" />
            Frases do Grupo
          </button>
        </div>
      </main>
    </div>
  );
}
