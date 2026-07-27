import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { canonicalRgsJson, type RgsJsonValue } from '../packages/contracts/src/rgs.js';
import {
  createRgsSimulationEvidenceEntry,
  createRgsSimulationEvidenceManifest,
  type RgsSimulationEvidenceManifest,
  type RgsSimulationReport,
  simulateRgsMathConfig,
  verifyRgsSimulationReport,
} from '../packages/rgs-simulator/src/index.js';
import {
  createSportsPackGachaSimulationConfig,
  DEFAULT_RGS_SIMULATION_MANIFEST_PATH,
  DEFAULT_RGS_SIMULATION_REPORT_PATH,
  parseRgsSimulationCliConfiguration,
} from './rgs-simulation/core.js';

const repositoryRoot = resolve(import.meta.dir, '..');
const configuration = parseRgsSimulationCliConfiguration(process.argv.slice(2));
const mathConfig = createSportsPackGachaSimulationConfig();
const report = simulateRgsMathConfig(mathConfig, {
  rounds: configuration.rounds,
  seed: configuration.seed,
});

if (configuration.check) {
  const reportPath = resolve(
    repositoryRoot,
    configuration.reportPath ?? DEFAULT_RGS_SIMULATION_REPORT_PATH,
  );
  const manifestPath = resolve(repositoryRoot, DEFAULT_RGS_SIMULATION_MANIFEST_PATH);
  const [checkedReportText, checkedManifestText] = await Promise.all([
    readFile(reportPath, 'utf8'),
    readFile(manifestPath, 'utf8'),
  ]);
  const checkedReport = JSON.parse(checkedReportText) as RgsSimulationReport;
  const checkedManifest = JSON.parse(checkedManifestText) as RgsSimulationEvidenceManifest;
  const verification = verifyRgsSimulationReport(mathConfig, checkedReport);
  if (!verification.valid) {
    throw new Error(`Checked-in RGS simulation report failed: ${verification.errors.join('; ')}`);
  }
  if (
    canonicalRgsJson(checkedReport as unknown as RgsJsonValue) !==
    canonicalRgsJson(report as unknown as RgsJsonValue)
  ) {
    throw new Error('Checked-in RGS simulation report does not reproduce exactly');
  }
  const entry = createRgsSimulationEvidenceEntry({
    config: mathConfig,
    report: checkedReport,
    reportPath: DEFAULT_RGS_SIMULATION_REPORT_PATH,
  });
  const expectedManifest = createRgsSimulationEvidenceManifest([entry]);
  if (
    canonicalRgsJson(checkedManifest as unknown as RgsJsonValue) !==
    canonicalRgsJson(expectedManifest as unknown as RgsJsonValue)
  ) {
    throw new Error('Checked-in RGS simulation manifest does not match its exact evidence');
  }
  console.log(
    JSON.stringify(
      {
        manifest: DEFAULT_RGS_SIMULATION_MANIFEST_PATH,
        passed: true,
        report: DEFAULT_RGS_SIMULATION_REPORT_PATH,
        reportHash: checkedReport.reportHash,
        rounds: checkedReport.run.rounds,
      },
      null,
      2,
    ),
  );
} else {
  if (configuration.reportPath) {
    const reportPath = resolve(repositoryRoot, configuration.reportPath);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (configuration.reportPath === DEFAULT_RGS_SIMULATION_REPORT_PATH) {
      const entry = createRgsSimulationEvidenceEntry({
        config: mathConfig,
        report,
        reportPath: DEFAULT_RGS_SIMULATION_REPORT_PATH,
      });
      const manifest = createRgsSimulationEvidenceManifest([entry]);
      const manifestPath = resolve(repositoryRoot, DEFAULT_RGS_SIMULATION_MANIFEST_PATH);
      await mkdir(dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
