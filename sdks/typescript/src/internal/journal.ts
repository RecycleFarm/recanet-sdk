import { DmrvnError } from '../errors.js';
import type { OperationJournal } from '../operation-journal.js';

export async function findClaimOperations(journal: OperationJournal, claimId: string): Promise<readonly Record<string, unknown>[]> {
  if (typeof journal.findOperationsByClaimId !== 'function') throw new DmrvnError('JOURNAL_UNAVAILABLE');
  return journal.findOperationsByClaimId(claimId);
}
