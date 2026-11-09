import { forGroup } from './harness.ts';
import { upgradeSuite } from './upgrade-suite.ts';

for (const l of forGroup('upgrade').filter((x) => x.name === 'pwsh')) upgradeSuite(l);
