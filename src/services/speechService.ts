import { Database } from "../database/db";
import { AppSettings } from "../types";
import { VoiceService } from "./voiceService";

export class SpeechService {
  private static currentUtterance: SpeechSynthesisUtterance | null = null;

  public static stop(): void {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      this.currentUtterance = null;
    }
  }

  public static async speakJapaneseText(
    text: string,
    rate: number = 0.85,
    onEnd?: () => void,
  ): Promise<void> {
    return new Promise((resolve) => {
      this.stop();
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        if (onEnd) onEnd();
        resolve();
        return;
      }

      // Load voices workaround (forces voices to load if occasionally empty)
      window.speechSynthesis.getVoices();

      const utterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utterance; // Prevent garbage collection bug in Chrome
      utterance.lang = "ja-JP";
      utterance.rate = rate;

      let resolved = false;
      let timerId: any = null;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (timerId) clearTimeout(timerId);
        if (onEnd) onEnd();
        resolve();
      };

      utterance.onend = finish;
      utterance.onerror = finish;

      const settings = Database.getSettings();
      const preferredJa = settings.voiceJa1 || "";

      const voices = window.speechSynthesis.getVoices();
      let jaVoice = voices.find((v) => v.name === preferredJa);
      if (!jaVoice) {
        jaVoice = voices.find((v) => v.lang.startsWith("ja"));
      }
      if (jaVoice) utterance.voice = jaVoice;

      window.speechSynthesis.speak(utterance);

      // Fallback: if utterance doesn't fire onend after a reasonable time.
      // Japanese TTS is typically ~200ms/char but we add generous headroom.
      const safeTimeout = Math.min(20000, Math.max(3000, text.length * 180));
      timerId = setTimeout(() => {
        if (!resolved) {
          console.warn("SpeechSynthesis timeout: onend event didn't fire.");
          finish();
        }
      }, safeTimeout);
    });
  }

  public static async speakPortugueseText(
    text: string,
    rate: number = 1.0,
    onEnd?: () => void,
  ): Promise<void> {
    return new Promise((resolve) => {
      this.stop();
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        if (onEnd) onEnd();
        resolve();
        return;
      }

      window.speechSynthesis.getVoices();

      const utterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utterance;
      utterance.lang = "pt-BR";
      utterance.rate = rate;

      let resolved = false;
      let timerId: any = null;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        if (timerId) clearTimeout(timerId);
        if (onEnd) onEnd();
        resolve();
      };

      utterance.onend = finish;
      utterance.onerror = finish;

      const settings = Database.getSettings();
      const preferredPt = settings.voicePt || "";

      const voices = window.speechSynthesis.getVoices();
      let ptVoice = voices.find((v) => v.name === preferredPt);
      if (!ptVoice) {
        ptVoice = voices.find((v) => v.lang.startsWith("pt"));
      }
      if (ptVoice) utterance.voice = ptVoice;

      window.speechSynthesis.speak(utterance);

      // Fallback: if utterance doesn't fire onend after a reasonable time.
      // Portuguese TTS is typically ~130ms/char with a 3s minimum.
      const safeTimeout = Math.min(20000, Math.max(3000, text.length * 130));
      timerId = setTimeout(() => {
        if (!resolved) {
          console.warn("SpeechSynthesis pt timeout: onend event didn't fire.");
          finish();
        }
      }, safeTimeout);
    });
  }
}
