/**
 * The sticky bar's headline figure. Mirrors how the spreadsheet recomputes its
 * own total, so the number shown matches what the sheet will say after a
 * submission rather than diverging from it.
 */
import { projectTotalRemaining } from '../../src/client/src/lib/purchasingMath.js';

const TOTAL = { classification: 'Total', budget: 47721, spent: 2769.82, remaining: 29951.18 };

describe('projectTotalRemaining', () => {
  it('passes the current figure through when nothing is selected', () => {
    const result = projectTotalRemaining(TOTAL, [
      { classification: 'Robot', pending: 0 },
      { classification: 'Tooling', pending: 0 },
    ]);

    expect(result).toEqual({
      remaining: 29951.18,
      pending: 0,
      projectedRemaining: 29951.18,
    });
  });

  it('subtracts pending spend across every category', () => {
    const result = projectTotalRemaining(TOTAL, [
      { classification: 'Robot', pending: 1000 },
      { classification: 'Tooling', pending: 1259 },
      { classification: 'Game', pending: 0 },
    ]);

    expect(result.pending).toBe(2259);
    expect(result.projectedRemaining).toBeCloseTo(27692.18, 6);
  });

  it('can project negative', () => {
    const result = projectTotalRemaining(TOTAL, [{ classification: 'Robot', pending: 40000 }]);
    expect(result.projectedRemaining).toBeLessThan(0);
  });

  it('is unmoved by spend in a classification with no Overview row', () => {
    // A VFF-classified line produces no category pending at all, which is
    // exactly what the sheet does — its total sums only the category rows.
    const result = projectTotalRemaining(TOTAL, [
      { classification: 'Robot', pending: 0 },
      { classification: 'Tooling', pending: 0 },
    ]);

    expect(result.projectedRemaining).toBe(29951.18);
  });

  it('handles a missing total row', () => {
    expect(projectTotalRemaining(null, [{ classification: 'Robot', pending: 10 }]))
      .toEqual({ remaining: null, pending: 10, projectedRemaining: null });
  });

  it('tolerates category rows with no pending field', () => {
    expect(projectTotalRemaining(TOTAL, [{ classification: 'Robot' }]).pending).toBe(0);
  });
});
