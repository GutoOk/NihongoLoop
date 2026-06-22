import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import FlashcardScreen from '../FlashcardScreen';
import { DictionaryRepository, SentenceRepository, TermRepository } from '../../repositories';
import { ModalProvider } from '../ModalProvider';

vi.mock('../../repositories', () => ({
  DictionaryRepository: {
    getAll: vi.fn(),
    getPage: vi.fn()
  },
  ProgressRepository: {
    getAllDictionaryProgress: vi.fn().mockResolvedValue([]),
    applyFlashcardFeedback: vi.fn(),
    upsertDictionaryProgress: vi.fn(),
    getDictionaryProgress: vi.fn(),
    updateDictionaryProgressLog: vi.fn(),
    setDictionaryProgressFields: vi.fn(),
    deleteDictionaryProgress: vi.fn()
  },
  SentenceRepository: {
    getBySourceId: vi.fn(),
    getPage: vi.fn().mockResolvedValue([])
  },
  TermRepository: {
    getBySentences: vi.fn()
  },
  SourceRepository: {
    getAll: vi.fn().mockResolvedValue([])
  },
  StudySessionRepository: {
    saveSession: vi.fn().mockResolvedValue(null)
  }
}));

describe('FlashcardScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockDictionary = [
    { id: '1', lemma: '食べる', type: 'verbo', main_meaning: 'Comer', jlpt_level: 'N5' },
    { id: '2', lemma: '犬', type: 'substantivo', main_meaning: 'Cachorro', jlpt_level: 'N5' },
    { id: '3', lemma: '難しい', type: 'adjetivo_i', main_meaning: 'Difícil', jlpt_level: 'N4' }
  ];

  it('renders the flashcard hub with the smart-study CTA after loading', async () => {
    vi.mocked(DictionaryRepository.getAll).mockResolvedValue(mockDictionary as any);

    render(
      <ModalProvider>
        <FlashcardScreen onBack={() => {}} />
      </ModalProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Estudo Rápido/i)).toBeInTheDocument();
    });
  });

  it('surfaces the intelligent tutor banner', async () => {
    vi.mocked(DictionaryRepository.getAll).mockResolvedValue(mockDictionary as any);
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([{ id: 'sent-1' }] as any[]);
    vi.mocked(TermRepository.getBySentences).mockResolvedValue([{ dictionary_entry_id: '1' }] as any[]);

    render(
      <ModalProvider>
        <FlashcardScreen onBack={() => {}} />
      </ModalProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Tutor inteligente/i)).toBeInTheDocument();
    });
  });
});
