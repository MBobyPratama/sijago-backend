import assert from "node:assert/strict";
import { linkReportPhotos } from "../src/services/report.service.js";
const id="00000000-0000-4000-8000-000000000001";
let updated=false,checked=false;
const tx={select:()=>({from:()=>({where:async()=>[{id,cloudinaryPublicId:"sijago-mia2026/test"}]})}),update:()=>{updated=true;return{set:()=>({where:()=>({returning:async()=>[{id}]})})}}} as unknown as Parameters<typeof linkReportPhotos>[0];
await assert.rejects(linkReportPhotos(tx,id,[id],async()=>{checked=true;throw new Error("PHOTO_UNSAFE");}));assert.equal(checked,true);assert.equal(updated,false);
await linkReportPhotos(tx,id,[id],async(publicId,requireRoad)=>{assert.equal(publicId,"sijago-mia2026/test");assert.equal(requireRoad,true);return "https://example.test/safe";});assert.equal(updated,true);
console.log("PASS: evidence cannot be attached to manual report facts before the server safety check passes. No network/database writes.");
