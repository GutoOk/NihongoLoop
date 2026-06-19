import React, { useState, useEffect } from "react";
import { ArrowLeft, Play, Settings2, BookOpen } from "lucide-react";
import { SourceRepository, DictionaryRepository } from "../repositories";
import { Source, DictionaryEntry } from "../types";

interface StudySetupScreenProps {
  onBack: () => void;
  onStartSession: (config: any) => void;
}

export default function StudySetupScreen({
  onBack,
  onStartSession,
}: StudySetupScreenProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [words, setWords] = useState<DictionaryEntry[]>([]);

  const [entityType, setEntityType] = useState<
    "sentence" | "word" | "word_context"
  >("sentence");

  // Basic session config mimicking the user requirements
  const [targetType, setTargetType] = useState<string>("all");
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedWordId, setSelectedWordId] = useState("");
  const [filterWordType, setFilterWordType] = useState<string>("all");
  const [filterWordLevel, setFilterWordLevel] = useState<string>("all");
  const [limit, setLimit] = useState<string>("20");
  const [order, setOrder] = useState<"random" | "original">("random");
  const [studyMode, setStudyMode] = useState<
    "jp-pt" | "pt-jp" | "pt-jp-jp" | "jp-repeat" | "shadowing"
  >("jp-pt");

  useEffect(() => {
    SourceRepository.getAll().then(setSources);
    DictionaryRepository.getPage({ limit: 200 }).then(({ entries }) => setWords(entries));
  }, []);

  // Reset target targetType when entity changes to avoid invalid combinations
  useEffect(() => {
    if (entityType === "sentence") {
      setTargetType("all");
    } else if (entityType === "word") {
      setTargetType("all");
    } else if (entityType === "word_context") {
      setTargetType("specific"); // word_context always specific word
    }
  }, [entityType]);

  const handleStart = () => {
    onStartSession({
      entityType,
      targetType: entityType === "word" ? "custom_word_filter" : targetType,
      sourceId:
        targetType === "source" || entityType === "word"
          ? selectedSource
          : null,
      wordId: entityType === "word_context" ? selectedWordId : null,
      filterWordType,
      filterWordLevel,
      limit: limit === "all" ? 9999 : parseInt(limit, 10),
      order,
      studyMode,
    });
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
        <h1 className="screen-title">Configurar Sessão</h1>
      </header>

      <main className="flex-1 overflow-auto p-6 space-y-6">
        {/* O que estudar: Frases ou Palavras */}
        <div className="space-y-2">
          <label className="field-label">
            Modo de Entidade
          </label>
          <div className="flex bg-[#F5F5F7] p-1 rounded-xl gap-1">
            <button
              onClick={() => setEntityType("sentence")}
              className={`flex-1 py-3 text-xs font-bold rounded-lg transition-all ${entityType === "sentence" ? "bg-white shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
            >
              Frases
            </button>
            <button
              onClick={() => setEntityType("word")}
              className={`flex-1 py-3 text-xs font-bold rounded-lg transition-all ${entityType === "word" ? "bg-white shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
            >
              Palavras
            </button>
            <button
              onClick={() => setEntityType("word_context")}
              className={`flex-1 py-3 text-xs font-bold rounded-lg transition-all ${entityType === "word_context" ? "bg-white shadow-sm" : "text-gray-500 hover:text-gray-800"}`}
            >
              Contextos
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div className="space-y-2">
          <label className="field-label">
            Filtro de Conteúdo
          </label>

          {entityType === "sentence" && (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setTargetType("all")}
                className={`py-3 text-xs font-bold rounded-xl border transition-all ${targetType === "all" ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-[#E5E5E7]"}`}
              >
                Todo o Acervo
              </button>
              <button
                onClick={() => setTargetType("favorites")}
                className={`py-3 text-xs font-bold rounded-xl border transition-all ${targetType === "favorites" ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-[#E5E5E7]"}`}
              >
                Favoritas
              </button>
              <button
                onClick={() => setTargetType("difficult")}
                className={`py-3 text-xs font-bold rounded-xl border transition-all ${targetType === "difficult" ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-[#E5E5E7]"}`}
              >
                Difíceis
              </button>
              <button
                onClick={() => setTargetType("source")}
                className={`py-3 text-xs font-bold rounded-xl border transition-all ${targetType === "source" ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-[#E5E5E7]"}`}
              >
                Uma Fonte
              </button>
              <button
                onClick={() => setTargetType("new")}
                className={`py-3 text-xs font-bold rounded-xl border transition-all ${targetType === "new" ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-[#E5E5E7]"}`}
              >
                Novas
              </button>
              <button
                onClick={() => setTargetType("untranslated")}
                className={`py-3 text-xs font-bold rounded-xl border transition-all ${targetType === "untranslated" ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-[#E5E5E7]"}`}
              >
                Sem Tradução
              </button>
              <button
                onClick={() => setTargetType("unread")}
                className={`py-3 text-xs font-bold rounded-xl border transition-all ${targetType === "unread" ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-[#E5E5E7]"}`}
              >
                Sem Leitura
              </button>
            </div>
          )}

          {entityType === "word" && (
            <div className="flex flex-col gap-3 p-4 bg-[#F5F5F7] rounded-2xl border border-[#E5E5E7]">
              <div>
                <label className="text-xs font-bold text-gray-700">Fonte</label>
                <select
                  value={selectedSource}
                  onChange={(e) => setSelectedSource(e.target.value)}
                  className="w-full mt-1 p-3 bg-white border border-[#E5E5E7] rounded-xl text-sm outline-none"
                >
                  <option value="">Todas as Fontes</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700">
                  Tipo da Palavra
                </label>
                <select
                  value={filterWordType}
                  onChange={(e) => setFilterWordType(e.target.value)}
                  className="w-full mt-1 p-3 bg-white border border-[#E5E5E7] rounded-xl text-sm outline-none"
                >
                  <option value="all">Todos os Tipos</option>
                  <option value="verbo">Verbos</option>
                  <option value="partícula">Partículas</option>
                  <option value="nome próprio">Nomes Próprios</option>
                  <option value="expressão">Expressões</option>
                  <option value="adjetivo">Adjetivos</option>
                  <option value="sem_significado">Sem Significado</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-700">
                  Nível (JLPT)
                </label>
                <select
                  value={filterWordLevel}
                  onChange={(e) => setFilterWordLevel(e.target.value)}
                  className="w-full mt-1 p-3 bg-white border border-[#E5E5E7] rounded-xl text-sm outline-none"
                >
                  <option value="all">Todos os Níveis</option>
                  <option value="N5">N5</option>
                  <option value="N4">N4</option>
                  <option value="N3">N3</option>
                  <option value="N2">N2</option>
                  <option value="N1">N1</option>
                </select>
              </div>
            </div>
          )}

          {entityType === "word_context" && (
            <div className="w-full">
              <select
                value={selectedWordId}
                onChange={(e) => setSelectedWordId(e.target.value)}
                className="w-full p-3 bg-[#F5F5F7] border border-[#E5E5E7] rounded-xl text-sm outline-none"
              >
                <option value="">Selecione uma palavra...</option>
                {words.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.lemma} {w.main_meaning ? `(${w.main_meaning})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {targetType === "source" && entityType === "sentence" && (
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="w-full mt-2 p-3 bg-[#F5F5F7] border border-[#E5E5E7] rounded-xl text-sm outline-none"
            >
              <option value="">Selecione uma fonte...</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Quantidade */}
        <div className="space-y-2">
          <label className="field-label">
            Quantidade
          </label>
          <div className="grid grid-cols-4 gap-2">
            {["10", "20", "50", "all"].map((v) => (
              <button
                key={v}
                onClick={() => setLimit(v)}
                className={`py-2 text-xs font-bold flex items-center justify-center rounded-xl border transition-all ${limit === v ? "bg-slate-100 border-slate-300 text-slate-800" : "bg-white border-[#E5E5E7]"}`}
              >
                {v === "all" ? "Todas" : v}
              </button>
            ))}
          </div>
        </div>

        {/* Ordem */}
        <div className="space-y-2">
          <label className="field-label">
            Ordem
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setOrder("original")}
              className={`py-3 text-xs font-bold rounded-xl border transition-all ${order === "original" ? "bg-slate-100 border-slate-300 text-slate-800" : "bg-white border-[#E5E5E7]"}`}
            >
              Original / Padrão
            </button>
            <button
              onClick={() => setOrder("random")}
              className={`py-3 text-xs font-bold rounded-xl border transition-all ${order === "random" ? "bg-slate-100 border-slate-300 text-slate-800" : "bg-white border-[#E5E5E7]"}`}
            >
              Aleatória
            </button>
          </div>
        </div>

        {/* Modo */}
        <div className="space-y-2">
          <label className="field-label">
            Modo de Estudo / Áudio
          </label>
          <div className="grid grid-cols-1 gap-2">
            {[
              { id: "jp-pt", label: "Japonês → Tradução/Significado" },
              { id: "pt-jp", label: "Tradução/Significado → Japonês" },
              { id: "pt-jp-jp", label: "Tradução → Japonês → Japonês" },
              { id: "jp-repeat", label: "Japonês Repetido" },
              { id: "shadowing", label: "Shadowing (Sincronizado)" },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setStudyMode(m.id as any)}
                className={`py-3 text-xs font-bold rounded-xl border transition-all ${studyMode === m.id ? "bg-slate-100 border-slate-300 text-slate-800" : "bg-white border-[#E5E5E7]"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </main>

      <div className="p-4 border-t border-[#E5E5E7]">
        <button
          onClick={handleStart}
          disabled={
            (targetType === "source" && !selectedSource) ||
            (entityType === "word_context" && !selectedWordId)
          }
          className="btn btn-primary flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Play className="w-4 h-4 fill-current" /> Iniciar Sessão
        </button>
      </div>
    </div>
  );
}
