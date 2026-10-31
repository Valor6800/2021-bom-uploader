import fs from 'node:fs'; import dotenv from 'dotenv';
const env = dotenv.parse(fs.readFileSync('/Volumes/workplace/6800/bom-uploader/.env'));
const g = async (p) => (await fetch(env.JIRA_BASE_URL.replace(/\/+$/,'') + '/rest/api/2' + p, { headers: { Authorization: `Bearer ${env.JIRA_KEY}`, Accept: 'application/json' } })).json();
const types = await g('/issue/createmeta/HAR/issuetypes');
for (const t of (types.values ?? types)) {
  if (!['Part','Build','Epic'].includes(t.name)) continue;
  const f = await g(`/issue/createmeta/HAR/issuetypes/${t.id}?maxResults=100`);
  console.log(t.name, t.id, (f.values ?? []).map(v => v.fieldId + (v.required ? '*' : '')).join(','));
}
