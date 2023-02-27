import * as core from '@actions/core';
import * as github from '@actions/github';
import type { TestResult } from './junitParser';
import type { SummaryTableRow } from '@actions/core/lib/summary';

export async function annotateTestResult(testResult: TestResult, token: string, headSha: string, updateCheck: boolean, jobName: string): Promise<void> {
    const annotations = testResult.annotations.filter(annotation => annotation.annotation_level !== 'notice');
    const foundResults = testResult.totalCount > 0 || testResult.skipped > 0;

    let title = 'No test results found!';
    if (foundResults) {
        title = `${testResult.totalCount} tests run, ${testResult.passed} passed, ${testResult.skipped} skipped, ${testResult.failed} failed (${testResult.failedEvaluating} failed evaluating).`;
    }

    core.info(`ℹ️ - ${testResult.checkName} - ${title}`);

    const conclusion: 'success' | 'failure' = testResult.failed <= 0 ? 'success' : 'failure';

    for (const annotation of annotations) {
        core.info(`   🧪 - ${annotation.message.split('\n', 1)[0]}`);
    }

    const octokit = github.getOctokit(token);
    if (updateCheck) {
        const checks = await octokit.rest.checks.listForRef({
            ...github.context.repo,
            ref: headSha,
            check_name: jobName,
            status: 'in_progress',
            filter: 'latest',
        });

        core.debug(JSON.stringify(checks, null, 2));

        const check_run_id = checks.data.check_runs[0].id;

        core.info(`ℹ️ - ${testResult.checkName} - Updating checks ${annotations.length}`);
        for (let i = 0; i < annotations.length; i = i + 50) {
            const sliced = annotations.slice(i, i + 50);

            const updateCheckRequest = {
                ...github.context.repo,
                check_run_id,
                output: {
                    title,
                    summary: testResult.summary,
                    annotations: sliced,
                },
            };

            core.debug(JSON.stringify(updateCheckRequest, null, 2));

            await octokit.rest.checks.update(updateCheckRequest);
        }
    } else {
        const createCheckRequest = {
            ...github.context.repo,
            name: testResult.checkName,
            head_sha: headSha,
            status: 'completed',
            conclusion,
            output: {
                title,
                summary: testResult.summary,
                annotations: annotations.slice(0, 50),
            },
        };

        core.debug(JSON.stringify(createCheckRequest, null, 2));

        core.info(`ℹ️ - ${testResult.checkName} - Creating check for`);
        await octokit.rest.checks.create(createCheckRequest);
    }
}

export async function attachSummary(accumulateResult: TestResult, testResults: TestResult[]): Promise<void> {
    const table: SummaryTableRow[] = [
        [
            { data: 'Name', header: true },
            { data: 'Tests', header: true },
            { data: 'Passed ✅', header: true },
            { data: 'Skipped ↪️', header: true },
            { data: 'Failed ❌', header: true },
            { data: 'Failed Evaluating ⚠️', header: true },
        ],
    ];

    const detailsTable: SummaryTableRow[] = [
        [
            { data: '', header: true },
            { data: 'Test', header: true },
            { data: 'Result', header: true },
        ],
    ];

    for (const testResult of testResults) {
        table.push([
            `${testResult.checkName}`,
            `${testResult.totalCount} run`,
            `${testResult.passed} passed`,
            `${testResult.skipped} skipped`,
            `${testResult.failed} failed`,
            `${testResult.failedEvaluating} failed evaluating`,
        ]);

        const annotations = testResult.annotations.filter(annotation => annotation.annotation_level !== 'notice');

        if (annotations.length === 0) {
            detailsTable.push([`-`, `No test annotations available`, `-`]);
        } else {
            for (const annotation of annotations) {
                detailsTable.push([`${testResult.checkName}`, `${annotation.title}`, `${annotation.annotation_level === 'notice' ? '✅ pass' : `❌ ${annotation.annotation_level}`}`]);
            }
        }
    }

    if (testResults.length > 1) {
        table.push([
            'Total',
            `${accumulateResult.totalCount} run`,
            `${accumulateResult.passed} passed`,
            `${accumulateResult.skipped} skipped`,
            `${accumulateResult.failed} failed`,
            `${accumulateResult.failedEvaluating} failed evaluating`,
        ]);
    }

    await core.summary.addHeading('Overall').addTable(table).addSeparator().addHeading('Details').addTable(detailsTable).write();
}
