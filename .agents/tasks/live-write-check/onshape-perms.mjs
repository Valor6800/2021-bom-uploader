// READ-ONLY: OnShape key/user and document permission checks. Prints no secrets.
import fs from 'node:fs'; import dotenv from 'dotenv';
const env = dotenv.parse(fs.readFileSync('/Volumes/workplace/6800/bom-uploader/.env'));
const { OnshapeClient } = await import('/Volumes/workplace/6800/bom-uploader/src/server/clients/onshapeClient.js');
const c = new OnshapeClient({ baseUrl: env.ONSHAPE_BASE_URL, accessKey: env.API_KEY, secretKey: env.SECRET_KEY });
console.log('baseUrl shape:', /^https:\/\/[^/]+\/?$/.test(env.ONSHAPE_BASE_URL) ? 'origin only' : 'has path', new URL(env.ONSHAPE_BASE_URL).host);
const si = await c._get('/api/users/sessioninfo');
console.log('sessioninfo keys:', Object.keys(si).join(','));
console.log('oauth2Scopes:', si.oauth2Scopes, 'roles:', JSON.stringify(si.roles), 'isGuest:', si.isGuest);
const d = await c._get('/api/documents/8c64dfdcb66184646a7a3f17');
console.log('doc name:', d.name, '| permission:', d.permission, '| permissionSet:', JSON.stringify(d.permissionSet), '| owner type:', d.owner?.type, '| isEnterpriseOwned', d.isEnterpriseOwned);
console.log('defaultWorkspace:', d.defaultWorkspace?.id, 'trash:', d.trash);
