import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StandardStudyFlowContainer from '../StandardStudyFlowContainer';
import { TermRepository, SentenceRepository } from '../../repositories';

// Mock TermDetectionService before it's imported dynamically
vi.mock('../../services/termDetectionService', () => ({
  TermDetectionService: {
    detectWordsInSentences: vi.fn().mockResolvedValue(true),
  }
}));

vi.mock('../../repositories', () => ({
  SentenceRepository: {
    getBySourceId: vi.fn(),
    update: vi.fn(),
  },
  TermRepository: {
    getBySentences: vi.fn(),
  },
  StudySessionRepository: {
    getSourceOffset: vi.fn().mockResolvedValue(0),
    saveSourceOffset: vi.fn().mockResolvedValue(true),
  }
}));

vi.mock('../StudyPlayerScreen', () => ({
  default: ({ onFinishStandardFlow, isFinishingStandardFlow }: any) => (
    <div data-testid="study-player">
      <button 
        disabled={isFinishingStandardFlow}
        onClick={() => onFinishStandardFlow(['sent-1'])}>
        Finish Study
      </button>
    </div>
  )
}));

vi.mock('../StandardWordsQuizScreen', () => ({
  default: () => <div data-testid="quiz-screen">Quiz</div>
}));

describe('StandardStudyFlowContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows study player initially', () => {
    render(<StandardStudyFlowContainer sourceId="src-1" mode="sentences" onBack={() => {}} onNavigate={() => {}} />);
    expect(screen.getByTestId('study-player')).toBeInTheDocument();
  });

  it('proceeds to quiz when terms already exist', async () => {
    vi.mocked(TermRepository.getBySentences).mockResolvedValue([
      { dictionary_entry_id: 'dict-1' } as any
    ]);

    render(<StandardStudyFlowContainer sourceId="src-1" mode="sentences" onBack={() => {}} onNavigate={() => {}} />);
    
    // Simulate studying and then clicking finish
    await userEvent.click(screen.getByText('Finish Study'));

    await waitFor(() => {
      expect(TermRepository.getBySentences).toHaveBeenCalledWith(['sent-1']);
      expect(screen.getByTestId('quiz-screen')).toBeInTheDocument();
    });
  });

  it('calls term detection if no terms are returned initially, and shows error if still empty', async () => {
    vi.mocked(TermRepository.getBySentences).mockResolvedValue([]);
    
    const { TermDetectionService } = await import('../../services/termDetectionService');

    render(<StandardStudyFlowContainer sourceId="src-1" mode="sentences" onBack={() => {}} onNavigate={() => {}} />);
    
    await userEvent.click(screen.getByText('Finish Study'));

    await waitFor(() => {
      expect(TermRepository.getBySentences).toHaveBeenCalledTimes(2);
      expect(TermDetectionService.detectWordsInSentences).toHaveBeenCalledWith(['sent-1']);
      
      // Should show summary error since terms are still empty
      expect(screen.getByText(/Não encontrei palavras vinculadas a este bloco/i)).toBeInTheDocument();
    });
  });
});

