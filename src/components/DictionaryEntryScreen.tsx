import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  BrainCircuit,
  Play,
  ChevronDown,
  ChevronUp,
  Layers,
  HelpCircle,
  FileText,
  Volume2,
  Sparkles,
  CheckCircle2,
  Bookmark,
  Flame,
  ListTree,
  Database,
  Edit2,
  Plus,
  Save,
  X,
} from "lucide-react";
import {
  DictionaryRepository,
  SentenceRepository,
  TermRepository,
  SourceRepository,
} from "../repositories";
import { SpeechService } from "../services/speechService";
import { AiJobService } from "../services/aiJobService";
import { DictionaryEntry, Sentence, SentenceTerm } from "../types";
import { useModal } from "./ModalProvider";

import WordSentencesQuizScreen from "./WordSentencesQuizScreen";

interface DictionaryEntryScreenProps {
  entryId: string;
  onBack: () => void;
  onStudyWord: () => void;
  onStudyContext: () => void;
  onQuizWord?: () => void;
}

export default function DictionaryEntryScreen({
  entryId,
  onBack,
  onStudyWord,
  onStudyContext,
  onQuizWord,
}: DictionaryEntryScreenProps) {
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const { showAlert } = useModal();
  const [isPlaying, setIsPlaying] = useState(false);

  const [isGrammarOpen, setIsGrammarOpen] = useState(true);
  const [isComponentsOpen, setIsComponentsOpen] = useState(true);
  const [isFormsOpen, setIsFormsOpen] = useState(true);
  const [isSentencesOpen, setIsSentencesOpen] = useState(true);
  const [isSourcesOpen, setIsSourcesOpen] = useState(true);

  const [isEditingMeanings, setIsEditingMeanings] = useState(false);
  const [meaningsEdit, setMeaningsEdit] = useState<string[]>([]);

  const [showSentencesQuiz, setShowSentencesQuiz] = useState(false);

  const [connectedSentences, setConnectedSentences] = useState<
    { sentence: Sentence; term: SentenceTerm }[]
  >([]);
  const [connectedSources, setConnectedSources] = useState<
    { sourceId: string; title: string; count: number }[]
  >([]);

  useEffect(() => {
    loadData();
  }, [entryId]);

  const loadData = async () => {
    const w = await DictionaryRepository.getById(entryId);
    setEntry(w);
    if (!w) return;

    const terms = await TermRepository.getByDictionaryEntry(w.id);
    const sentenceIds = [...new Set(terms.map((t) => t.sentence_id))];
    const sentsPromises = sentenceIds.map((id) =>
      SentenceRepository.getById(id),
    );
    const sents = (await Promise.all(sentsPromises)).filter(
      (s) => s !== null,
    ) as Sentence[];

    const sentToTerm = sents.map((s) => {
      const term = terms.find((t) => t.sentence_id === s.id)!;
      return { sentence: s, term };
    });
    const sourceIdsMap = new Map<string, number>();
    for (const s of sents) {
      sourceIdsMap.set(s.source_id, (sourceIdsMap.get(s.source_id) || 0) + 1);
    }

    const sourcesData = [];
    const validSourceIds = new Set<string>();

    for (const [sId, count] of sourceIdsMap.entries()) {
      const src = await SourceRepository.getById(sId);
      if (src) {
        sourcesData.push({ sourceId: src.id, title: src.title, count });
        validSourceIds.add(src.id);
      }
    }
    setConnectedSources(sourcesData.sort((a, b) => b.count - a.count));

    // Filter sentences by those that belong to a valid source to avoid orphans
    const validSentences = sentToTerm.filter(
      (st) =>
        st.sentence.source_id && validSourceIds.has(st.sentence.source_id),
    );
    setConnectedSentences(validSentences);
  };

  const handleEnrich = async () => {
    if (!entry) return;
    try {
      await AiJobService.requestDictionaryEnrichment(entry.id, entry.lemma);
      showAlert(
        "Sucesso",
        "Fila de IA atualizada! O enriquecimento inteligente foi solicitado para esta palavra.",
      );
    } catch (e) {
      showAlert(
        "Erro",
        "Não foi possível solicitar o enriquecimento automático.",
      );
    }
  };

  const handlePlayVoice = () => {
    if (!entry) return;
    setIsPlaying(true);
    SpeechService.stop();
    SpeechService.speakJapaneseText(entry.lemma, 1);
    setTimeout(() => setIsPlaying(false), 1200);
  };

  if (showSentencesQuiz) {
    return (
      <WordSentencesQuizScreen
        sentences={connectedSentences}
        onBack={() => setShowSentencesQuiz(false)}
      />
    );
  }

  if (!entry)
    return (
      <div className="flex flex-col h-full items-center justify-center p-10 space-y-3 bg-white text-gray-500">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin"></div>
        <p className="text-xs font-semibold tracking-wider uppercase">
          Carregando ficha detalhada...
        </p>
      </div>
    );

  // Filter out duplicates and limit to up to 5 meanings
  const meaningsList = Array.isArray(entry.meanings)
    ? Array.from(
        new Set([entry.main_meaning, ...entry.meanings].filter(Boolean)),
      ).slice(0, 5)
    : entry.main_meaning
      ? [entry.main_meaning]
      : [];

  return (
    <div className="screen-gray">
      <header className="screen-header justify-between">
        <button
          type="button"
          onClick={onBack}
          className="btn-back"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="screen-title flex items-center gap-1.5">
          <Bookmark className="w-4 h-4 text-indigo-500" /> Ficha de Vocabulário
        </h1>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6 max-w-2xl mx-auto w-full pb-20">
        {/* Main Display CARD: Hero style */}
        <div className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-[#E5E5E7] relative overflow-hidden flex flex-col space-y-5">
          {/* Status corner tag */}
          <div className="absolute top-4 right-4 flex items-center gap-1.5">
            <button
              onClick={handleEnrich}
              className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-full transition-colors group relative"
              title="Solicitar Enriquecimento com IA"
            >
              <Sparkles className="w-4 h-4" />
            </button>
            <span
              className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider ${entry.status === "pending" ? "bg-amber-50 text-amber-600 border border-amber-100" : "bg-emerald-50 text-emerald-700 border border-emerald-100"}`}
            >
              {entry.status === "pending" ? "pendente" : "revisado"}
            </span>
          </div>

          <div className="space-y-2 text-center pt-2">
            {entry.kana && (
              <p className="text-base md:text-lg font-black text-indigo-600 tracking-wider">
                {entry.kana}
              </p>
            )}
            <div className="flex items-center justify-center gap-3">
              <h1 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight">
                {entry.lemma}
              </h1>
              <button
                onClick={handlePlayVoice}
                className={`p-2.5 rounded-full border shadow-sm transition-all ${isPlaying ? "bg-indigo-600 border-indigo-700 text-white" : "bg-indigo-50 border-indigo-100 text-indigo-600 hover:bg-indigo-100 hover:scale-105 active:scale-95"}`}
                title="Ouvir pronúncia"
              >
                <Volume2
                  className={`w-5 h-5 ${isPlaying ? "animate-bounce" : ""}`}
                />
              </button>
            </div>
            {entry.romaji && (
              <p className="text-xs font-mono text-gray-400 uppercase tracking-widest pt-1">
                {entry.romaji}
              </p>
            )}
          </div>

          {/* Core metadata badges row */}
          <div className="flex justify-center flex-wrap gap-1.5 py-1 border-y border-slate-100">
            <div className="px-3.5 py-1.5 bg-slate-50 border border-slate-150 rounded-full text-[10px] font-bold text-slate-700 tracking-wide uppercase">
              {entry.type || "Tipo desconhecido"}
            </div>
            {entry.subtype && (
              <div className="px-3.5 py-1.5 bg-indigo-50 border border-indigo-150 rounded-full text-[10px] font-bold text-indigo-700 tracking-wide">
                {entry.subtype}
              </div>
            )}
            {entry.jlpt_level && (
              <div className="px-3 py-1.5 bg-emerald-50 border border-emerald-150 rounded-full text-[10px] font-black text-emerald-800 uppercase tracking-wider">
                {entry.jlpt_level}
              </div>
            )}
          </div>

          {/* Primary meaning view */}
          <div className="bg-gradient-to-br from-indigo-50/40 via-purple-50/30 to-slate-50/50 rounded-2xl p-5 border border-indigo-100/40">
            <div className="flex items-center justify-between gap-1.5 mb-3">
              <span className="text-[10px] font-black text-indigo-500 tracking-widest uppercase">
                Tradução e Aceitações
              </span>
              {!isEditingMeanings ? (
                <button
                  onClick={() => {
                    setMeaningsEdit([...meaningsList]);
                    setIsEditingMeanings(true);
                  }}
                  className="p-1.5 bg-indigo-100 text-indigo-600 rounded hover:bg-indigo-200 transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsEditingMeanings(false)}
                    className="p-1.5 bg-rose-100 text-rose-600 rounded hover:bg-rose-200 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={async () => {
                      if (!entry) return;
                      const validMeanings = meaningsEdit
                        .map((m) => m.trim())
                        .filter(Boolean);
                      if (validMeanings.length > 0) {
                        const updated = await DictionaryRepository.update(
                          entry.id,
                          {
                            main_meaning: validMeanings[0],
                            meanings: validMeanings.slice(1),
                            status: "reviewed",
                          },
                        );
                        if (updated) {
                          setEntry(updated);
                        }
                      }
                      setIsEditingMeanings(false);
                    }}
                    className="p-1.5 bg-emerald-100 text-emerald-600 rounded hover:bg-emerald-200 transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {isEditingMeanings ? (
              <div className="space-y-2">
                {meaningsEdit.map((m, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-extrabold shrink-0">
                      {idx + 1}
                    </span>
                    <input
                      type="text"
                      value={m}
                      onChange={(e) => {
                        const newEdit = [...meaningsEdit];
                        newEdit[idx] = e.target.value;
                        setMeaningsEdit(newEdit);
                      }}
                      className="flex-1 px-3 py-1.5 text-sm bg-white border border-indigo-200 rounded-lg outline-none focus:border-indigo-400"
                    />
                    <button
                      onClick={() =>
                        setMeaningsEdit(
                          meaningsEdit.filter((_, i) => i !== idx),
                        )
                      }
                      className="text-rose-500 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setMeaningsEdit([...meaningsEdit, ""])}
                  className="w-full py-2 flex items-center justify-center gap-1 text-xs font-bold text-indigo-600 bg-indigo-100/50 hover:bg-indigo-100 rounded-lg border border-indigo-200 border-dashed"
                >
                  <Plus className="w-4 h-4" /> Adicionar Tradução
                </button>
              </div>
            ) : meaningsList.length > 0 ? (
              <ol className="space-y-2.5">
                {meaningsList.map((m, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 text-sm text-slate-800 font-medium leading-relaxed"
                  >
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-extrabold shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <span className="flex-1 pt-0.5">{m}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-amber-600 font-semibold italic text-center py-2">
                Nenhum significado cadastrado no momento. Use o botão de editar
                para adicionar manualmente ou usar IA.
              </p>
            )}
          </div>

          {/* Short Note box */}
          {entry.short_note && (
            <div className="bg-amber-50/30 border border-amber-100/70 rounded-2xl p-4 flex gap-3 items-start">
              <HelpCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="block text-[9px] font-black text-amber-700 uppercase tracking-widest mb-1">
                  Nota Didática Rápida
                </span>
                <p className="text-xs text-amber-950 leading-relaxed font-semibold">
                  {entry.short_note}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* SECTION: Gramática & Dicas */}
        {(entry.grammar_info || entry.subtype) && (
          <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-[#E5E5E7]">
            <button
              onClick={() => setIsGrammarOpen(!isGrammarOpen)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50/50 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <FileText className="w-5 h-5 text-indigo-500 animate-pulse" />
                <span className="text-sm font-black text-gray-800 tracking-tight">
                  Regras de Uso & Gramática
                </span>
              </div>
              {isGrammarOpen ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </button>
            {isGrammarOpen && (
              <div className="px-6 pb-6 pt-1 space-y-4 border-t border-gray-100 text-xs md:text-sm text-gray-600 leading-relaxed font-semibold">
                {entry.subtype && (
                  <div>
                    <span className="text-[10px] uppercase font-black text-gray-400 tracking-wider block mb-1">
                      Categoria Gramatical Específica:
                    </span>
                    <span className="text-indigo-800 font-black bg-indigo-50 px-2.5 py-1 rounded-md text-xs border border-indigo-100">
                      {entry.type} {entry.subtype ? `• ${entry.subtype}` : ""}
                    </span>
                  </div>
                )}
                {entry.grammar_info ? (
                  <div>
                    <span className="text-[10px] uppercase font-black text-gray-400 tracking-wider block mb-1.5">
                      Análise Detalhada de Aplicação:
                    </span>
                    <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 text-slate-800 text-xs font-semibold whitespace-pre-wrap leading-relaxed">
                      {entry.grammar_info}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">
                    Sem notas adicionais de uso gramatical.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* SECTION: Ideogram Breakdown (Kanji) */}
        {entry.components &&
          Array.isArray(entry.components) &&
          entry.components.length > 0 && (
            <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-[#E5E5E7]">
              <button
                onClick={() => setIsComponentsOpen(!isComponentsOpen)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50/50 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Layers className="w-5 h-5 text-teal-500" />
                  <span className="text-sm font-black text-gray-800 tracking-tight">
                    Estrutura dos Ideogramas (Kanjis)
                  </span>
                </div>
                {isComponentsOpen ? (
                  <ChevronUp className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                )}
              </button>
              {isComponentsOpen && (
                <div className="px-6 pb-5 pt-1 border-t border-gray-100">
                  <p className="text-[10px] text-gray-400 font-medium mb-3 mt-1 uppercase tracking-wide">
                    Decomposição das partes que formam a palavra:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {entry.components.map((comp: any, idx: number) => (
                      <div
                        key={idx}
                        className="bg-slate-50 border border-slate-150 p-3.5 rounded-2xl flex items-center gap-3.5"
                      >
                        <div className="text-3xl font-black text-teal-700 min-w-[2.75rem] h-11 flex items-center justify-center bg-teal-50 rounded-xl border border-teal-150">
                          {comp.kanji}
                        </div>
                        <div className="flex-1 min-w-0">
                          {comp.reading && (
                            <p className="text-[9px] font-bold text-indigo-500 tracking-wider uppercase mb-0.5">
                              {comp.reading}
                            </p>
                          )}
                          <p className="text-xs font-black text-slate-800 leading-snug truncate">
                            {comp.meaning}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        {/* SECTION: Conjugações e Formas Comuns */}
        {entry.common_forms &&
          Array.isArray(entry.common_forms) &&
          entry.common_forms.length > 0 && (
            <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-[#E5E5E7] transition-all">
              <button
                onClick={() => setIsFormsOpen(!isFormsOpen)}
                className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50/50 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Flame className="w-5 h-5 text-amber-505 text-orange-500" />
                  <span className="text-sm font-black text-gray-800 tracking-tight">
                    Formas Comuns & Inflexões
                  </span>
                </div>
                {isFormsOpen ? (
                  <ChevronUp className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                )}
              </button>
              {isFormsOpen && (
                <div className="px-6 pb-6 pt-3 border-t border-gray-100">
                  <p className="text-[10px] text-gray-400 font-medium mb-3 uppercase tracking-wide">
                    Principais inflexões e formas conjugadas desta palavra:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {entry.common_forms.map((form: string, idx: number) => (
                      <span
                        key={idx}
                        className="bg-gradient-to-tr from-amber-50 to-orange-50 text-orange-950 border border-orange-100/60 px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-transform hover:scale-105"
                      >
                        {form}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        {/* SECTION: Frases Relacionadas */}
        {connectedSentences.length > 0 && (
          <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-[#E5E5E7] transition-all">
            <button
              onClick={() => setIsSentencesOpen(!isSentencesOpen)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50/50 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <ListTree className="w-5 h-5 text-blue-500" />
                <span className="text-sm font-black text-gray-800 tracking-tight">
                  Frases Relacionadas ({connectedSentences.length})
                </span>
              </div>
              {isSentencesOpen ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </button>
            {isSentencesOpen && (
              <div className="px-6 pb-6 pt-3 border-t border-gray-100 space-y-3">
                {connectedSentences.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex flex-col gap-1.5"
                  >
                    <p className="text-sm font-bold text-slate-800">
                      {item.sentence.japanese}
                    </p>
                    {item.sentence.romaji && (
                      <p className="text-[10px] text-slate-400 italic">
                        {item.sentence.romaji}
                      </p>
                    )}
                    <p className="text-xs text-slate-500">
                      {item.sentence.portuguese || "Sem tradução"}
                    </p>

                    {/* Render SentenceTerm notes if they exist */}
                    {(item.term.context_meaning ||
                      item.term.grammar_note ||
                      item.term.structure_note) && (
                      <div className="mt-2 space-y-1.5 bg-indigo-50/50 p-2.5 rounded-lg border border-indigo-100/50">
                        {item.term.context_meaning && (
                          <p className="text-[10px] text-indigo-900 leading-tight">
                            <span className="font-bold text-indigo-700 uppercase tracking-widest text-[9px] block mb-0.5">
                              Sentido no Contexto:
                            </span>
                            {item.term.context_meaning}
                          </p>
                        )}
                        {item.term.grammar_note && (
                          <p className="text-[10px] text-indigo-900 leading-tight">
                            <span className="font-bold text-indigo-700 uppercase tracking-widest text-[9px] block mb-0.5">
                              Uso / Gramática:
                            </span>
                            {item.term.grammar_note}
                          </p>
                        )}
                        {item.term.structure_note && (
                          <p className="text-[10px] text-indigo-900 leading-tight">
                            <span className="font-bold text-indigo-700 uppercase tracking-widest text-[9px] block mb-0.5">
                              Estrutura:
                            </span>
                            {item.term.structure_note}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SECTION: Fontes Onde Aparece */}
        {connectedSources.length > 0 && (
          <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-[#E5E5E7] transition-all">
            <button
              onClick={() => setIsSourcesOpen(!isSourcesOpen)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50/50 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Database className="w-5 h-5 text-purple-500" />
                <span className="text-sm font-black text-gray-800 tracking-tight">
                  Fontes Onde Aparece ({connectedSources.length})
                </span>
              </div>
              {isSourcesOpen ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </button>
            {isSourcesOpen && (
              <div className="px-6 pb-6 pt-3 border-t border-gray-100 space-y-2">
                {connectedSources.map((src, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-3 bg-purple-50/30 border border-purple-100/50 rounded-xl"
                  >
                    <span className="text-xs font-bold text-slate-700 truncate mr-3">
                      {src.title}
                    </span>
                    <span className="text-[10px] font-black text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full shrink-0">
                      {src.count} ocorrência{src.count !== 1 ? "s" : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Core Didactic Actions */}
        <div className="bg-slate-900 rounded-3xl p-6 text-white space-y-4 shadow-xl border border-slate-850">
          <div className="space-y-1">
            <h3 className="text-base font-black flex items-center gap-1.5 uppercase tracking-wide">
              <Play className="w-4 h-4 text-indigo-400 fill-indigo-400" />{" "}
              Prática & Fixação
            </h3>
            <p className="text-xs text-slate-400">
              Estude este vocabulário com o reprodutor inteligente e exercícios
              de memorização do aplicativo.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={onStudyContext}
              className="btn btn-primary flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4 fill-current text-white" />
              <span>Estudar Frases (Repetição)</span>
            </button>
            <button
              onClick={() => setShowSentencesQuiz(true)}
              className="btn bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-2"
            >
              <BrainCircuit className="w-4 h-4" />
              <span>Quiz das Frases Relacionadas</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
