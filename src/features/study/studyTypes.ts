import { DictionaryEntry, Sentence } from "../../types";

export type StudyMode =
  | "jp-pt"
  | "pt-jp"
  | "pt-jp-jp"
  | "jp-repeat"
  | "shadowing"
  | "jp-meaning"
  | "meaning-jp"
  | "jp-reading-meaning"
  | "reading-jp-meaning";

export type StudyOrder = "original" | "random" | "due" | "priority";

export interface StudySessionConfig {
  entityType: "sentence" | "word" | "word_context";
  targetType: string;
  sourceId?: string | null;
  wordId?: string | null;
  filterWordType?: string;
  filterWordLevel?: string;
  limit?: number;
  offset?: number;
  order?: StudyOrder;
  studyMode?: StudyMode;
  title?: string;
  preset?: string;
}

export type StudyItem = {
  id: string;
  japanese: string;
  kana?: string | null;
  romaji?: string | null;
  portuguese?: string | null;
  isFavorite: boolean;
  isDifficult: boolean;
  type: "sentence" | "word" | "word_context";
  targetWordId?: string;
  targetSurface?: string;
  rawRef: Sentence | DictionaryEntry | any;
};

export interface StudySessionBuildResult {
  items: StudyItem[];
  warnings: string[];
}
