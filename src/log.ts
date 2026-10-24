// The one place the package writes to the console: problems it can only
// report, because nobody is waiting on the promise that failed.

import { PACKAGE_NAME } from './constants';

// For .catch(): logs the failure with what was being attempted.
export const reportError = (attempt : string) => (err : unknown) : void => {
    // eslint-disable-next-line no-console -- see the file comment
    console.warn(`${ PACKAGE_NAME }: ${ attempt }`, err);
};
