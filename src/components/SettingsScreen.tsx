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
        if (import.meta.env.MODE !== "production") {
          window.localStorage.removeItem("VITE_E2E_AUTH_BYPASS");
          window.location.reload();
        } else {
          showAlert("Supabase não configurado", "Não há sessão real do Supabase para encerrar.");
        }
      }
    } catch (e: any) {
      console.error("Erro ao fazer logout:", e);
      showAlert("Erro", "Erro ao desconectar usuário.");
    }
  };

  return (
    <div className="screen-gray">
      <header className="screen-header">
        <button
          type="button"
          onClick={onBack}
          className="btn-back"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="screen-title">Configurações</h1>
      </header>

      <main className="flex-1 overflow-auto p-4 space-y-4">
        {/* Audio settings */}
        <div className="card-section space-y-4">
          <h2 className="field-label border-b border-[#E5E5E7] pb-2">Geral / Estudo</h2>

          {[
            { label: "Velocidade Áudio Japonês", key: "speedJa", min: 0.5, max: 1.5, step: 0.05, unit: "x", default: 0.85 },
            { label: "Velocidade Áudio Português", key: "speedPt", min: 0.5, max: 1.5, step: 0.05, unit: "x", default: 1.0 },
            { label: "Pausa entre Frases/Repetições (s)", key: "pauseBetweenSpeeches", min: 0, max: 3, step: 0.1, unit: "s", default: 0.5 },
            { label: "Pausa para o Próximo Item (s)", key: "pauseBetweenItems", min: 0.5, max: 5, step: 0.1, unit: "s", default: 1.5 },
          ].map(({ label, key, min, max, step, unit, default: def }) => (
            <div key={key} className="space-y-1">
              <div className="flex justify-between items-baseline">
                <label htmlFor={`setting-${key}`} className="text-xs font-bold text-[#1D1D1F]">{label}</label>
                <span className="text-[10px] font-mono text-[#86868B]">{settings[key] ?? def}{unit}</span>
              </div>
              <input
                id={`setting-${key}`}
                type="range"
                min={min}
                max={max}
                step={step}
                value={settings[key] ?? def}
                onChange={(e) => handleChange(key, parseFloat(e.target.value))}
                className="w-full accent-indigo-600"
              />
            </div>
          ))}

          <div className="pt-4 border-t border-[#E5E5E7] space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="voice-ja-select" className="field-label">Voz - Japonês</label>
              <select
                id="voice-ja-select"
                value={settings.voiceJa1 || ""}
                onChange={(e) => handleChange("voiceJa1", e.target.value)}
                className="form-select text-xs"
              >
                <option value="">Padrão do Sistema</option>
                {voices.filter((v) => v.lang.startsWith("ja")).map((v) => (
                  <option key={v.name} value={v.name}>{v.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => SpeechService.speakJapaneseText("日本語のテストです。", settings.speedJa || 0.85)}
                className="w-full py-2 bg-indigo-50 text-indigo-700 font-bold text-[10px] uppercase rounded-xl flex items-center justify-center gap-1.5 transition-all hover:bg-indigo-100"
              >
                <Play className="w-3.5 h-3.5" /> Testar Voz Japonês
              </button>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="voice-pt-select" className="field-label">Voz - Português</label>
              <select
                id="voice-pt-select"
                value={settings.voicePt || ""}
                onChange={(e) => handleChange("voicePt", e.target.value)}
                className="form-select text-xs"
              >
                <option value="">Padrão do Sistema</option>
                {voices.filter((v) => v.lang.startsWith("pt")).map((v) => (
                  <option key={v.name} value={v.name}>{v.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => SpeechService.speakPortugueseText("Testando a voz em português.", settings.speedPt || 1.0)}
                className="w-full py-2 bg-indigo-50 text-indigo-700 font-bold text-[10px] uppercase rounded-xl flex items-center justify-center gap-1.5 transition-all hover:bg-indigo-100"
              >
                <Play className="w-3.5 h-3.5" /> Testar Voz Português
              </button>
            </div>
          </div>
        </div>

        {/* Export */}
        <div className="card-section space-y-3">
          <h2 className="field-label border-b border-[#E5E5E7] pb-2">Exportações</h2>
          <button
            type="button"
            onClick={handleExportDictionaryCSV}
            className="btn btn-secondary"
          >
            <Download className="w-4 h-4" /> Exportar Dicionário (CSV)
          </button>
        </div>

        {/* Diagnostics */}
        <div className="card-section space-y-3">
          <h2 className="field-label border-b border-[#E5E5E7] pb-2">Diagnóstico</h2>
          <p className="text-xs text-[#86868B] leading-relaxed">
            Verifique o status e o tempo de resposta da sua conexão com o Supabase.
          </p>
          <button
            type="button"
            onClick={handleDiagnoseSupabase}
            disabled={diagnosing}
            className="btn btn-secondary"
          >
            <Wifi className={`w-4 h-4 ${diagnosing ? "animate-pulse" : ""}`} />
            {diagnosing ? "Verificando…" : "Testar Conexão Supabase"}
          </button>
        </div>

        {/* Session */}
        <div className="card-section space-y-3">
          <h2 className="field-label border-b border-[#E5E5E7] pb-2 text-rose-500">Sessão</h2>
          <p className="text-xs text-[#86868B] leading-relaxed">
            Encerre seu acesso neste dispositivo ou mude de conta.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="btn btn-danger"
          >
            <LogOut className="w-4 h-4" /> Terminar Sessão (Sair)
          </button>
        </div>
      </main>
    </div>
  );
}
