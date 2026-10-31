// READ-ONLY: find existing Revises / Used In links in HAR, to see which direction hand-made links use.
import fs from 'node:fs'; import dotenv from 'dotenv';
const env = dotenv.parse(fs.readFileSync('/Volumes/workplace/6800/bom-uploader/.env'));
const g = async (p) => { const r = await fetch(env.JIRA_BASE_URL.replace(/\/+$/,'') + '/rest/api/2' + p, { headers: { Authorization: `Bearer ${env.JIRA_KEY}`, Accept: 'application/json' } }); return { s: r.status, b: await r.json().catch(() => null) }; };
for (const q of ['project = HAR AND issueLinkType in ("revises", "is revised by", "uses", "is used in")']) {
  const r = await g(`/search?jql=${encodeURIComponent(q)}&fields=summary,issuelinks,issuetype,created&maxResults=100`);
  console.log(q, '->', r.s, r.s !== 200 ? JSON.stringify(r.b?.errorMessages) : '');
  if (r.s === 200) for (const i of r.b.issues) for (const l of i.fields.issuelinks.filter(l => ['Revises','Used In'].includes(l.type.name))) {
    console.log(`  ${i.key} [${i.fields.issuetype.name}] "${i.fields.summary}" reads: ${i.key} ${l.inwardIssue ? l.type.inward + ' ' + l.inwardIssue.key : l.type.outward + ' ' + l.outwardIssue.key} (link ${l.id})`);
  }
}
