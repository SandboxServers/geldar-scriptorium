import { launchers } from './harness.ts';
import { upgradeSuite } from './upgrade-suite.ts';

for (const l of launchers.filter((x) => x.name === 'bash')) upgradeSuite(l);
