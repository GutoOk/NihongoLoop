import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SourcePreparationPanel audit controls', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/SourcePreparationPanel.tsx'), 'utf8');

  it('keeps the AI audit screen focused on queue maintenance instead of study navigation', () => {
    expect(source).not.toContain('label="Estudar"');
    expect(source).toContain('Retentar problemas');
    expect(source).toContain('Cancelar nao concluidos');
    expect(source).toContain('Historico e resultados ja concluidos permanecem');
    expect(source).not.toContain('Retomar travados');
    expect(source).not.toContain('Retentar erros');
    expect(source).not.toContain('Abortar e zerar fila');
    expect(source).not.toContain('Limpar fila da fonte');
  });
});
