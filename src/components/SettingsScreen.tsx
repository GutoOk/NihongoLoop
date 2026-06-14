import React, { useState, useEffect } from "react";
import {
  ArrowLeft,
  Save,
  Trash2,
  Cpu,
  Download,
  Wifi,
  Activity,
  Play,
  LogOut,
} from "lucide-react";
import { Database } from "../database/db";
import {
  SourceRepository,
  SentenceRepository,
  DictionaryRepository,
} from "../repositories";
import { supabase, isSupabaseConfigured } from "../core/supabaseClient";
import { useModal } from "./ModalProvider";
import { SpeechService } from "../services/speechService";

interface SettingsScreenProps {
  onBack: () => void;
}

export default function SettingsScreen({ onBack }: SettingsScreenProps) {
  const [settings, setSettings] = useState<any>({});
  const [diagnosing, setDiagnosing] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const { showAlert } = useModal();

  useEffect(() => {
    setSettings(Database.getSettings());

    // Load voices
    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      setVoices(v);
    };
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  const handleChange = (key: string, value: any) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    Database.updateSettings({ ...updated });
  };

  const handleExportDictionaryCSV = async () => {
    try {
      const dictionary = await DictionaryRepository.getAll();
      const header = "lema,kana,romaji,tipo,significado\n";
      const escapeCSV = (val: string) => `"${(val || "").replace(/"/g, '""')}"`;
      const rows = dictionary
        .map(
          (d) =>
            `${escapeCSV(d.lemma)},${escapeCSV(d.kana)},${escapeCSV(d.romaji)},${escapeCSV(d.type)},${escapeCSV(d.main_meaning)}`,
        )
        .join("\n");
      const blob = new Blob([header + rows], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dicionario_nihongo_loop.csv`;
      a.click();
    } catch (e) {
      showAlert("Erro", "Erro ao exportar dicionário");
    }
  };

  const handleDiagnoseSupabase = async () => {
    if (!isSupabaseConfigured) {
      showAlert(
        "Diagnóstico Supabase",
        "ERRO: Supabase não está configurado!\n\nO arquivo .env não possui as variáveis de ambiente necessárias (VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY).\nComo o arquivo .env foi removido ou está vazio, o sistema está rodando sem banco de dados na nuvem.",
      );
      return;
    }

    setDiagnosing(true);
    try {
      const start = Date.now();
      const { data, error } = await supabase!
        .from("sources")
        .select("id")
        .limit(1);
      const duration = Date.now() - start;

      if (error) {
        throw error;
      }

      showAlert(
        "Banco Funcional",
        `Conexão estabelecida com sucesso!\n\nTempo de resposta da consulta: ${duration}ms.\n\nIsso significa que o banco de dados do Supabase está ativo, respondendo perfeitamente e plenamente mapeado.`,
      );
    } catch (err: any) {
      console.error(err);
      showAlert(
        "Banco de Dados com Falha / Indisponível",
        `Ocorreu um erro ao conectar ao Supabase:\n\nDetalhes: ${err.message || err.details || "Desconhecido"}\n\nRecomendações:\n1. Certifique-se de que a URL e chave anônima no .env são válidas.\n2. Verifique se o seu projeto Supabase não foi pausado por inatividade.\n3. Verifique se o banco de dados não atingiu o limite da sua conta.\n4. Verifique as configurações de rede (firewall/DNS).`,
      );
    } finally {
      setDiagnosing(false);
    }
  };

  const handleLogout = async () => {
    try {
      if (isSupabaseConfigured && supabase) {
        await supabase.auth.signOut();
      } else {
        window.localStorage.removeItem("VITE_E2E_AUTH_BYPASS");
        window.location.reload();
      }
    } catch (e: any) {
      console.error("Erro ao fazer logout:", e);
      showAlert("Erro", "Erro ao desconectar usuário.");
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#F5F5F7] text-[#1D1D1F]">
      <header className="px-4 py-4 bg-white border-b border-[#E5E5E7] flex flex-col shrink-0 sticky top-0 z-10 space-y-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 -ml-2 text-[#86868B] hover:text-[#1D1D1F] transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-sm font-black uppercase tracking-widest text-[#1D1D1F]">
            Configurações
          </h1>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 space-y-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm space-y-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest border-b border-gray-100 pb-2">
            Geral / Estudo
          </h2>

          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-700">
              Velocidade Áudio Japonês
            </label>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={settings.speedJa || 0.85}
              onChange={(e) =>
                handleChange("speedJa", parseFloat(e.target.value))
              }
              className="w-full"
            />
            <div className="text-[10px] text-gray-400">
              {settings.speedJa || 0.85}x
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-700">
              Velocidade Áudio Português
            </label>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={settings.speedPt || 1.0}
              onChange={(e) =>
                handleChange("speedPt", parseFloat(e.target.value))
              }
              className="w-full"
            />
            <div className="text-[10px] text-gray-400">
              {settings.speedPt || 1.0}x
            </div>
          </div>

          <div className="space-y-1 mt-4">
            <label className="text-xs font-bold text-gray-700">
              Pausa entre Frases/Repetições (segundos)
            </label>
            <input
              type="range"
              min="0"
              max="3"
              step="0.1"
              value={settings.pauseBetweenSpeeches || 0.5}
              onChange={(e) =>
                handleChange("pauseBetweenSpeeches", parseFloat(e.target.value))
              }
              className="w-full"
            />
            <div className="text-[10px] text-gray-400">
              {settings.pauseBetweenSpeeches || 0.5}s
            </div>
          </div>

          <div className="space-y-1 mt-4">
            <label className="text-xs font-bold text-gray-700">
              Pausa para o Próximo Item (segundos)
            </label>
            <input
              type="range"
              min="0.5"
              max="5"
              step="0.1"
              value={settings.pauseBetweenItems || 1.5}
              onChange={(e) =>
                handleChange("pauseBetweenItems", parseFloat(e.target.value))
              }
              className="w-full"
            />
            <div className="text-[10px] text-gray-400">
              {settings.pauseBetweenItems || 1.5}s
            </div>
          </div>

          <div className="space-y-1 mt-6 border-t border-gray-100 pt-6">
            <label className="text-xs font-bold text-gray-700">
              Voz - Japonês
            </label>
            <select
              value={settings.voiceJa1 || ""}
              onChange={(e) => handleChange("voiceJa1", e.target.value)}
              className="w-full px-3 py-2 border border-[#E5E5E7] bg-[#F5F5F7] rounded-xl text-xs outline-none truncate"
            >
              <option value="">Padrão do Sistema</option>
              {voices
                .filter((v) => v.lang.startsWith("ja"))
                .map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
            </select>
            <button
              onClick={() =>
                SpeechService.speakJapaneseText(
                  "日本語のテストです。",
                  settings.speedJa || 0.85,
                )
              }
              className="mt-2 w-full py-2 bg-indigo-50 text-indigo-700 font-bold text-[10px] uppercase rounded-xl flex items-center justify-center gap-1 transition-all hover:bg-indigo-100"
            >
              <Play className="w-3.5 h-3.5" /> Testar Voz Japonês
            </button>
          </div>

          <div className="space-y-1 mt-4">
            <label className="text-xs font-bold text-gray-700">
              Voz - Português
            </label>
            <select
              value={settings.voicePt || ""}
              onChange={(e) => handleChange("voicePt", e.target.value)}
              className="w-full px-3 py-2 border border-[#E5E5E7] bg-[#F5F5F7] rounded-xl text-xs outline-none truncate"
            >
              <option value="">Padrão do Sistema</option>
              {voices
                .filter((v) => v.lang.startsWith("pt"))
                .map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
            </select>
            <button
              onClick={() =>
                SpeechService.speakPortugueseText(
                  "Testando a voz em português.",
                  settings.speedPt || 1.0,
                )
              }
              className="mt-2 w-full py-2 bg-indigo-50 text-indigo-700 font-bold text-[10px] uppercase rounded-xl flex items-center justify-center gap-1 transition-all hover:bg-indigo-100"
            >
              <Play className="w-3.5 h-3.5" /> Testar Voz Português
            </button>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm space-y-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest border-b border-gray-100 pb-2">
            Exportações
          </h2>

          <button
            onClick={handleExportDictionaryCSV}
            className="w-full py-3 bg-gray-50 border border-gray-200 text-gray-700 font-bold uppercase text-[10px] rounded-xl flex items-center justify-center gap-2 transition-all hover:bg-gray-100"
          >
            <Download className="w-4 h-4" /> Exportar Dicionário (CSV)
          </button>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm space-y-4 border border-slate-100">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest border-b border-gray-100 pb-2">
            Diagnóstico de Banco de Dados
          </h2>
          <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
            Se você sentir que a importação de novas fontes, o dicionário ou o
            progresso de estudos travam ou demoram para responder, utilize a
            ferramenta abaixo para verificar o status e o tempo de resposta da
            sua conexão com o Supabase.
          </p>
          <button
            onClick={handleDiagnoseSupabase}
            disabled={diagnosing}
            className="w-full py-3 bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold uppercase text-[10px] rounded-xl flex items-center justify-center gap-2 transition-all hover:bg-indigo-100/70 disabled:opacity-50 cursor-pointer"
          >
            <Wifi className={`w-4 h-4 ${diagnosing ? "animate-pulse" : ""}`} />
            {diagnosing ? "Verificando Conexão..." : "Testar Conexão Supabase"}
          </button>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm space-y-4 border border-red-100">
          <h2 className="text-xs font-bold text-red-500 uppercase tracking-widest border-b border-gray-100 pb-2">
            Sessão / Autenticação
          </h2>
          <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
            Você está conectado ao sistema. Se desejar mudar de conta ou encerrar seu acesso neste dispositivo, utilize a opção abaixo.
          </p>
          <button
            onClick={handleLogout}
            className="w-full py-3 bg-red-50 border border-red-200 text-red-600 font-bold uppercase text-[10px] rounded-xl flex items-center justify-center gap-2 transition-all hover:bg-red-100 cursor-pointer"
          >
            <LogOut className="w-4 h-4" /> Terminar Sessão (Sair)
          </button>
        </div>
      </main>
    </div>
  );
}
