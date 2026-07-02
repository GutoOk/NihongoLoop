import React, { useState, useRef, useEffect } from "react";
import { ArrowLeft, Upload, FileText, Check, X, Loader2 } from "lucide-react";
import { parseSrt, parsePlainText } from "../services/importParserService";
import { SourceRepository, SentenceRepository } from "../repositories";
import { AuthService } from "../core/authService";
import { useModal } from "./ModalProvider";
import { makeJapaneseKey } from "../core/japaneseNormalize";

interface ImportSourceScreenProps {
  onBack: () => void;
  onImportComplete: (sourceId: string) => void;
}

export default function ImportSourceScreen({
  onBack,
  onImportComplete,
}: ImportSourceScreenProps) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"text" | "srt">("text");
  const [content, setContent] = useState("");
  const { showAlert } = useModal();

  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState("");
  const [progressValue, setProgressValue] = useState(0);
  const [progressMax, setProgressMax] = useState(1);
  const cancelRef = useRef(false);

  const [elapsedTime, setElapsedTime] = useState(0);
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [totalSteps, setTotalSteps] = useState<number>(4);
  const [detailedStatus, setDetailedStatus] = useState<string>("");

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isProcessing) {
      setElapsedTime(0);
      timer = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    } else {
      setElapsedTime(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isProcessing]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleImport = async () => {
    if (!title.trim() || !content.trim()) return;

    setIsProcessing(true);
    cancelRef.current = false;
    let sourceId: string | null = null;

    try {
      setCurrentStep(1);
      setTotalSteps(4);
      setProgressMsg("Lendo e formatando texto...");
      setDetailedStatus(
        "Analisando o conteúdo inserido e identificando blocos de áudio e falas.",
      );
      await new Promise((r) => setTimeout(r, 100)); // let UI update

      let sentencesText: string[] = [];
      if (type === "srt") {
        sentencesText = parseSrt(content);
      } else {
        sentencesText = parsePlainText(content);
      }

      if (sentencesText.length === 0) {
        throw new Error("Nenhuma frase japonesa foi detectada neste conteúdo.");
      }

      if (cancelRef.current) throw new Error("Canceled");

      const userId = AuthService.getCurrentUserId();

      setCurrentStep(2);
      setProgressMsg("Criando fonte...");
      setDetailedStatus(
        "Registrando a nova Fonte de Conteúdo no banco de dados Supabase.",
      );
      await new Promise((r) => setTimeout(r, 100));

      // Create Source
      const source = await SourceRepository.add({
        user_id: userId,
        title: title.trim(),
        type: type,
        original_content: content,
      });

      if (!source) {
        throw new Error("Falha ao criar Source");
      }
      sourceId = source.id;

      if (cancelRef.current) throw new Error("Canceled");

      // Create Sentences
      const sentencesToInsert = sentencesText.map((text, i) => ({
        source_id: source.id,
        user_id: userId,
        order_index: i,
        japanese: text,
        japanese_key: makeJapaneseKey(text),
        portuguese: null,
        kana: null,
        romaji: null,
        status: "raw" as const,
        tags: [],
      }));

      setProgressMax(sentencesToInsert.length);
      setProgressValue(0);

      const CHUNK_SIZE = 50;
      const totalChunks = Math.ceil(sentencesToInsert.length / CHUNK_SIZE);
      setCurrentStep(3);

      // Batch insert in chunks
      for (let i = 0; i < sentencesToInsert.length; i += CHUNK_SIZE) {
        if (cancelRef.current) throw new Error("Canceled");
        const chunk = sentencesToInsert.slice(i, i + CHUNK_SIZE);
        const currentChunkIdx = Math.floor(i / CHUNK_SIZE) + 1;

        setProgressMsg(
          `Salvando frases (${Math.min(i + CHUNK_SIZE, sentencesToInsert.length)}/${sentencesToInsert.length})`,
        );
        setDetailedStatus(
          `A gravar lote ${currentChunkIdx} de ${totalChunks} no banco de dados. Faltam ${totalChunks - currentChunkIdx} lotes para terminar.`,
        );

        await SentenceRepository.addBatch(chunk);
        setProgressValue(i + chunk.length);
      }

      if (cancelRef.current) throw new Error("Canceled");

      setCurrentStep(4);
      setProgressMsg("Importação concluída!");
      setDetailedStatus(
        "Todas as frases foram gravadas e o fatiamento foi concluído com absoluto sucesso.",
      );
      await new Promise((r) => setTimeout(r, 600));
      onImportComplete(source.id);
    } catch (err: any) {
      if (err.message === "Canceled") {
        if (import.meta.env.DEV) {
          console.log("Importação cancelada.");
        }
        setProgressMsg("Limpando registros...");
        setDetailedStatus(
          "Interrompendo processos de gravação e apagando parcialmente dados para evitar lixo.",
        );
        if (sourceId) {
          await SourceRepository.delete(sourceId);
        }
        showAlert(
          "Cancelado",
          "Importação interrompida e revertida com sucesso. Nenhuma alteração foi efetuada.",
        );
      } else {
        console.error(err);
        if (sourceId) {
          // Cleanup partial data on error
          await SourceRepository.delete(sourceId).catch(() => {});
        }
        showAlert(
          "Erro na Importação",
          err.message ||
            "Ocorreu um erro desconhecido ao tentar registrar dados no banco.",
        );
      }
    } finally {
      setIsProcessing(false);
      setProgressMsg("");
      setDetailedStatus("");
      setProgressValue(0);
    }
  };

  const handleCancel = () => {
    cancelRef.current = true;
  };

  if (isProcessing) {
    return (
      <div className="screen-gray">
        <header className="screen-header">
          <h1 className="screen-title">Status de Importação</h1>
        </header>

        <main className="flex-1 flex flex-col justify-center items-center p-6 space-y-8 max-w-md mx-auto">
          {/* Card Central */}
          <div className="w-full bg-white border border-[#E5E5E7] rounded-3xl p-6 shadow-sm space-y-6 text-center">
            {/* Cronômetro gigante e elegante */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">
                Tempo Decorrido
              </span>
              <div className="text-4xl font-mono font-bold text-slate-800 tracking-tight">
                {formatTime(elapsedTime)}
              </div>
            </div>

            {/* Spinner animado com círculo */}
            <div className="relative flex justify-center py-2">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 rounded-full border-4 border-indigo-100 border-t-indigo-600 animate-spin" />
              </div>
              <div className="w-16 h-16 rounded-full flex items-center justify-center bg-indigo-50 text-indigo-600">
                <span className="text-xs font-black">
                  {currentStep}/{totalSteps}
                </span>
              </div>
            </div>

            {/* Descrição do Passo Atual */}
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-[10px] font-bold uppercase tracking-wider">
                Passo {currentStep} de {totalSteps}
              </div>
              <h2 className="text-sm font-black tracking-tight text-slate-800">
                {progressMsg}
              </h2>
              <p className="text-xs text-[#86868B] leading-relaxed px-2">
                {detailedStatus}
              </p>
            </div>

            {/* Progresso visual */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] text-[#86868B] font-bold">
                <span>PROGRESSO GLOBAL</span>
                <span>
                  {progressMax > 1
                    ? `${Math.round((progressValue / progressMax) * 100)}%`
                    : "Iniciando"}
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: `${progressMax > 1 ? Math.max(5, (progressValue / progressMax) * 100) : 5}%`,
                  }}
                />
              </div>
              {progressMax > 1 && (
                <p className="text-[10px] text-[#86868B] font-mono">
                  Gravados {progressValue} de {progressMax} elementos de fala
                </p>
              )}
            </div>

            {/* Status da Inteligência Artificial */}
            <div className="pt-2 border-t border-[#F5F5F7] flex items-center justify-center gap-2 text-[10px] text-[#86868B] font-bold uppercase tracking-wide">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-400"></span>
              IA Status: Local &amp; Offline (Etapa de Fatiamento)
            </div>
          </div>

          {/* Botão de STOP / Interrupção */}
          <div className="w-full space-y-3">
            <button
              onClick={handleCancel}
              className="w-full py-4 bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-600 border border-rose-200 font-bold rounded-2xl flex items-center justify-center gap-2 uppercase text-xs tracking-wider transition-all shadow-sm"
            >
              <X className="w-4 h-4" /> Parar e Reverter Tudo
            </button>
            <p className="text-[10px] text-[#86868B] font-medium leading-relaxed text-center px-4">
              Ao interromper o processo de importação, o sistema irá remover
              todos os registros criados no banco e restaurar o estado limpo
              anterior.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <button
          type="button"
          onClick={onBack}
          disabled={isProcessing}
          className="btn-back disabled:opacity-50"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="screen-title">Importar Fonte</h1>
      </header>

      <main className="flex-1 overflow-auto p-6 space-y-6">
        <div className="space-y-1.5">
          <label htmlFor="source-title" className="field-label">Título da Fonte</label>
          <input
            id="source-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isProcessing}
            placeholder="Ex: Diálogo 01, Episódio 5…"
            className="form-input disabled:opacity-50"
          />
        </div>

        <div className="space-y-1.5">
          <label className="field-label">Tipo de Conteúdo</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType("text")}
              disabled={isProcessing}
              aria-pressed={type === "text"}
              className={`flex-1 py-3 text-xs font-bold rounded-xl border flex items-center justify-center gap-2 transition-all disabled:opacity-50 ${type === "text" ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-[#E5E5E7] text-[#86868B] hover:border-[#1D1D1F]"}`}
            >
              <FileText className="w-4 h-4" /> Texto Puro
            </button>
            <button
              type="button"
              onClick={() => setType("srt")}
              disabled={isProcessing}
              aria-pressed={type === "srt"}
              className={`flex-1 py-3 text-xs font-bold rounded-xl border flex items-center justify-center gap-2 transition-all disabled:opacity-50 ${type === "srt" ? "bg-indigo-50 border-indigo-200 text-indigo-700" : "bg-white border-[#E5E5E7] text-[#86868B] hover:border-[#1D1D1F]"}`}
            >
              <Upload className="w-4 h-4" /> Legendas (SRT)
            </button>
          </div>
        </div>

        <div className="space-y-1.5 flex-1 flex flex-col min-h-[250px]">
          <label htmlFor="source-content" className="field-label">Conteúdo (Cole o texto ou legenda)</label>
          <textarea
            id="source-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={isProcessing}
            className="form-input flex-1 min-h-[200px] resize-none font-mono disabled:opacity-50"
            placeholder={
              type === "srt"
                ? "1\n00:00:01,000 --> 00:00:04,000\n[Exemplo]"
                : "Japonês aqui…"
            }
          />
        </div>

        {!isProcessing && (
          <button
            type="button"
            onClick={handleImport}
            disabled={!title.trim() || !content.trim()}
            className="btn btn-primary"
          >
            <Check className="w-4 h-4" /> Importar e Fatiar Frases
          </button>
        )}
      </main>
    </div>
  );
}
