import { launchers } from './harness.ts';
import { sheetSuite } from './sheet-suite.ts';

// HC-26a: new --sheet and sheet-set in the PowerShell launcher.
for (const l of launchers.filter((x) => x.name === 'pwsh')) sheetSuite(l);
