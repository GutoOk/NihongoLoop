import React, { lazy, Suspense, useState, useEffect } from "react";
import { Home, PlayCircle, PlusCircle, Layers, Settings } from "lucide-react";
import { AuthService } from "./core/authService";
import { supabase, isSupabaseConfigured } from "./core/supabaseClient";

import LoginScreen from "./components/LoginScreen";
import UnauthorizedScreen from "./components/UnauthorizedScreen";
import {
  AppNavigate,
  NavigationState,
  ScreenType,
  createNavigationState,
} from "./navigation";

const HomeScreen = lazy(() => import("./components/HomeScreen"));
const SettingsScreen = lazy(() => import("./components/SettingsScreen"));
const ImportSourceScreen = lazy(() => import("./components/ImportSourceScreen"));
const SourcesScreen = lazy(() => import("./components/SourcesScreen"));
const ReadingScreen = lazy(() => import("./components/ReadingScreen"));
const StudySetupScreen = lazy(() => import("./components/StudySetupScreen"));
const StudySourceSelectorScreen = lazy(() => import("./components/StudySourceSelectorScreen"));
const StandardStudyFlowContainer = lazy(() => import("./components/StandardStudyFlowContainer"));
const StudyPlayerScreen = lazy(() => import("./components/StudyPlayerScreen"));
const DictionaryScreen = lazy(() => import("./components/DictionaryScreen"));
const DictionaryEntryScreen = lazy(() => import("./components/DictionaryEntryScreen"));
const PendingAiScreen = lazy(() => import("./components/PendingAiScreen"));
const StatisticsScreen = lazy(() => import("./components/StatisticsScreen"));
const QuizScreen = lazy(() => import("./components/QuizScreen"));
const FlashcardScreen = lazy(() => import("./components/FlashcardScreen"));

