/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Home, PlayCircle, PlusCircle, Layers, Settings } from "lucide-react";
import { Database } from "./database/db";
import { AuthService } from "./core/authService";
import { supabase, isSupabaseConfigured } from "./core/supabaseClient";

// Component imports
import HomeScreen from "./components/HomeScreen";
import SettingsScreen from "./components/SettingsScreen";
import ImportSourceScreen from "./components/ImportSourceScreen";
import SourcesScreen from "./components/SourcesScreen";
import ReadingScreen from "./components/ReadingScreen";
import StudySetupScreen from "./components/StudySetupScreen";
import StudySourceSelectorScreen from "./components/StudySourceSelectorScreen";
import StandardStudyFlowContainer from "./components/StandardStudyFlowContainer";
import StudyPlayerScreen from "./components/StudyPlayerScreen";
import DictionaryScreen from "./components/DictionaryScreen";
import DictionaryEntryScreen from "./components/DictionaryEntryScreen";
import PendingAiScreen from "./components/PendingAiScreen";
import StatisticsScreen from "./components/StatisticsScreen";
import QuizScreen from "./components/QuizScreen";
import FlashcardScreen from "./components/FlashcardScreen";
import LoginScreen from "./components/LoginScreen";
import UnauthorizedScreen from "./components/UnauthorizedScreen";

type ScreenType =
  | "home"
  | "import_source"
  | "sources"
  | "reading"
  | "study"
  | "standard_study"
  | "study_setup"
  | "study_player"
  | "dictionary"
  | "dictionary_entry"
  | "pending_ai"
  | "statistics"
  | "quiz"
  | "flashcards"
  | "settings";

