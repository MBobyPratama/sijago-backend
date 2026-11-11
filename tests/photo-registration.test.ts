import assert from "node:assert/strict";
import {registerUploadedPhoto} from "../src/services/cloudinary.service.js";
import {PhotoSafetyError} from "../src/services/photoSafety.service.js";
let inserts=0,values:any;
const database={insert:()=>{inserts++;return{values:(v:any)=>{values=v;return{returning:async()=>[{id:"test",...v}]};}};}} as any;
const params={cloudinaryPublicId:"sijago-mia2026/test",originalSecureUrl:"https://untrusted.test/image",uploadedByActor:"test"};
for(const code of ["PHOTO_UNSAFE","PHOTO_NOT_RELEVANT","PHOTO_CHECK_UNAVAILABLE"]){await assert.rejects(registerUploadedPhoto(params,{database,checkPhoto:async()=>{throw new PhotoSafetyError(code,"blocked");}}));assert.equal(inserts,0);}
for(const kind of ["REPORT","BEFORE","AFTER","SIGNOFF"] as const){const photo=await registerUploadedPhoto({...params,kind},{database,checkPhoto:async(id,road)=>{assert.equal(id,params.cloudinaryPublicId);assert.equal(road,kind==='REPORT'||kind==='BEFORE');return "https://trusted.test/checked";}});assert.equal(photo.publicUrl,"https://trusted.test/checked");assert.equal(values.originalSecureUrl,"https://trusted.test/checked");}
console.log('PASS registration fails closed before database insert; REPORT/BEFORE require relevance; AFTER/SIGNOFF require safety; browser URL never trusted.');