function ScreenLoadingFallback() {
  return (
    <div className="flex-1 flex items-center justify-center bg-white">
      <span className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

const FULLSCREEN_STUDY_SCREENS: ScreenType[] = [
  "study_player",
  "standard_study",
  "quiz",
  "flashcards",
];

const MAIN_TAB_SCREENS: ScreenType[] = [
  "home",
  "sources",
  "study",
  "import_source",
  "settings",
];

const BOTTOM_NAV_ITEMS: Array<{
  screen: ScreenType;
  label: string;
  Icon: typeof Home;
}> = [
  { screen: "home", label: "Início", Icon: Home },
  { screen: "sources", label: "Fontes", Icon: Layers },
  { screen: "study", label: "Estudar", Icon: PlayCircle },
  { screen: "import_source", label: "Importar", Icon: PlusCircle },
  { screen: "settings", label: "Config", Icon: Settings },
];

export default function App() {
  const [session, setSession] = useState<{ user: { id: string } } | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);

  const [nav, setNav] = useState<NavigationState>({ screen: "home" });
  const [history, setHistory] = useState<NavigationState[]>([]);

  const allowAuthBypass =
    import.meta.env.MODE !== "production" &&
    (import.meta.env.VITE_E2E_AUTH_BYPASS === "true" ||
      (typeof window !== "undefined" && (
        (window as { __E2E_TEST_BYPASS__?: boolean }).__E2E_TEST_BYPASS__ === true ||
        window.localStorage.getItem("VITE_E2E_AUTH_BYPASS") === "true"
      )));

  useEffect(() => {
    if (allowAuthBypass) {
      if (import.meta.env.DEV) {
        console.log("[App.tsx] Auth Bypass ativo - apenas em modo de desenvolvimento.");
      }
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

    const applySession = async (session: { user: { id: string } } | null) => {
      setSession(session);
      if (session?.user) {
        AuthService.setUserId(session.user.id);
        const isAdmin = await AuthService.checkAppAdmin();
        setIsAuthorized(isAdmin);
      } else {
        AuthService.setUserId(null);
        setIsAuthorized(false);
      }
      setIsAuthLoading(false);
    };

    supabase!.auth.getSession().then(({ data: { session } }) => applySession(session));

    const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    return () => { subscription.unsubscribe(); };
  }, []);

  const handleNavigate: AppNavigate = (screen, ...args) => {
    const isMainTab = MAIN_TAB_SCREENS.includes(screen);
    if (isMainTab) {
      setHistory([]);
    } else {
      setHistory((prev) => [...prev, nav]);
    }
    setNav(createNavigationState(screen, ...args));
  };

  const handleGoBack = () => {
    if (history.length > 0) {
      const prev = history[history.length - 1];
      setHistory((prevHistory) => prevHistory.slice(0, -1));
      setNav(prev);
    } else {
      setNav({ screen: "home" });
    }
  };

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
    return <LoginScreen />;
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
        className={`w-full max-w-lg min-h-screen bg-white relative border-x border-[#E5E5E7] flex flex-col justify-stretch overflow-hidden ${!FULLSCREEN_STUDY_SCREENS.includes(nav.screen) ? 'pb-16' : ''}`}
      >
        {!isSupabaseConfigured && (
          <div className="bg-amber-100 text-amber-900 px-4 py-2 text-xs font-bold text-center border-b border-amber-200 shrink-0">
            Atenção: Supabase não configurado. Certas funções não estão
            disponíveis.
          </div>
        )}

        <Suspense fallback={<ScreenLoadingFallback />}>
          <>
            {/* Main conditional screen outputs */}
            {nav.screen === "home" && (
            <div
              key="home"
              className="flex-1 flex flex-col"
            >
              <HomeScreen
                onNavigate={handleNavigate}
              />
            </div>
            )}

          {nav.screen === "import_source" && (
            <div key="import_source" className="flex-1 flex flex-col">
              <ImportSourceScreen
                onBack={handleGoBack}
                onImportComplete={(sourceId) =>
                  handleNavigate("reading", { sourceId })
                }
              />
            </div>
          )}

          {nav.screen === "sources" && (
            <div key="sources" className="flex-1 flex flex-col">
              <SourcesScreen
                onBack={handleGoBack}
                onNavigateImport={() => handleNavigate("import_source")}
                onSelectSource={(sourceId) =>
                  handleNavigate("reading", { sourceId })
                }
              />
            </div>
          )}

          {nav.screen === "reading" && (
            <div key="reading" className="flex-1 flex flex-col">
              <ReadingScreen
                sourceId={nav.params.sourceId}
                onBack={handleGoBack}
                onNavigate={handleNavigate}
              />
            </div>
          )}

          {nav.screen === "study" && (
            <div key="study" className="flex-1 flex flex-col">
              <StudySourceSelectorScreen
                onBack={handleGoBack}
                onStartStandard={(sourceId, mode) =>
                  handleNavigate("standard_study", { sourceId, mode })
                }
                onStartCustom={() => handleNavigate("study_setup")}
              />
            </div>
          )}

          {nav.screen === "standard_study" && (
            <div key="standard_study" className="flex-1 flex flex-col">
              <StandardStudyFlowContainer
                sourceId={nav.params.sourceId}
                mode={nav.params.mode}
                onBack={handleGoBack}
                onNavigate={handleNavigate}
              />
            </div>
          )}

          {nav.screen === "study_setup" && (
            <div key="study_setup" className="flex-1 flex flex-col">
              <StudySetupScreen
                onBack={handleGoBack}
                onStartSession={(config) =>
                  handleNavigate("study_player", { config })
                }
              />
            </div>
          )}

          {nav.screen === "study_player" && (
            <div key="study_player" className="flex-1 flex flex-col">
              <StudyPlayerScreen
                config={nav.params.config}
                onBack={handleGoBack}
                onNavigate={handleNavigate}
              />
            </div>
          )}

          {nav.screen === "dictionary" && (
            <div key="dictionary" className="flex-1 flex flex-col">
              <DictionaryScreen
                onBack={handleGoBack}
                onSelectEntry={(entryId) =>
                  handleNavigate("dictionary_entry", { entryId })
                }
              />
            </div>
          )}

          {nav.screen === "dictionary_entry" && (
            <div key="dictionary_entry" className="flex-1 flex flex-col">
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
            </div>
          )}

          {nav.screen === "pending_ai" && (
            <div key="pending_ai" className="flex-1 flex flex-col">
              <PendingAiScreen onBack={handleGoBack} />
            </div>
          )}

          {nav.screen === "statistics" && (
            <div key="statistics" className="flex-1 flex flex-col">
              <StatisticsScreen
                onBack={handleGoBack}
                onNavigate={handleNavigate}
              />
            </div>
          )}

          {nav.screen === "quiz" && (
            <div key="quiz" className="flex-1 flex flex-col">
              <QuizScreen onBack={handleGoBack} />
            </div>
          )}

          {nav.screen === "flashcards" && (
            <div key="flashcards" className="flex-1 flex flex-col">
              <FlashcardScreen onBack={handleGoBack} />
            </div>
          )}

          {nav.screen === "settings" && (
            <div
              key="settings"
              className="flex-1 flex flex-col"
            >
              <SettingsScreen onBack={handleGoBack} />
            </div>
          )}
          </>
        </Suspense>

        {/* Persistent Bottom Bar */}
        {!FULLSCREEN_STUDY_SCREENS.includes(nav.screen) && (
          <nav className="absolute bottom-0 inset-x-0 h-16 bg-white border-t border-[#E5E5E7] flex px-2 z-50">
            {BOTTOM_NAV_ITEMS.map(({ screen, label, Icon }) => {
              const isActive = nav.screen === screen;
              return (
                <button
                  key={screen}
                  type="button"
                  onClick={() => handleNavigate(screen)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex-1 flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${
                    isActive ? "text-[#1D1D1F]" : "text-[#86868B]"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-[9px] font-bold uppercase tracking-widest">
                    {label}
                  </span>
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
