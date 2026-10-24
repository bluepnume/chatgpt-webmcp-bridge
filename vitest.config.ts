import type { Plugin } from 'vite';

import { vitestConfig } from 'cugel-scripts/vitest';

import { playwright } from '@vitest/browser-playwright';

const base = vitestConfig({
    root:              import.meta.dirname,
    browser:           true,
    coverageThreshold: 95
});

type Project = {
    readonly test : Readonly<Record<string, unknown>> & { readonly browser ?: Readonly<Record<string, unknown>> },
};

// Chromium with WebMCP's draft API turned on, for the native WebMCP suites.
const projects = ((base.test?.projects ?? []) as ReadonlyArray<Project>).map(project => (project.test.browser
    ? {
        ...project,
        test: {
            ...project.test,
            browser: {
                ...project.test.browser,
                provider: playwright({ launchOptions: { args: [ '--enable-features=WebMCP' ] } })
            }
        }
    }
    : project));

// Pages the tests open in frames (the panel, the demo shop, test pages) run
// their own instrumented code, often cross-origin; this adds the reporter
// that posts their coverage up to the test page (test/coverage.ts).
const reportCoverageFromPages = () : Plugin => ({
    name: 'report-coverage-from-pages',

    transformIndexHtml: html => html.replace(`</head>`, `<script type="module" src="/test/pages/report-coverage.ts"></script>
</head>`)
});

// Istanbul, not v8: frames run their own instrumented copy of the code, often
// in another process, and post their counters to the test page. v8 coverage
// only sees the test page.
export default {
    ...base,
    plugins: [ reportCoverageFromPages() ],

    // The panel's test page imports the package barrel, which brings in
    // fflate. Optimized up front, so Vite does not reload a running test
    // when it first meets it.
    optimizeDeps: { include: [ 'fflate' ] },

    test: {
        ...base.test,
        projects,
        coverage: {
            ...base.test?.coverage,
            provider: 'istanbul' as const,
            include:  [ 'src/**/*.ts', 'examples/**/*.js' ],
            exclude:  [ '**/*.test.ts', '**/*.d.ts', 'src/index.ts', 'src/panel-script.generated.ts' ]
        }
    }
};
