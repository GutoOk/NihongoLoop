import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StandardWordsQuizScreen from '../StandardWordsQuizScreen';
import { ProgressRepository, DictionaryRepository } from '../../repositories';

vi.mock('../../repositories', () => ({
  DictionaryRepository: {
    getByIds: vi.fn(),
    getAll: vi.fn()
  },
  ProgressRepository: {
    updateDictionaryProgressLog: vi.fn().mockResolvedValue(true)
  }
}));

describe('StandardWordsQuizScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading initially and starts quiz if enough words exist', async () => {
    vi.mocked(DictionaryRepository.getByIds).mockResolvedValue([
      { id: '1', main_meaning: 'Carro', lemma: '車' } as any
    ]);
    vi.mocked(DictionaryRepository.getAll).mockResolvedValue([]);

    render(<StandardWordsQuizScreen entryIds={['1']} onBack={() => {}} />);
    
    // It should eventually show the quiz UI
    await waitFor(() => {
      expect(screen.getByText('Iniciar Quiz')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Começar'));

    await waitFor(() => {
      expect(screen.getByText('Carro')).toBeInTheDocument();
    });
  });

  it('does not crash and uses fallbacks if getAll takes too long or fails', async () => {
    vi.mocked(DictionaryRepository.getByIds).mockResolvedValue([
      { id: '1', main_meaning: 'Carro', lemma: '車' } as any
    ]);
    // Simulate a slow getAll
    vi.mocked(DictionaryRepository.getAll).mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve([]), 5000))
    );

    render(<StandardWordsQuizScreen entryIds={['1']} onBack={() => {}} />);
    
    await waitFor(() => {
      expect(screen.getByText('Iniciar Quiz')).toBeInTheDocument();
    }, { timeout: 4000 }); // Should complete before the 5000ms delay due to 3500ms timeout
  });

  it('logs progress on correct answer', async () => {
    vi.mocked(DictionaryRepository.getByIds).mockResolvedValue([
      { id: '1', main_meaning: 'Carro', lemma: '車' } as any
    ]);
    vi.mocked(DictionaryRepository.getAll).mockResolvedValue([]);

    render(<StandardWordsQuizScreen entryIds={['1']} onBack={() => {}} />);
    
    await waitFor(() => {
      expect(screen.getByText('Iniciar Quiz')).toBeInTheDocument();
    });
    
    await userEvent.click(screen.getByText('Começar'));

    await waitFor(() => {
      expect(screen.getByText('Carro')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Carro'));

    await waitFor(() => {
      expect(ProgressRepository.updateDictionaryProgressLog).toHaveBeenCalledWith('1', true);
    });
  });
});

