#!/usr/bin/env node
/**
 * Backfill: put the drawings (`<Part number>_drawing*.png` and `_drawings.pdf`) on every
 * Part that doesn't have them yet. New Parts get theirs when
 * their Build is cut; this is for the Parts cut before drawings existed.
 *
 * Whatever the cut would attach and the ticket lacks is added: the drawings
 * and any DXF of a view it didn't have (a tube's BACK, a plate's REAR); a
 * picture or STEP already there is left. Measured from the Assembly's
 * OnShape workspace, as the cut's file jobs are. Safe to re-run: a Part
 * that has its drawings PDF is skipped. Nothing is removed.
 *
 * Defaults to a dry run that reads Jira only (no OnShape call). --execute
 * reads each Assembly's BOM (one OnShape call or so) and each Part Studio's
 * shape once, then writes the files to Jira.
 *
 *   node scripts/backfill-drawings.mjs                      # report only
 *   node scripts/backfill-drawings.mjs --assembly HAR-123   # one Assembly
 *   node scripts/backfill-drawings.mjs --execute            # write
 */

import 'dotenv/config';
import { JiraClient } from '../src/server/clients/jiraClient.js';
import { OnshapeClient } from '../src/server/clients/onshapeClient.js';
import { BOMService } from '../src/server/services/bomService.js';
import { OnshapeWriter } from '../src/server/services/onshapeWriter.js';
import { PartFiles } from '../src/server/services/partFiles.js';
import { PartService } from '../src/server/services/partService.js';
import { baseNumber } from '../src/server/utils/partChain.js';
import { validateIssueKey } from '../src/server/utils/validators.js';

const PROJECT = process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? 'VAL';
const EXECUTE = process.argv.includes('--execute');
const only = process.argv.includes('--assembly') ? process.argv[process.argv.indexOf('--assembly') + 1] : null;
if (only && !validateIssueKey(only).valid) {
  console.error(`--assembly needs a ticket key like ${PROJECT}-123`);
  process.exit(2);
}

const jiraClient = new JiraClient();
const onshapeClient = new OnshapeClient();
let onshapeCalls = 0;
for (const method of ['_get', '_post', '_getBinary']) {
  const original = onshapeClient[method].bind(onshapeClient);
  onshapeClient[method] = (...args) => { onshapeCalls += 1; return original(...args); };
}
const bomService = new BOMService({ onshapeClient });
const onshapeWriter = new OnshapeWriter({ jiraClient, onshapeClient, bomService });
const partFiles = new PartFiles({ onshapeClient, jiraClient });
const partService = new PartService({ jiraClient });

const DRAWING_FILES = (number) => [`${number}_drawings.pdf`];

async function main() {
  console.log(`\nDrawings backfill: ${EXECUTE ? 'EXECUTING' : 'DRY RUN (Jira reads only; pass --execute to write)'}\n`);
  const assemblies = only
    ? [{ key: only }]
    : await jiraClient.searchIssues(`project = ${PROJECT} AND issuetype = Assembly`, { paginate: true, fields: ['summary'] });

  const totals = { parts: 0, missing: 0, attached: 0, notDrawn: 0, notFound: 0, failed: 0 };
  for (const assembly of assemblies) {
    // eslint-disable-next-line no-await-in-loop
    const stories = (await partService.getStoriesByEpics([assembly.key])).filter((s) => s.fullPartNumber);
    const missing = stories.filter((s) => DRAWING_FILES(s.fullPartNumber).some((f) => !(s.files ?? []).includes(f)));
    totals.parts += stories.length;
    totals.missing += missing.length;
    if (missing.length === 0) continue;
    console.log(`${assembly.key} ${assembly.fields?.summary ?? ''}: ${missing.length} of ${stories.length} Parts have no drawing`);
    if (!EXECUTE) continue;

    let bom;
    try {
      // eslint-disable-next-line no-await-in-loop
      bom = await onshapeWriter.readBom(assembly.key);
    } catch (err) {
      console.log(`  couldn't read its OnShape BOM: ${err?.message}`);
      totals.failed += missing.length;
      continue;
    }
    for (const story of missing) {
      const wanted = baseNumber(story);
      const origin = bom.parts.find((p) => p.origin && baseNumber(p) === wanted)?.origin;
      if (!origin) {
        console.log(`  ${story.key} ${story.fullPartNumber}: not in the Assembly's BOM now`);
        totals.notFound += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const { attached, problems } = await partFiles.attach({
        key: story.key,
        partNumber: story.fullPartNumber,
        origin,
        thickness: story.thickness,
        material: story.material,
        machinery: story.machinery,
        tapping: story.tapping,
      });
      if (problems.length) {
        console.log(`  ${story.key} ${story.fullPartNumber}: ${problems.join('; ')}`);
        totals.failed += 1;
      } else if (attached.length) {
        console.log(`  ${story.key} ${story.fullPartNumber}: attached ${attached.join(', ')}`);
        totals.attached += 1;
      } else {
        totals.notDrawn += 1;
      }
    }
  }

  console.log(`\n${totals.parts} Parts, ${totals.missing} without a drawing.`);
  if (EXECUTE) {
    console.log(`Drawn: ${totals.attached}. Nothing to draw: ${totals.notDrawn}. Not in the BOM: ${totals.notFound}. Failed: ${totals.failed}.`);
    console.log(`OnShape calls: ${onshapeCalls}.`);
  } else {
    console.log("--execute draws each Part's views: a plate's or an axle's own, and its side views.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
