import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {queueSummaryInput,validateQueuePatterns,redactSummaryText,summarizePatterns} from "../src/services/reportSummary.service.js";
import {env} from "../src/config/env.js";
const ids=[randomUUID(),randomUUID()];const sources=ids.map(id=>({id,condition:"Jalan tergenang."}));
assert(queueSummaryInput.safeParse({mode:"FILTER"}).success);
for(const raw of [{mode:"SELECTED"},{mode:"SELECTED",reportIds:[ids[0],ids[0]]},{mode:"SELECTED",reportIds:Array.from({length:26},randomUUID)},{mode:"FILTER",reportIds:ids}])assert(!queueSummaryInput.safeParse(raw).success);
assert(!redactSummaryText('test@example.com https://example.com +6281234567890').includes('test@example'));
assert.deepEqual(validateQueuePatterns({patterns:[]},sources),[]);
for(const reportIds of [[ids[0]],[ids[0],ids[0]],[ids[0],randomUUID()]])assert.throws(()=>validateQueuePatterns({patterns:[{text:"Genangan",reportIds}]},sources));
let payload:any;let finish="stop";const client:any={chat:{completions:{create:async(p:any)=>{payload=p;return {choices:[{finish_reason:finish,message:{content:JSON.stringify({patterns:[{text:"Dua laporan menyebut genangan.",reportIds:ids}]})}}]};}}}};
const enabled=env.AI_SUMMARY_ENABLED;env.AI_SUMMARY_ENABLED=true;
try{assert.equal((await summarizePatterns(sources,client)).length,1);assert.equal(payload.store,false);assert.equal(payload.max_completion_tokens,1200);assert.equal(typeof payload.messages[1].content,'string');finish='length';await assert.rejects(summarizePatterns(sources,client));env.AI_SUMMARY_ENABLED=false;await assert.rejects(summarizePatterns(sources,client));}finally{env.AI_SUMMARY_ENABLED=enabled;}
console.log('PASS queue scope limits, privacy redaction, source validation and mock-only structured AI.');
