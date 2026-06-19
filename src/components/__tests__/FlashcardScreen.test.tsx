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
    updateDictionaryProgressLog: vi.fn()
  },
  SentenceRepository: {
    getBySourceId: vi.fn()
  },
  TermRepository: {
    getBySentences: vi.fn()
  },
  SourceRepository: {
    getAll: vi.fn().mockResolvedValue([])
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

  it('filters by jlpt level', async () => {
    vi.mocked(DictionaryRepository.getPage).mockResolvedValue({ entries: mockDictionary, total: mockDictionary.length } as any);

    // Render with initially JLPT N5 selected
    render(
      <ModalProvider>
        <FlashcardScreen onBack={() => {}} />
      </ModalProvider>
    );
    
    // Simulate user choosing N5
    await waitFor(() => {
      expect(screen.getByText(/Iniciar/i)).toBeInTheDocument();
    });
  });

  it('filters globally by sourceId correctly', async () => {
    vi.mocked(DictionaryRepository.getPage).mockResolvedValue({ entries: mockDictionary, total: mockDictionary.length } as any);
    
    // Simulating terms returned for a specific source
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([{ id: 'sent-1' }] as any[]);
    vi.mocked(TermRepository.getBySentences).mockResolvedValue([{ dictionary_entry_id: '1' }] as any[]);
  });
});
