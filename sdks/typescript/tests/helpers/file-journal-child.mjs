import { FileOperationJournal } from '../../dist/index.js';
const [directory, mode, count] = process.argv.slice(2), journal = new FileOperationJournal(directory);
if (mode === 'increment') {
  for (let i = 0; i < Number(count); i++) await journal.withLock('counter', async () => {
    const state = await journal.load('counter') ?? { value: 0 };
    await journal.store('counter', { value: state.value + 1 });
  });
  process.send?.({ done: true });
} else if (mode === 'hold') {
  await journal.withLock('counter', async () => {
    process.send?.({ held: true });
    await new Promise(resolve => process.once('message', resolve));
  });
} else if (mode === 'replace') {
  await journal.withLock('snapshot', async () => {
    process.send?.({ writing: true });
    await journal.store('snapshot', { version: 'new', payload: 'x'.repeat(16 * 1024 * 1024) });
  });
}
process.disconnect?.();
