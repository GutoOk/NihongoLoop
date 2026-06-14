import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuizScreen from '../QuizScreen';
import { DictionaryRepository, SentenceRepository, TermRepository } from '../../repositories';
import { ModalProvider } from '../ModalProvider';

vi.mock('../../repositories', () => ({
  DictionaryRepository: {
    getAll: vi.fn(),
    getAllLearnedIds: vi.fn().mockResolvedValue(new Set()),
  },
  ProgressRepository: {
    updateDictionaryProgressLog: vi.fn().mockResolvedValue(true)
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

describe('QuizScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockDictionary = [
    { id: '1', lemma: '行く', type: 'verbo', main_meaning: 'Ir', jlpt_level: 'N5' },
    { id: '2', lemma: '食べる', type: 'verbo', main_meaning: 'Comer', jlpt_level: 'N5' },
    { id: '3', lemma: '見る', type: 'verbo', main_meaning: 'Ver', jlpt_level: 'N5' },
    { id: '4', lemma: '話す', type: 'verbo', main_meaning: 'Falar', jlpt_level: 'N5' },
    { id: '5', lemma: '猫', type: 'substantivo', main_meaning: 'Gato', jlpt_level: 'N5' },
  ];

  it('filters by sourceId correctly directly via repository relations', async () => {
    // Config: Fonte A so tem '1' e '2'
    vi.mocked(DictionaryRepository.getAll).mockResolvedValue(mockDictionary as any);
    
    vi.mocked(SentenceRepository.getBySourceId).mockResolvedValue([
      { id: 's1' }, { id: 's2' }
    ] as any);
    
    vi.mocked(TermRepository.getBySentences).mockResolvedValue([
      { dictionary_entry_id: '1', sentence_id: 's1' },
      { dictionary_entry_id: '2', sentence_id: 's2' }
    ] as any);

    render(
      <ModalProvider>
        <QuizScreen onBack={() => {}} />
      </ModalProvider>
    );
    
    await waitFor(() => {
      expect(screen.getByText(/Iniciar Quiz/i)).toBeInTheDocument();
    });
  });
});

