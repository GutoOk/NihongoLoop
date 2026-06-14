import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Plus,
  FileText,
  ChevronRight,
  BookOpen,
  Search,
  Trash2,
} from "lucide-react";
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
  const [sentencesBySource, setSentencesBySource] = useState<
    Record<string, Sentence[]>
  >({});
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
          const sentences = await SentenceRepository.getBySourceId(source.id);
          sentencesMap[source.id] = sentences;
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
    <div className="flex flex-col h-full bg-white text-[#1D1D1F]">
      <header className="px-4 py-4 border-b border-[#E5E5E7] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 -ml-2 text-[#86868B] hover:text-[#1D1D1F] transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-sm font-black uppercase tracking-widest text-[#1D1D1F]">
            Minhas Fontes
          </h1>
        </div>
        <button
          onClick={onNavigateImport}
          className="text-indigo-600 hover:bg-indigo-50 p-2 rounded-xl transition-colors"
        >
          <Plus className="w-5 h-5" />
        </button>
      </header>

      <main className="flex-1 overflow-auto p-4 space-y-4">
        {loading ? (
          <div className="text-center py-10 text-gray-400 text-xs text-sm">
            Carregando fontes...
          </div>
        ) : sources.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-sm font-bold text-gray-900 mb-1">
              Nenhuma fonte
            </h3>
            <p className="text-xs text-gray-500 mb-4 max-w-[200px] mx-auto">
              Adicione textos, legendas de animes ou roteiros para estudar.
            </p>
            <button
              onClick={onNavigateImport}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold uppercase tracking-wider"
            >
              Importar Agora
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {sources.map((source) => {
              const sentences = sentencesBySource[source.id] || [];
              const readCount = sentences.filter(
                (s) => s.status !== "raw",
              ).length;
              return (
                <div
                  key={source.id}
                  className="bg-white border border-[#E5E5E7] p-4 flex flex-col gap-4 rounded-2xl"
                >
                  <div className="flex items-start gap-3">
                    <div className="bg-indigo-50 text-indigo-600 p-2.5 rounded-xl">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start gap-2">
                        <h3 className="text-sm font-bold text-gray-900 line-clamp-1">
                          {source.title}
                        </h3>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSource(source);
                          }}
                          className="text-rose-400 hover:text-rose-600 p-1 -mt-1 -mr-1 transition-colors"
                          title="Excluir Fonte"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-mono font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                          {source.type.toUpperCase()}
                        </span>
                        <span className="text-[10px] text-gray-400 font-bold">
                          {sentences.length} frases
                        </span>
                        <span className="text-[10px] text-gray-400">•</span>
                        <span className="text-[10px] text-indigo-500 font-bold">
                          {readCount} lidas
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
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
