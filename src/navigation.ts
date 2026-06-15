export type ScreenType =
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
  | "statistics"
  | "quiz"
  | "flashcards"
  | "settings";

export type StudyConfig = Record<string, unknown>;

export interface ScreenParams {
  home: undefined;
  import_source: undefined;
  sources: undefined;
  reading: { sourceId: string };
  study: undefined;
  standard_study: { sourceId: string; mode?: "sentences" | "words" };
  study_setup: undefined;
  study_player: { config: StudyConfig };
  dictionary: undefined;
  dictionary_entry: { entryId: string };
  statistics: undefined;
  quiz: { config?: StudyConfig } | undefined;
  flashcards: undefined;
  settings: undefined;
}

export type NavigationParams<Screen extends ScreenType = ScreenType> = ScreenParams[Screen];

export type NavigationState = {
  [Screen in ScreenType]: undefined extends ScreenParams[Screen]
    ? { screen: Screen; params?: undefined }
    : { screen: Screen; params: Exclude<ScreenParams[Screen], undefined> };
}[ScreenType];

export type AppNavigate = <Screen extends ScreenType>(
  screen: Screen,
  ...args: undefined extends ScreenParams[Screen]
    ? [params?: Exclude<ScreenParams[Screen], undefined>]
    : [params: ScreenParams[Screen]]
) => void;

export function createNavigationState<Screen extends ScreenType>(
  screen: Screen,
  ...args: undefined extends ScreenParams[Screen]
    ? [params?: Exclude<ScreenParams[Screen], undefined>]
    : [params: ScreenParams[Screen]]
): NavigationState {
  const [params] = args;
  return params === undefined
    ? ({ screen } as NavigationState)
    : ({ screen, params } as NavigationState);
}
