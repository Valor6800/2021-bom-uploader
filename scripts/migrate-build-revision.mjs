#!/usr/bin/env node
/**
 * One-time migration (Sheet 02/08 of the plan): backfill an implicit
 * "Build 1" for every existing Assembly, and link every Part currently under
 * that Assembly to it. The Revision field needs no backfill — a blank
 * Revision already means "A" by convention (Sheet 02), so there's nothing to
 * write there.
 *
 * Idempotent and safe to re-run: an Assembly that already has a Build, or a
 * Part that's already linked to one, is left alone rather than duplicated.
 *
 * Defaults to a dry run — nothing is written until you pass --execute.
 *
 *   node scripts/migrate-build-revision.mjs            # report only
 *   node scripts/migrate-build-revision.mjs --execute   # actually write
 */

import 'dotenv/config';
import { JiraClient } from '../src/server/clients/jiraClient.js';
import { BuildService } from '../src/server/services/buildService.js';
import { sanitizeJQL } from '../src/server/utils/validators.js';

const JIRA_PROJECT = process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? 'VAL';
const EXECUTE = process.argv.includes('--execute');

const jiraClient = new JiraClient();
const buildService = new BuildService({ jiraClient });

const log = (m) => console.log(m);
const action = (m) => console.log(`  ${EXECUTE ? '→' : '(dry run)'} ${m}`);

/**
 * Every Assembly in the project. Assembly is the stock Epic type, renamed
 * (Sheet 02) — queried by the literal issue type name Jira resolves it to on
 * this instance.
 */
async function getAllAssemblies() {
  const jql = `project = ${JIRA_PROJECT} AND issuetype = Epic AND status not in (Closed, Finished)`;
  return jiraClient.searchIssues(jql, { paginate: true, fields: ['summary'] });
}

/** Parts whose Epic Link already points at this Assembly. */
async function getPartsForAssembly(assemblyKey) {
  const safe = sanitizeJQL(assemblyKey);
  const jql = `project = ${JIRA_PROJECT} AND issuetype = Part AND "Epic Link" = ${safe}`;
  return jiraClient.searchIssues(jql, { paginate: true, fields: ['summary'] });
}

async function main() {
  log(`\nBuild/Revision migration — ${EXECUTE ? 'EXECUTING' : 'DRY RUN (pass --execute to write)'}\n`);

  const assemblies = await getAllAssemblies();
  log(`Found ${assemblies.length} Assembly ticket(s) in ${JIRA_PROJECT}.\n`);

  let created = 0;
  let linked = 0;
  let skippedAssemblies = 0;

  for (const assembly of assemblies) {
    const assemblyKey = assembly.key;
    const summary = assembly.fields?.summary ?? assemblyKey;

    const existingBuilds = await buildService.getBuildsForAssemblies([assemblyKey]);
    let build1Key;

    if (existingBuilds.length > 0) {
      skippedAssemblies += 1;
      build1Key = existingBuilds[existingBuilds.length - 1].key; // oldest = Build 1
      log(`${assemblyKey} (${summary}) already has ${existingBuilds.length} build(s) — skipping creation.`);
    } else {
      action(`create Build 1 under ${assemblyKey} (${summary})`);
      if (EXECUTE) {
        const result = await buildService.createBuild({ assemblyKey, name: summary });
        build1Key = result.key;
        created += 1;
        log(`  created ${build1Key}`);
      }
    }

    if (!EXECUTE && existingBuilds.length === 0) {
      // Nothing was actually created, so there is no real Build 1 key yet to
      // link Parts to in this dry run — report what the Parts step would do
      // without a key, rather than inventing one.
      const parts = await getPartsForAssembly(assemblyKey);
      if (parts.length > 0) {
        action(`link ${parts.length} part(s) to the Build 1 that would be created above`);
      }
      continue;
    }

    const parts = await getPartsForAssembly(assemblyKey);
    const alreadyLinked = build1Key
      ? new Set(await buildService.getLinkedParts(build1Key))
      : new Set();

    for (const part of parts) {
      if (alreadyLinked.has(part.key)) continue;

      action(`link ${part.key} (${part.fields?.summary ?? ''}) to ${build1Key}`);
      if (EXECUTE) {
        await buildService.linkPartToBuild(part.key, build1Key);
        linked += 1;
      }
    }
  }

  log('\nDone.');
  log(`  Assemblies seen:      ${assemblies.length}`);
  log(`  Assemblies skipped:   ${skippedAssemblies} (already had a build)`);
  log(`  Builds created:       ${EXECUTE ? created : '(dry run — see above)'}`);
  log(`  Parts linked:         ${EXECUTE ? linked : '(dry run — see above)'}`);
  if (!EXECUTE) {
    log('\nRe-run with --execute to actually write these changes.\n');
  }
}

main().catch((err) => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
