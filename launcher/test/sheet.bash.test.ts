import { launchers } from './harness.ts';
import { sheetSuite } from './sheet-suite.ts';

// HC-26a: new --sheet and sheet-set in the bash launcher.
for (const l of launchers.filter((x) => x.name === 'bash')) sheetSuite(l);