interface NavigationState {
  screen: ScreenType;
  params: any;
}

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  const [nav, setNav] = useState<NavigationState>({
    screen: "home",
    params: {},
  });

  const [history, setHistory] = useState<NavigationState[]>([]);

  const allowAuthBypass =
    (import.meta as any).env.VITE_E2E_AUTH_BYPASS === "true" ||
    (typeof window !== "undefined" && (
      (window as any).__E2E_TEST_BYPASS__ === true ||
      window.localStorage.getItem("VITE_E2E_AUTH_BYPASS") === "true"
    ));

  useEffect(() => {
    console.log("[App.tsx] Auth Bypass Status:", {
      allowAuthBypass,
      isSupabaseConfigured
    });
    if (allowAuthBypass) {
      setIsAuthLoading(false);
      setIsAuthorized(true);
      setSession({ user: { id: "test-user-id" } });
      return;
    }

    if (!isSupabaseConfigured) {
      setIsAuthLoading(false);
      setIsAuthorized(false);
      return;
    }

    // Fetch active session on mount
    supabase!.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        AuthService.setUserId(session.user.id);
        const isAdmin = await AuthService.checkAppAdmin();
        setIsAuthorized(isAdmin);
        if (isAdmin) {
          Database.init();
        }
      } else {
        setIsAuthorized(false);
      }
      setIsAuthLoading(false);
    });

    // Watch auth session changes
    const { data: { subscription } } = supabase!.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session?.user) {
        AuthService.setUserId(session.user.id);
        const isAdmin = await AuthService.checkAppAdmin();
        setIsAuthorized(isAdmin);
        if (isAdmin) {
          Database.init();
        }
      } else {
        AuthService.setUserId(null);
        setIsAuthorized(false);
      }
      setIsAuthLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleLogin = () => {
    // The onAuthStateChange event will trigger the login automatically
  };

  const handleNavigate = (screen: ScreenType, params: any = {}) => {
    const isMainTab = [
      "home",
      "sources",
      "study",
      "import_source",
      "settings",
    ].includes(screen);
    if (isMainTab) {
      setHistory([]);
    } else {
      setHistory((prev) => [...prev, nav]);
    }
    setNav({ screen, params });
  };

  const handleGoBack = () => {
    if (history.length > 0) {
      const prev = history[history.length - 1];
      setHistory((prevHistory) => prevHistory.slice(0, -1));
      setNav(prev);
    } else {
      setNav({ screen: "home", params: {} });
    }
  };

  const renderPlaceholder = (title: string, onBack: () => void) => (
    <div className="flex flex-col h-full items-center justify-center space-y-4">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="text-gray-500">Tela em desenvolvimento (Etapas futuras)</p>
      <button onClick={onBack} className="text-indigo-600 underline">
        Voltar
      </button>
    </div>
  );

  if (!isSupabaseConfigured && !allowAuthBypass) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-white p-8 rounded-3xl border border-[#E5E5E7] max-w-sm shadow-sm space-y-4">
          <h1 className="text-lg font-bold text-slate-900">Configuração Requerida</h1>
          <p className="text-sm text-gray-500">
            O banco de dados Supabase não está configurado. Por favor, declare as variáveis de ambiente necessárias no arquivo <code>.env</code>.
          </p>
        </div>
      </div>
    );
  }

  if (isAuthLoading || (session?.user && isAuthorized === null)) {
    return (
      <div className="min-h-screen bg-[#F0F0F3] flex items-center justify-center">
        <span className="w-8 h-8 border-4 border-slate-900 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session?.user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (!isAuthorized) {
    return <UnauthorizedScreen />;
  }

  return (
    <div
      className="w-full min-h-screen bg-[#F5F5F7] flex justify-center items-stretch font-sans antialiased text-[#1D1D1F]"
      id="nihongo_app_root"
    >
      {/* Device containment frame simulation for desktop and full-fluid flow globally */}
      <div
        className={`w-full max-w-lg min-h-screen bg-white relative border-x border-[#E5E5E7] flex flex-col justify-stretch overflow-hidden ${!["study_player", "standard_study", "quiz", "flashcards"].includes(nav.screen) ? 'pb-16' : ''}`}
      >
        {!isSupabaseConfigured && (
          <div className="bg-amber-100 text-amber-900 px-4 py-2 text-xs font-bold text-center border-b border-amber-200 shrink-0">
            Atenção: Supabase não configurado. Certas funções não estão
            disponíveis.
          </div>
        )}

        <AnimatePresence mode="wait">
          {/* Main conditional screen outputs */}
          {nav.screen === "home" && (
            <motion.div
              key="home"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.18, ease: "easeInOut" }}
              className="flex-1 flex flex-col"
            >
              <HomeScreen
                onNavigate={(screen, params) =>
                  handleNavigate(screen as ScreenType, params)
                }
              />
            </motion.div>
          )}

          {nav.screen === "import_source" && (
            <motion.div key="import_source" className="flex-1 flex flex-col">
              <ImportSourceScreen
                onBack={handleGoBack}
                onImportComplete={(sourceId) =>
                  handleNavigate("reading", { sourceId })
                }
              />
            </motion.div>
          )}

          {nav.screen === "sources" && (
            <motion.div key="sources" className="flex-1 flex flex-col">
              <SourcesScreen
                onBack={handleGoBack}
                onNavigateImport={() => handleNavigate("import_source")}
                onSelectSource={(sourceId) =>
                  handleNavigate("reading", { sourceId })
                }
              />
            </motion.div>
          )}

          {nav.screen === "reading" && (
            <motion.div key="reading" className="flex-1 flex flex-col">
              <ReadingScreen
                sourceId={nav.params.sourceId}
                onBack={handleGoBack}
                onNavigate={(screen, params) =>
                  handleNavigate(screen as ScreenType, params)
                }
              />
            </motion.div>
          )}

          {nav.screen === "study" && (
            <motion.div key="study" className="flex-1 flex flex-col">
              <StudySourceSelectorScreen
                onBack={handleGoBack}
                onStartStandard={(sourceId, mode) =>
                  handleNavigate("standard_study", { sourceId, mode })
                }
                onStartCustom={() => handleNavigate("study_setup")}
              />
            </motion.div>
          )}

          {nav.screen === "standard_study" && (
            <motion.div key="standard_study" className="flex-1 flex flex-col">
              <StandardStudyFlowContainer
                sourceId={nav.params.sourceId}
                mode={nav.params.mode}
                onBack={handleGoBack}
                onNavigate={handleNavigate}
              />
            </motion.div>
          )}

          {nav.screen === "study_setup" && (
            <motion.div key="study_setup" className="flex-1 flex flex-col">
              <StudySetupScreen
                onBack={handleGoBack}
                onStartSession={(config) =>
                  handleNavigate("study_player", { config })
                }
              />
            </motion.div>
          )}

          {nav.screen === "study_player" && (
            <motion.div key="study_player" className="flex-1 flex flex-col">
              <StudyPlayerScreen
                config={nav.params.config}
                onBack={handleGoBack}
                onNavigate={handleNavigate}
              />
            </motion.div>
          )}

          {nav.screen === "dictionary" && (
            <motion.div key="dictionary" className="flex-1 flex flex-col">
              <DictionaryScreen
                onBack={handleGoBack}
                onSelectEntry={(entryId) =>
                  handleNavigate("dictionary_entry", { entryId })
                }
              />
            </motion.div>
          )}

          {nav.screen === "dictionary_entry" && (
            <motion.div key="dictionary_entry" className="flex-1 flex flex-col">
              <DictionaryEntryScreen
                entryId={nav.params.entryId}
                onBack={handleGoBack}
                onStudyWord={() =>
                  handleNavigate("study_player", {
                    config: {
                      entityType: "word",
                      targetType: "specific",
                      wordId: nav.params.entryId,
                      studyMode: "jp-meaning",
                      order: "random",
                    },
                  })
                }
                onStudyContext={() =>
                  handleNavigate("study_player", {
                    config: {
                      entityType: "word_context",
                      targetType: "specific",
                      wordId: nav.params.entryId,
                      studyMode: "jp-pt",
                      order: "random",
                    },
                  })
                }
                onQuizWord={() =>
                  handleNavigate("quiz", {
                    config: {
                      quizEntityType: "word",
                      targetType: "specific",
                      wordId: nav.params.entryId,
                    },
                  })
                }
              />
            </motion.div>
          )}

          {nav.screen === "pending_ai" && (
            <motion.div key="pending_ai" className="flex-1 flex flex-col">
              <PendingAiScreen onBack={handleGoBack} />
            </motion.div>
          )}

          {nav.screen === "statistics" && (
            <motion.div key="statistics" className="flex-1 flex flex-col">
              <StatisticsScreen
                onBack={handleGoBack}
                onNavigate={(screen, params) =>
                  handleNavigate(screen as ScreenType, params)
                }
              />
            </motion.div>
          )}

          {nav.screen === "quiz" && (
            <motion.div key="quiz" className="flex-1 flex flex-col">
              <QuizScreen onBack={handleGoBack} />
            </motion.div>
          )}

          {nav.screen === "flashcards" && (
            <motion.div key="flashcards" className="flex-1 flex flex-col">
              <FlashcardScreen onBack={handleGoBack} />
            </motion.div>
          )}

          {nav.screen === "settings" && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.18, ease: "easeInOut" }}
              className="flex-1 flex flex-col"
            >
              <SettingsScreen onBack={handleGoBack} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Persistent Bottom Bar */}
        {!["study_player", "standard_study", "quiz", "flashcards"].includes(nav.screen) && (
          <nav className="absolute bottom-0 inset-x-0 h-16 bg-white border-t border-[#E5E5E7] flex px-2 z-50">
            <button
              type="button"
              onClick={() => handleNavigate("home")}
              className={`flex-1 flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${
                nav.screen === "home" ? "text-[#1D1D1F]" : "text-[#86868B]"
              }`}
            >
              <Home className="w-4 h-4" />
              <span className="text-[9px] font-bold uppercase tracking-widest">
                Início
              </span>
            </button>
            <button
              type="button"
              onClick={() => handleNavigate("sources")}
              className={`flex-1 flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${
                nav.screen === "sources" ? "text-[#1D1D1F]" : "text-[#86868B]"
              }`}
            >
              <Layers className="w-4 h-4" />
              <span className="text-[9px] font-bold uppercase tracking-widest">
                Fontes
              </span>
            </button>
            <button
              type="button"
              onClick={() => handleNavigate("study")}
              className={`flex-1 flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${
                nav.screen === "study" ? "text-[#1D1D1F]" : "text-[#86868B]"
              }`}
            >
              <PlayCircle className="w-4 h-4" />
              <span className="text-[9px] font-bold uppercase tracking-widest">
                Estudar
              </span>
            </button>
            <button
              type="button"
              onClick={() => handleNavigate("import_source")}
              className={`flex-1 flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${
                nav.screen === "import_source"
                  ? "text-[#1D1D1F]"
                  : "text-[#86868B]"
              }`}
            >
              <PlusCircle className="w-4 h-4" />
              <span className="text-[9px] font-bold uppercase tracking-widest">
                Importar
              </span>
            </button>
            <button
              type="button"
              onClick={() => handleNavigate("settings")}
              className={`flex-1 flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${
                nav.screen === "settings" ? "text-[#1D1D1F]" : "text-[#86868B]"
              }`}
            >
              <Settings className="w-4 h-4" />
              <span className="text-[9px] font-bold uppercase tracking-widest">
                Config
              </span>
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
