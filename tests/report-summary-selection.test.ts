import assert from "node:assert/strict";
import OpenAI from "openai";
import {env} from "../src/config/env.js";
import {summarySegments,validateSummarySelection,selectSummaryHighlights} from "../src/services/reportSummary.service.js";
const segments=summarySegments("Jalan berlubang sedalam 5 cm. Hubungi test@example.com atau +628123456789. Pengendara menghindari titik ini.");
assert(!segments.join(' ').includes('test@example.com'));assert(!segments.join(' ').includes('628123456789'));
assert(segments.some(text=>text.includes('5 cm')));
assert.deepEqual(validateSummarySelection({indices:[2,0]},3),[0,2]);
for(const invalid of[{indices:[9]},{indices:[0,0]},{indices:[]},{indices:[0,1,2,3]},{indices:["0"]},{indices:[0],summary:"Invented fact"}])assert.throws(()=>validateSummarySelection(invalid,3));
const enabled=env.AI_SUMMARY_ENABLED;env.AI_SUMMARY_ENABLED=true;
let payload:any,finish="stop",refusal:string|null=null;
const client={chat:{completions:{create:async(input:unknown)=>{payload=input;return{choices:[{finish_reason:finish,message:{content:JSON.stringify({indices:[0,2]}),refusal}}]};}}}} as unknown as Pick<OpenAI,"chat">;
try{assert.deepEqual(await selectSummaryHighlights(segments,client),[0,2]);assert.equal(payload.max_completion_tokens,256);assert.equal(payload.store,false);assert.equal(typeof payload.messages[1].content,'string');assert(!JSON.stringify(payload).includes('test@example.com'));finish='length';await assert.rejects(selectSummaryHighlights(segments,client));finish='stop';refusal='Refused';await assert.rejects(selectSummaryHighlights(segments,client));env.AI_SUMMARY_ENABLED=false;await assert.rejects(selectSummaryHighlights(segments,client));}finally{env.AI_SUMMARY_ENABLED=enabled;}
console.log('PASS: redacted source segments, validated indices only, small text-only request, incomplete/refused/disabled outputs rejected. Mock OpenAI only.');
