/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SystemVoice {
  name: string;
  lang: string;
  id: string; // usually name or combination
  isLocal: boolean;
}

export class VoiceService {
  private static voices: SpeechSynthesisVoice[] = [];
  private static listeners: ((voices: SpeechSynthesisVoice[]) => void)[] = [];

  static {
    // Initialize voices
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.refreshVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        this.refreshVoices();
      };
    }
  }

  private static refreshVoices() {
    this.voices = window.speechSynthesis.getVoices();
    this.listeners.forEach(cb => cb(this.voices));
  }

  /**
   * Promisified active voices loader that works reliably across browsers
   */
  public static ensureVoicesLoaded(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        resolve([]);
        return;
      }

      const checkVoices = (): boolean => {
        const list = window.speechSynthesis.getVoices();
        if (list && list.length > 0) {
          this.voices = list;
          return true;
        }
        return false;
      };

      if (checkVoices()) {
        resolve(this.voices);
        return;
      }

      let resolved = false;

      const handleVoicesChanged = () => {
        if (checkVoices()) {
          cleanup();
        }
      };

      const timer = setTimeout(() => {
        cleanup();
      }, timeoutMs);

      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        // Restore standard listener
        window.speechSynthesis.onvoiceschanged = () => {
          this.refreshVoices();
        };
        this.refreshVoices();
        resolve(this.voices);
      };

      window.speechSynthesis.onvoiceschanged = handleVoicesChanged;
    });
  }

  public static addVoicesChangedListener(callback: (voices: SpeechSynthesisVoice[]) => void): () => void {
    this.listeners.push(callback);
    // Call immediately with existing
    callback(this.voices);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  public static getAllVoices(): SpeechSynthesisVoice[] {
    if (this.voices.length === 0 && typeof window !== 'undefined') {
      this.voices = window.speechSynthesis.getVoices();
    }
    return this.voices;
  }

  public static getPtVoices(): SpeechSynthesisVoice[] {
    return this.getAllVoices().filter(voice => 
      voice.lang.toLowerCase().startsWith('pt') || 
      voice.lang.toLowerCase().includes('portuguese')
    );
  }

  public static getJaVoices(): SpeechSynthesisVoice[] {
    return this.getAllVoices().filter(voice => 
      voice.lang.toLowerCase().startsWith('ja') || 
      voice.lang.toLowerCase().includes('japanese')
    );
  }

  /**
   * Helper to inspect state and log potential voice counts
   */
  public static getVoiceDiagnostic(): {
    total: number;
    ptCount: number;
    jaCount: number;
    warningMessage: string | null;
  } {
    const pt = this.getPtVoices();
    const ja = this.getJaVoices();
    let warningMessage: string | null = null;

    if (ja.length === 0) {
      warningMessage = 'Não encontrei uma voz japonesa instalada no seu celular. Verifique as configurações de idioma e síntese de voz do sistema.';
    }

    return {
      total: this.getAllVoices().length,
      ptCount: pt.length,
      jaCount: ja.length,
      warningMessage
    };
  }

  /**
   * Select correct voice ref or fallback given ideal voice name or URI.
   */
  public static selectVoice(voiceIdentifier: string, lang: 'pt' | 'ja'): SpeechSynthesisVoice | null {
    const list = lang === 'pt' ? this.getPtVoices() : this.getJaVoices();
    if (list.length === 0) return null;

    if (voiceIdentifier) {
      // 1. Match by voiceURI
      const matchedByURI = list.find(v => v.voiceURI === voiceIdentifier);
      if (matchedByURI) return matchedByURI;

      // 2. Match by name
      const matchedByName = list.find(v => v.name === voiceIdentifier);
      if (matchedByName) return matchedByName;
    }

    // Fallback: prioritize google voice or standard voice, or just the first in the list
    const googleVoice = list.find(v => v.name.toLowerCase().includes('google'));
    return googleVoice || list[0];
  }
}
