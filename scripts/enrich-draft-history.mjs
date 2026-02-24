import fs from 'node:fs/promises';
import path from 'node:path';
import {
  enrichDraftEntries,
  summarizeByYear,
  summarizeByManager,
  summarizeByYearAndManager,
  summarizeByPosition,
  defaultMetricConfig
} from '../draft-metrics.mjs';

async function main() {
  const root = process.cwd();
  const inputPath = path.join(root, 'draft-history-2.json');
  const outputPath = path.join(root, 'draft-history-enriched.json');

  const rawText = await fs.readFile(inputPath, 'utf8');
  const sourceEntries = JSON.parse(rawText);

  // Use default caps/percentile strategy; customize here later if needed.
  const config = defaultMetricConfig();
  const enriched = enrichDraftEntries(sourceEntries, config);

  // Writes a separate enriched file. Source file remains unchanged.
  await fs.writeFile(outputPath, JSON.stringify(enriched, null, 2), 'utf8');

  console.log(`Wrote ${enriched.length} enriched entries to ${outputPath}`);

  const yearSummary = summarizeByYear(enriched);
  const managerSummary = summarizeByManager(enriched);
  const positionSummary = summarizeByPosition(enriched);
  const yearManagerSummary = summarizeByYearAndManager(enriched);

  console.log('\n=== Summary by Year (first 5) ===');
  console.table(yearSummary.slice(0, 5));

  console.log('\n=== Summary by Manager (first 10) ===');
  console.table(managerSummary.slice(0, 10));

  console.log('\n=== Summary by Position ===');
  console.table(positionSummary);

  console.log('\n=== Summary by Year and Manager (first 2 years) ===');
  for (const block of yearManagerSummary.slice(0, 2)) {
    console.log(`Year: ${block.year}`);
    console.table(block.managers.slice(0, 8));
  }
}

main().catch((error) => {
  console.error('Failed to enrich draft history:', error);
  process.exitCode = 1;
});
