import { JoseKey } from '@atproto/oauth-client-node';

const key = await JoseKey.generate(['ES256'], Date.now().toString());

console.log(JSON.stringify(key.privateJwk));
