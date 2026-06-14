import React, { useState, useEffect } from "react";
import { SourceRepository } from "../repositories";
import { Source } from "../types";
import { useModal } from "./ModalProvider";
import { Trash2 } from "lucide-react";

interface DeckSetupSelectorProps {
  onStart: (
    filters: { sourceId?: string; type?: string; jlpt_level?: string },
    mode: string,
    limit: number,
  ) => void;
  availableTypes: string[];
  availableLevels: string[];
  isQuiz?: boolean;
}

export default function DeckSetupSelector({
  onStart,
  availableTypes,
  availableLevels,
  isQuiz,
}: DeckSetupSelectorProps) {
  const [sources, setSources] = useState<Source[]>([]);

  const [filterType, setFilterType] = useState("all"); // all, source, type, level
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [selectedLevel, setSelectedLevel] = useState("");

  const [mode, setMode] = useState(isQuiz ? "word_meaning" : "ja_pt");
  const [limit, setLimit] = useState(20);

  const { showAlert } = useModal();

  useEffect(() => {
    SourceRepository.getAll().then(setSources);
  }, []);

  const handleStart = () => {
    let filters: any = {};
    if (filterType === "source") filters.sourceId = selectedSourceId;
    else if (filterType === "type") filters.type = selectedType;
    else if (filterType === "level") filters.jlpt_level = selectedLevel;

    // Validation
    if (filterType === "source" && !selectedSourceId)
      return showAlert("Aviso", "Selecione uma fonte");
    if (filterType === "type" && !selectedType)
      return showAlert("Aviso", "Selecione um tipo");
    if (filterType === "level" && !selectedLevel)
      return showAlert("Aviso", "Selecione um nível");

    onStart(filters, mode, limit);
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm space-y-6 text-sm">
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase text-gray-500">
          Filtrar por
        </label>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none font-medium"
        >
          <option value="all">Todas as Palavras</option>
          <option value="source">Por Fonte Específica</option>
          <option value="type">Por Tipo de Palavra</option>
          <option value="level">Por Nível JLPT</option>
        </select>
      </div>

      {filterType === "source" && (
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-gray-500">
            Fonte
          </label>
          <select
            value={selectedSourceId}
            onChange={(e) => setSelectedSourceId(e.target.value)}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none"
          >
            <option value="">Selecione...</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {filterType === "type" && (
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-gray-500">
            Tipo de Palavra
          </label>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none"
          >
            <option value="">Selecione...</option>
            {availableTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      )}

      {filterType === "level" && (
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-gray-500">
            Nível JLPT
          </label>
          <select
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value)}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none"
          >
            <option value="">Selecione...</option>
            {availableLevels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
      )}

      {!isQuiz ? (
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-gray-500">
            Direção dos Cartões
          </label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none font-medium"
          >
            <option value="ja_pt">Ver Japonês → Resposta em Português</option>
            <option value="pt_ja">Ver Português → Resposta em Japonês</option>
          </select>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase text-gray-500">
            Modo
          </label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none font-medium"
          >
            <option value="word_meaning">Japonês → Sentido em Português</option>
            <option value="meaning_word">Sentido → Reconhecer Palavra</option>
          </select>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-xs font-bold uppercase text-gray-500">
          Quantidade
        </label>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none font-medium"
        >
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>

      <button
        onClick={handleStart}
        className="w-full py-4 bg-black text-white font-bold uppercase text-xs rounded-xl transition-all hover:bg-gray-800"
      >
        Iniciar {isQuiz ? "Quiz" : "Sessão"}
      </button>
    </div>
  );
}
