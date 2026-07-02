import React, { useState, useEffect } from "react";
import { SourceRepository } from "../repositories";
import { Source } from "../types";
import { useModal } from "./ModalProvider";

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
  const [filterType, setFilterType] = useState("all");
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
    const filters: Record<string, string> = {};
    if (filterType === "source") {
      if (!selectedSourceId) return showAlert("Aviso", "Selecione uma fonte");
      filters.sourceId = selectedSourceId;
    } else if (filterType === "type") {
      if (!selectedType) return showAlert("Aviso", "Selecione um tipo");
      filters.type = selectedType;
    } else if (filterType === "level") {
      if (!selectedLevel) return showAlert("Aviso", "Selecione um nível");
      filters.jlpt_level = selectedLevel;
    }
    onStart(filters, mode, limit);
  };

  return (
    <div className="card-section space-y-5">
      <div className="space-y-1.5">
        <label htmlFor="deck-filter-type" className="field-label">Filtrar por</label>
        <select
          id="deck-filter-type"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="form-select"
        >
          <option value="all">Todas as Palavras</option>
          <option value="source">Por Fonte Específica</option>
          <option value="type">Por Tipo de Palavra</option>
          <option value="level">Por Nível JLPT</option>
        </select>
      </div>

      {filterType === "source" && (
        <div className="space-y-1.5">
          <label htmlFor="deck-source" className="field-label">Fonte</label>
          <select
            id="deck-source"
            value={selectedSourceId}
            onChange={(e) => setSelectedSourceId(e.target.value)}
            className="form-select"
          >
            <option value="">Selecione…</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </div>
      )}

      {filterType === "type" && (
        <div className="space-y-1.5">
          <label htmlFor="deck-word-type" className="field-label">Tipo de Palavra</label>
          <select
            id="deck-word-type"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="form-select"
          >
            <option value="">Selecione…</option>
            {availableTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      )}

      {filterType === "level" && (
        <div className="space-y-1.5">
          <label htmlFor="deck-jlpt-level" className="field-label">Nível JLPT</label>
          <select
            id="deck-jlpt-level"
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value)}
            className="form-select"
          >
            <option value="">Selecione…</option>
            {availableLevels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="deck-mode" className="field-label">
          {isQuiz ? "Modo" : "Direção dos Cartões"}
        </label>
        <select
          id="deck-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="form-select"
        >
          {isQuiz ? (
            <>
              <option value="word_meaning">Japonês → Sentido em Português</option>
              <option value="meaning_word">Sentido → Reconhecer Palavra</option>
            </>
          ) : (
            <>
              <option value="ja_pt">Ver Japonês → Resposta em Português</option>
              <option value="pt_ja">Ver Português → Resposta em Japonês</option>
            </>
          )}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="deck-limit" className="field-label">Quantidade</label>
        <select
          id="deck-limit"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="form-select"
        >
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>

      <button
        type="button"
        onClick={handleStart}
        className="btn btn-primary"
      >
        Iniciar {isQuiz ? "Quiz" : "Sessão"}
      </button>
    </div>
  );
}
