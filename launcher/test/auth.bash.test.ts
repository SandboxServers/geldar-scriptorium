import { authSuite } from './auth-suite.ts';
import { launchers } from './harness.ts';

// SC-140: the shared login verbs in the bash launcher.
for (const l of launchers.filter((x) => x.name === 'bash')) authSuite(l);
