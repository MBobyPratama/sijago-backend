import assert from "node:assert/strict";
import OpenAI from "openai";
import {env} from "../src/config/env.js";
import {createPhotoSafety, PhotoSafetyError} from "../src/services/photoSafety.service.js";
const image='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64');
let moderation=0,classifications=0,analyses=0,flagged=false,relevant=true,fail=false;
const client={moderations:{create:async()=>{moderation++;if(fail)throw Error('Provider unavailable');return {results:[{flagged,categories:{sexual:flagged,violence:false}}]};}},chat:{completions:{create:async(request:any)=>{classifications++;assert.equal(request.max_completion_tokens,256);assert.equal(request.messages[1].content[0].image_url.detail,'low');return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({relevant}),refusal:null}}]};}}}} as unknown as Pick<OpenAI,'moderations'|'chat'>;
const result={roadDamageVisible:true,category:'LUBANG' as const,sizeClass:null,condition:'Jalan berlubang.',uncertainty:'Ukuran tidak diketahui.'};
const factory=()=>createPhotoSafety(client,async()=>{analyses++;return result;});
flagged=true;await assert.rejects(factory().analyze(image),error=>error instanceof PhotoSafetyError&&error.code==='PHOTO_UNSAFE');assert.equal(classifications,0);assert.equal(analyses,0);
flagged=false;relevant=false;await assert.rejects(factory().analyze(image),error=>error instanceof PhotoSafetyError&&error.code==='PHOTO_NOT_RELEVANT');assert.equal(analyses,0);
relevant=true;const service=factory(),before=[moderation,classifications,analyses];await Promise.all([service.check(image),service.check(image)]);await service.analyze(image);await service.analyze(image);assert.deepEqual([moderation-before[0],classifications-before[1],analyses-before[2]],[1,1,1]);
const different='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,1,1,1,1]).toString('base64');await service.check(different);assert.equal(moderation-before[0],2);
fail=true;const retry=factory();await assert.rejects(retry.check(image));fail=false;await retry.check(image);
const prior=classifications;await factory().check(image,false);assert.equal(classifications,prior); // repaired/signoff evidence still moderated, without a damage requirement
await assert.rejects(service.check('https://untrusted.example/image.png'));
console.log('PASS: unsafe and irrelevant photos blocked before suggestions; fail-closed provider errors; single-flight cache and changed-content recheck; repaired photos still moderated. No live AI or database writes.');

const enabled=env.AI_PHOTO_ENABLED;env.AI_PHOTO_ENABLED=false;try{await assert.rejects(service.analyze(image));}finally{env.AI_PHOTO_ENABLED=enabled;}
console.log('PASS disabling photo assistance also rejects previously cached suggestions.');

for(const raw of [{relevant:true,unexpected:true},{relevant:"true"},{}]){
 const malformed={moderations:client.moderations,chat:{completions:{create:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]})}}} as unknown as Pick<OpenAI,'moderations'|'chat'>;
 await assert.rejects(createPhotoSafety(malformed).check(image));
}
console.log('PASS malformed/extra relevance output fails closed.');
