import { authSuite } from './auth-suite.ts';
import { launchers } from './harness.ts';

// SC-140: the shared login verbs in the PowerShell launcher.
for (const l of launchers.filter((x) => x.name === 'pwsh')) authSuite(l);
