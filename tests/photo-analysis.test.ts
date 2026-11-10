import assert from "node:assert/strict";
import OpenAI from "openai";
import express from "express";
import { env } from "../src/config/env.js";
import { analyzeDamagePhoto, photoSuggestion, validatePhotoImage, photoAnalysisFailure } from "../src/services/photoAnalysis.service.js";
import { createPhotoAnalysisRouter } from "../src/photo-analysis.js";
const image="data:image/png;base64,"+Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString("base64");
const valid={roadDamageVisible:true,category:"LUBANG",sizeClass:null,condition:"Permukaan jalan terlihat berlubang.",uncertainty:"Tidak ada pembanding skala; ukuran perlu diperiksa warga."};
assert.equal(validatePhotoImage(image),image);
for(const invalid of["https://example.com/photo.jpg","data:image/svg+xml;base64,PHN2Zz4=",image.replace("png","jpeg"),"data:image/png;base64,invalid",image+"!"])assert.throws(()=>validatePhotoImage(invalid));
assert.throws(()=>photoSuggestion.parse({...valid,category:"RUSAK_BERAT"}));
assert.throws(()=>photoSuggestion.parse({...valid,condition:"x".repeat(1001)}));
assert.throws(()=>photoSuggestion.parse({...valid,roadDamageVisible:false}));
assert.equal(photoAnalysisFailure({status:401,code:'invalid_api_key'}).code,'AI_CONFIG_ERROR');
assert.equal(photoAnalysisFailure({status:429,code:'insufficient_quota'}).code,'AI_QUOTA_EXHAUSTED');
assert.equal(photoAnalysisFailure({status:404}).code,'AI_MODEL_UNAVAILABLE');
const original=env.AI_PHOTO_ENABLED;env.AI_PHOTO_ENABLED=true;
let calls=0,payload:any;
const mock=(content:string,finish="stop",refusal:string|null=null)=>({chat:{completions:{create:async(input:unknown)=>{calls++;payload=input;return {choices:[{finish_reason:finish,message:{content,refusal}}]};}}}} as unknown as Pick<OpenAI,"chat">);
try{
 assert.deepEqual(await analyzeDamagePhoto(image,mock(JSON.stringify(valid))),valid);
 assert.equal(payload.store,false);assert.equal(payload.messages[1].content[1].image_url.url,image);assert.equal(payload.response_format.json_schema.strict,true);
 await assert.rejects(analyzeDamagePhoto(image,mock("not JSON")));
 await assert.rejects(analyzeDamagePhoto(image,mock(JSON.stringify(valid),"length")));
 await assert.rejects(analyzeDamagePhoto(image,mock("","stop","Cannot analyze")));
 const irrelevant={roadDamageVisible:false,category:null,sizeClass:null,condition:"",uncertainty:"Kerusakan jalan tidak terlihat."};
 assert.deepEqual(await analyzeDamagePhoto(image,mock(JSON.stringify(irrelevant))),irrelevant);
 env.AI_PHOTO_ENABLED=false;const before=calls;await assert.rejects(analyzeDamagePhoto(image,mock(JSON.stringify(valid))));assert.equal(calls,before);
}finally{env.AI_PHOTO_ENABLED=original;}
const app=express();app.use(express.json());let analyses=0,fail=false;app.use('/ai',createPhotoAnalysisRouter(async()=>{if(fail)throw {status:401,code:'invalid_api_key'};analyses++;return valid as any;}));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',()=>r()));
try{
 const address=server.address() as {port:number};const url=`http://127.0.0.1:${address.port}/ai/analyze-photo`;
 const post=(body:unknown,origin=env.FRONTEND_URL)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
 assert.equal((await post({image},'https://untrusted.example')).status,403);
 assert.equal((await post({image:'https://example.com/test.png'})).status,400);
 fail=true;for(let i=0;i<6;i++){const response=await post({image});assert.equal(response.status,503);assert.equal((await response.json()).error.code,'AI_CONFIG_ERROR');}fail=false;
 for(let i=0;i<5;i++){const response=await post({image});assert.equal(response.status,200);assert.deepEqual((await response.json()).data,valid);}
 assert.equal((await post({image})).status,429);assert.equal(analyses,5);
}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
console.log("PASS: image validation, strict suggestions, uncertain size, irrelevant photo, disabled/refused/incomplete responses, trusted origins and rate limits. Mock OpenAI only; no billable API calls or database writes.");
