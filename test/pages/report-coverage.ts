// Added to every HTML page the tests load (vitest.config.ts), so frames post
// their coverage up to the test page.
import { reportCoverage } from '../coverage';

reportCoverage();
