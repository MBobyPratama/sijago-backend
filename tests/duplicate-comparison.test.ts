import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { env } from "../src/config/env.js";
import { compareDuplicateEvidence, validateDuplicateVerdicts, redactComparisonText, type DuplicateEvidence } from "../src/services/duplicateSuggestions.service.js";
const source:DuplicateEvidence={id:randomUUID(),ticketCode:"SOURCE",title:"Tidak dikirim",status:"MENUNGGU_VERIFIKASI",distanceMeters:0,category:"LUBANG",condition:"Hubungi test@example.com di +628123456789",observedAt:null,submittedAt:null,image:"data:image/png;base64,test",photoUrl:"https://private.example/photo"};
const candidate={...source,id:randomUUID(),ticketCode:"PARENT",distanceMeters:20};
const valid={results:[{id:candidate.id,match:"POSSIBLE",reason:"Sudut foto berbeda; perlu diperiksa admin."}]};
assert.equal(validateDuplicateVerdicts(valid,[candidate.id])[0].match,"POSSIBLE");
for(const raw of[{results:[]},{results:[{...valid.results[0],id:randomUUID()}]},{results:[...valid.results,...valid.results]},{results:[{...valid.results[0],match:"99%"}]},{results:[{...valid.results[0],reason:"x".repeat(221)}]}])assert.throws(()=>validateDuplicateVerdicts(raw,[candidate.id]));
assert(!redactComparisonText(source.condition).includes("test@example.com"));
let calls=0,payload:any,finish="stop";
const client={chat:{completions:{create:async(input:unknown)=>{calls++;payload=input;return{choices:[{finish_reason:finish,message:{content:JSON.stringify(valid),refusal:null}}]};}}}} as unknown as Pick<OpenAI,"chat">;
const before=env.AI_DUPLICATE_ENABLED;env.AI_DUPLICATE_ENABLED=true;
try{
 await compareDuplicateEvidence(source,[candidate],client);
 assert.equal(payload.max_completion_tokens,900);assert.equal(payload.store,false);
 const serialized=JSON.stringify(payload);assert(!serialized.includes("test@example.com"));assert(!serialized.includes("private.example"));assert(!serialized.includes("PARENT"));
 assert.equal(payload.messages[1].content.filter((part:any)=>part.type==="image_url").length,2);
 assert(payload.messages[1].content.filter((part:any)=>part.type==="image_url").every((part:any)=>part.image_url.detail==="low"));
 assert.deepEqual(await compareDuplicateEvidence(source,[],client),[]);assert.equal(calls,1);
 finish="length";await assert.rejects(compareDuplicateEvidence(source,[candidate],client));
 env.AI_DUPLICATE_ENABLED=false;await assert.rejects(compareDuplicateEvidence(source,[candidate],client));
}finally{env.AI_DUPLICATE_ENABLED=before;}
console.log("PASS: bounded multimodal comparison, no-call empty case, redacted minimal input, strict candidate IDs, malformed/incomplete and disabled responses. Mock OpenAI only.");
