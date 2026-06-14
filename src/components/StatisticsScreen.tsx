import React, { useEffect, useState, useMemo } from "react";
import {
  Target,
  ArrowLeft,
  BookOpen,
  Search,
  BarChart2,
  Hash,
  BookType,
} from "lucide-react";
import {
  SentenceRepository,
  DictionaryRepository,
  SourceRepository,
  TermRepository,
} from "../repositories";
import { supabase, isSupabaseConfigured } from "../core/supabaseClient";
import { AuthService } from "../core/authService";

interface StatisticsScreenProps {
  onBack: () => void;
  onNavigate?: (screen: string, params: any) => void;
}

export default function StatisticsScreen({
  onBack,
  onNavigate,
}: StatisticsScreenProps) {
  const [loading, setLoading] = useState(true);

  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const getUserId = () => AuthService.getCurrentUserId();

    const [
      { data: sources },
      { data: sentences },
      { data: words },
      { data: terms },
      { data: sentProg },
      { data: dictProg },
    ] = await Promise.all([
      isSupabaseConfigured
        ? supabase!
            .from("sources")
            .select("id, title, type")
            .eq("user_id", getUserId())
        : { data: [] },
      isSupabaseConfigured
        ? supabase!
            .from("sentences")
            .select(
              "id, source_id, favorite, difficulty, portuguese, kana, status",
            )
            .eq("user_id", getUserId())
        : { data: [] },
      isSupabaseConfigured
        ? supabase!
            .from("dictionary_entries")
            .select("id, lemma, status, main_meaning, type")
            .eq("user_id", getUserId())
        : { data: [] },
      isSupabaseConfigured
        ? supabase!
            .from("sentence_terms")
            .select("id, sentence_id, dictionary_entry_id")
            .eq("user_id", getUserId())
        : { data: [] },
      isSupabaseConfigured
        ? supabase!
            .from("sentence_progress")
            .select("sentence_id, seen_count, wrong_count")
            .eq("user_id", getUserId())
        : { data: [] },
      isSupabaseConfigured
        ? supabase!
            .from("dictionary_progress")
            .select("dictionary_entry_id, seen_count, wrong_count")
            .eq("user_id", getUserId())
        : { data: [] },
    ]);

    const s = sources || [];
    const sen = sentences || [];
    const w = words || [];
    const st = terms || [];
    const sp = sentProg || [];
    const dp = dictProg || [];

    const sentenceStudiedCount = sp.filter((p) => p.seen_count > 0).length;
    const wordStudiedCount = dp.filter((p) => p.seen_count > 0).length;

    // Term distribution (Word Frequencies)
    const termCounts: Record<string, number> = {};
    const sentenceTermCounts: Record<string, number> = {}; // source_id -> term count
    for (const t of st) {
      if (t.dictionary_entry_id) {
        termCounts[t.dictionary_entry_id] =
          (termCounts[t.dictionary_entry_id] || 0) + 1;
      }
      const sentence = sen.find((sn) => sn.id === t.sentence_id);
      if (sentence) {
        sentenceTermCounts[sentence.source_id] =
          (sentenceTermCounts[sentence.source_id] || 0) + 1;
      }
    }

    const wordsWithFreq = w.map((word) => ({
      ...word,
      freq: termCounts[word.id] || 0,
    }));

    const topWords = [...wordsWithFreq]
      .sort((a, b) => b.freq - a.freq)
      .slice(0, 15);
    const topVerbs = wordsWithFreq
      .filter((w) => w.type === "verbo")
      .sort((a, b) => b.freq - a.freq)
      .slice(0, 5);
    const topParticles = wordsWithFreq
      .filter((w) => w.type === "partícula")
      .sort((a, b) => b.freq - a.freq)
      .slice(0, 5);

    // Sources summary
    const sourceStats = s
      .map((src) => {
        const srcSents = sen.filter((sn) => sn.source_id === src.id);
        const sentIds = srcSents.map((sn) => sn.id);
        const srcTerms = st.filter((t) => sentIds.includes(t.sentence_id));
        const srcDictIds = [
          ...new Set(
            srcTerms.map((t) => t.dictionary_entry_id).filter(Boolean),
          ),
        ];

        const pendingCount = w.filter(
          (word) => srcDictIds.includes(word.id) && word.status === "pending",
        ).length;

        return {
          id: src.id,
          title: src.title,
          totalSents: srcSents.length,
          studied: sp.filter(
            (p) => sentIds.includes(p.sentence_id) && p.seen_count > 0,
          ).length,
          difficult: srcSents.filter((sn) => sn.difficulty > 0).length,
          untranslated: srcSents.filter((sn) => !sn.portuguese).length,
          unread: srcSents.filter((sn) => !sn.kana).length,
          terms: srcTerms.length,
          pendingWords: pendingCount,
        };
      })
      .sort((a, b) => b.totalSents - a.totalSents);

    setStats({
      totals: {
        sources: s.length,
        sentences: sen.length,
        words: w.length,
        terms: st.length,
        sentStudied: sentenceStudiedCount,
        wordStudied: wordStudiedCount,
      },
      sentences: {
        difficult: sen.filter((sn) => sn.difficulty > 0).length,
        favorites: sen.filter((sn) => sn.favorite).length,
        untranslated: sen.filter((sn) => !sn.portuguese).length,
        unread: sen.filter((sn) => !sn.kana).length,
        new: sen.filter((sn) => sn.status === "raw").length,
      },
      words: {
        top: topWords,
        topVerbs,
        topParticles,
        pending: w.filter((word) => word.status === "pending").length,
        aiEnriched: w.filter((word) => word.status === "ai_enriched").length,
        reviewed: w.filter((word) => word.status === "reviewed").length,
        noMeaning: w.filter((word) => !word.main_meaning).length,
      },
      sourceStats,
    });

    setLoading(false);
  };

  const handleNavigate = (screen: string, params: any) => {
    if (onNavigate) onNavigate(screen, params);
  };

  const sharedHeader = (
    <header className="screen-header">
      <button
        type="button"
        onClick={onBack}
        className="btn-back"
        aria-label="Voltar"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
      <h1 className="screen-title">Estatísticas</h1>
    </header>
  );

  if (loading || !stats) {
    return (
      <div className="screen-gray">
        {sharedHeader}
        <main className="flex-1 flex justify-center items-center">
          <div className="empty-state">
            <span className="spinner text-[#86868B]" />
            <span className="text-sm text-[#86868B]">Carregando métricas…</span>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="screen-gray">
      {sharedHeader}

      <main className="flex-1 overflow-auto p-4 space-y-6 pb-20">
        {/* Totais Gerais */}
        <div className="bg-white p-6 rounded-3xl border border-[#E5E5E7] shadow-sm">
          <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">
            Métricas Globais
          </h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-2xl text-center">
              <span className="block text-2xl font-black text-indigo-700">
                {stats.totals.sentences}
              </span>
              <span className="text-[10px] uppercase font-bold text-indigo-500">
                Total Frases
              </span>
            </div>
            <div className="bg-purple-50 border border-purple-100 p-4 rounded-2xl text-center">
              <span className="block text-2xl font-black text-purple-700">
                {stats.totals.words}
              </span>
              <span className="text-[10px] uppercase font-bold text-purple-500">
                Palavras Vocab.
              </span>
            </div>
            <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl text-center">
              <span className="block text-2xl font-black text-emerald-700">
                {stats.totals.terms}
              </span>
              <span className="text-[10px] uppercase font-bold text-emerald-500">
                Ocorrências (Terms)
              </span>
            </div>
            <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl text-center">
              <span className="block text-2xl font-black text-amber-700">
                {stats.totals.sources}
              </span>
              <span className="text-[10px] uppercase font-bold text-amber-500">
                Fontes Importadas
              </span>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl flex justify-between items-center px-6 mt-4">
            <div className="text-center">
              <span className="block text-lg font-black text-slate-800">
                {stats.totals.sentStudied}
              </span>
              <span className="text-[10px] uppercase font-bold text-slate-500">
                Frases Estudadas
              </span>
            </div>
            <div className="w-px h-8 bg-slate-300"></div>
            <div className="text-center">
              <span className="block text-lg font-black text-slate-800">
                {stats.totals.wordStudied}
              </span>
              <span className="text-[10px] uppercase font-bold text-slate-500">
                Palavras Estudadas
              </span>
            </div>
          </div>
        </div>

        {/* Overview Frases */}
        <div className="bg-white p-5 rounded-2xl border border-[#E5E5E7] shadow-sm">
          <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <BookType className="w-4 h-4 text-indigo-500" /> Saúde do Acervo de
            Frases
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 bg-gray-50 rounded-xl flex justify-between items-center">
              <span className="text-xs font-bold text-gray-600">
                Com Dificuldade
              </span>
              <span className="text-xs font-black text-red-600">
                {stats.sentences.difficult}
              </span>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl flex justify-between items-center">
              <span className="text-xs font-bold text-gray-600">Favoritas</span>
              <span className="text-xs font-black text-yellow-600">
                {stats.sentences.favorites}
              </span>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl flex justify-between items-center">
              <span className="text-xs font-bold text-gray-600">
                Sem Tradução
              </span>
              <span className="text-xs font-black text-gray-400">
                {stats.sentences.untranslated}
              </span>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl flex justify-between items-center">
              <span className="text-xs font-bold text-gray-600">
                Sem Leitura
              </span>
              <span className="text-xs font-black text-gray-400">
                {stats.sentences.unread}
              </span>
            </div>
          </div>
        </div>

        {/* Overview Vocabulário */}
        <div className="bg-white p-5 rounded-2xl border border-[#E5E5E7] shadow-sm">
          <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Hash className="w-4 h-4 text-purple-500" /> Dicionário Base
          </h3>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="p-3 bg-orange-50 rounded-xl flex justify-between items-center">
              <span className="text-xs font-bold text-orange-800">
                Pendentes
              </span>
              <span className="text-xs font-black text-orange-600">
                {stats.words.pending}
              </span>
            </div>
            <div className="p-3 bg-blue-50 rounded-xl flex justify-between items-center">
              <span className="text-xs font-bold text-blue-800">
                IA Enriquecidas
              </span>
              <span className="text-xs font-black text-blue-600">
                {stats.words.aiEnriched}
              </span>
            </div>
            <div className="p-3 bg-emerald-50 rounded-xl flex justify-between items-center">
              <span className="text-xs font-bold text-emerald-800">
                Revisadas
              </span>
              <span className="text-xs font-black text-emerald-600">
                {stats.words.reviewed}
              </span>
            </div>
            <div className="p-3 bg-red-50 rounded-xl flex justify-between items-center">
              <span className="text-xs font-bold text-red-800">
                Sem Significado
              </span>
              <span className="text-xs font-black text-red-600">
                {stats.words.noMeaning}
              </span>
            </div>
          </div>

          <div className="mt-6 border-t border-gray-100 pt-5">
            <h4 className="text-[10px] uppercase tracking-widest font-bold text-gray-500 mb-3">
              Top Palavras Frequentes no Banco de Frases
            </h4>
            {stats.words.top.length === 0 ? (
              <p className="text-xs italic text-gray-400">
                Nenhuma palavra contada.
              </p>
            ) : (
              <div className="space-y-2">
                {stats.words.top.map((w: any) => (
                  <div
                    key={w.id}
                    className="flex justify-between items-center border border-gray-100 rounded-lg p-2 bg-purple-50/30"
                  >
                    <div className="flex gap-2 items-baseline">
                      <span className="text-sm font-black text-gray-900">
                        {w.lemma}
                      </span>
                      <span className="text-[10px] text-gray-500">
                        [{w.freq}x]
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() =>
                          handleNavigate("dictionary_entry", { entryId: w.id })
                        }
                        className="px-2 py-1 bg-white border border-gray-200 text-gray-600 text-[10px] font-bold rounded"
                      >
                        Verbete
                      </button>
                      <button
                        onClick={() =>
                          handleNavigate("quiz", {
                            config: {
                              quizEntityType: "word",
                              targetType: "specific",
                              wordId: w.id,
                            },
                          })
                        }
                        className="px-2 py-1 bg-white border border-emerald-200 text-emerald-600 text-[10px] font-bold rounded"
                      >
                        Quiz
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Fontes Details */}
        <div className="bg-white p-5 rounded-2xl border border-[#E5E5E7] shadow-sm">
          <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-emerald-500" /> Progresso por
            Fonte
          </h3>
          <div className="space-y-3">
            {stats.sourceStats.length === 0 && (
              <span className="text-xs text-gray-400 font-bold">
                Nenhuma fonte avaliada.
              </span>
            )}
            {stats.sourceStats.map((s: any) => (
              <div
                key={s.id}
                className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3"
              >
                <div className="flex justify-between items-start">
                  <span className="font-bold text-sm text-gray-800 leading-tight pr-2">
                    {s.title}
                  </span>
                  <span className="text-[10px] px-2 py-1 bg-emerald-100 text-emerald-800 font-black rounded-full uppercase shrink-0">
                    {s.totalSents} frases
                  </span>
                </div>
                <div className="text-xs text-gray-500 grid grid-cols-2 gap-y-1">
                  <span>
                    Estudadas:{" "}
                    <strong className="text-gray-900">{s.studied}</strong>
                  </span>
                  <span>
                    Difíceis:{" "}
                    <strong className="text-red-500">{s.difficult}</strong>
                  </span>
                  <span>
                    Sem tradução: <strong>{s.untranslated}</strong>
                  </span>
                  <span>
                    Palavras pend.:{" "}
                    <strong className="text-orange-500">
                      {s.pendingWords}
                    </strong>
                  </span>
                </div>
                <div className="flex gap-2 pt-2 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() =>
                      handleNavigate("reading", { sourceId: s.id })
                    }
                    className="flex-1 py-1.5 bg-[#F5F5F7] border border-[#E5E5E7] text-[#1D1D1F] text-xs font-bold rounded-lg text-center"
                  >
                    Ler Fonte
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleNavigate("study_player", {
                        config: {
                          entityType: "sentence",
                          targetType: "source",
                          sourceId: s.id,
                        },
                      })
                    }
                    className="flex-1 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg text-center"
                  >
                    Estudar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
