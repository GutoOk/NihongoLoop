import React, { useEffect, useState } from "react";
import { ArrowLeft, Plus, FileText, BookOpen, Trash2 } from "lucide-react";
import { SourceRepository, SentenceRepository } from "../repositories";
import { Source, Sentence } from "../types";
import { useModal } from "./ModalProvider";

interface SourcesScreenProps {
  onBack: () => void;
  onNavigateImport: () => void;
  onSelectSource: (sourceId: string) => void;
}

export default function SourcesScreen({
  onBack,
  onNavigateImport,
  onSelectSource,
}: SourcesScreenProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [sentencesBySource, setSentencesBySource] = useState<Record<string, Sentence[]>>({});
  const [loading, setLoading] = useState(true);
  const { showConfirm } = useModal();

  useEffect(() => {
    loadSources();
  }, []);

  const loadSources = async () => {
    setLoading(true);
    try {
      const data = await SourceRepository.getAll();
      setSources(data);

      const sentencesMap: Record<string, Sentence[]> = {};
      await Promise.all(
        data.map(async (source) => {
          sentencesMap[source.id] = await SentenceRepository.getBySourceId(source.id);
        }),
      );
      setSentencesBySource(sentencesMap);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSource = (source: Source) => {
    showConfirm(
      "Excluir Fonte",
      `Tem certeza que deseja excluir "${source.title}"?\nIsso apagará todas as frases e estatísticas associadas a esta fonte.`,
      async () => {
        await SourceRepository.delete(source.id);
        loadSources();
      },
      "Excluir",
    );
  };

  return (
    <div className="screen">
      <header className="screen-header justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="btn-back"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="screen-title">Minhas Fontes</h1>
        </div>
        <button
          type="button"
          onClick={onNavigateImport}
          className="btn-back"
          aria-label="Importar nova fonte"
        >
          <Plus className="w-5 h-5 text-indigo-600" />
        </button>
      </header>

      <main className="flex-1 overflow-auto p-4 space-y-4">
        {loading ? (
          <div className="empty-state">
            <span className="spinner text-[#86868B]" />
            <span className="text-sm text-[#86868B]">Carregando fontes…</span>
          </div>
        ) : sources.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <FileText className="w-7 h-7 text-[#86868B]" />
            </div>
            <h3 className="text-sm font-bold text-[#1D1D1F]">Nenhuma fonte</h3>
            <p className="text-xs text-[#86868B] max-w-[200px]">
              Adicione textos, legendas de animes ou roteiros para estudar.
            </p>
            <button
              type="button"
              onClick={onNavigateImport}
              className="btn btn-primary w-auto px-5 mt-1"
            >
              Importar Agora
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {sources.map((source) => {
              const sentences = sentencesBySource[source.id] || [];
              const readCount = sentences.filter((s) => s.status !== "raw").length;
              return (
                <div key={source.id} className="card flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <div className="bg-indigo-50 text-indigo-600 p-2.5 rounded-xl shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <h3 className="text-sm font-bold text-[#1D1D1F] line-clamp-1">
                          {source.title}
                        </h3>
                        <button
                          type="button"
                          onClick={() => handleDeleteSource(source)}
                          className="text-rose-400 hover:text-rose-600 p-1 -mt-1 -mr-1 transition-colors shrink-0"
                          aria-label={`Excluir ${source.title}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-mono font-bold text-[#86868B] bg-[#F5F5F7] px-1.5 py-0.5 rounded">
                          {source.type.toUpperCase()}
                        </span>
                        <span className="text-[10px] text-[#86868B] font-bold">
                          {sentences.length} frases
                        </span>
                        <span className="text-[10px] text-[#86868B]">·</span>
                        <span className="text-[10px] text-indigo-500 font-bold">
                          {readCount} lidas
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectSource(source.id)}
                    className="w-full flex items-center justify-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-black uppercase tracking-widest py-3 rounded-xl transition-colors"
                  >
                    <BookOpen className="w-4 h-4" /> Abrir Leitura
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
