import assert from "node:assert/strict";
import {v2 as cloudinary} from "cloudinary";
import {env} from "../src/config/env.js";
import {loadEvidenceImage,PhotoSafetyError} from "../src/services/photoSafety.service.js";
const original={name:env.CLOUDINARY_CLOUD_NAME,key:env.CLOUDINARY_API_KEY,secret:env.CLOUDINARY_API_SECRET,resource:cloudinary.api.resource,fetch:globalThis.fetch};
let format='jpg',pages=1,calls=0;let bytes=Buffer.from([255,216,255,0,0,0,0,0,0,0,0,0]);let fetched='';
try{
 env.CLOUDINARY_CLOUD_NAME='test';env.CLOUDINARY_API_KEY='test';env.CLOUDINARY_API_SECRET='test';
 cloudinary.api.resource=(async()=>{calls++;return{resource_type:'image',format,pages,version:123};}) as any;
 globalThis.fetch=(async(url:any,options:any)=>{fetched=String(url);assert.equal(options.redirect,'error');return new Response(bytes);}) as any;
 const id=env.CLOUDINARY_UPLOAD_FOLDER+'/fixture';
 const result=await loadEvidenceImage(id);assert(fetched.includes('/v123/'));assert(result.url.includes('/v123/'));assert(fetched.includes('w_768'));assert(!result.url.includes('w_768'));assert(result.image.startsWith('data:image/jpeg;base64,'));
 const before=calls;await assert.rejects(loadEvidenceImage('untrusted/fixture'));await assert.rejects(loadEvidenceImage(env.CLOUDINARY_UPLOAD_FOLDER+'/../fixture'));assert.equal(calls,before);
 format='svg';await assert.rejects(loadEvidenceImage(id));format='jpg';pages=2;await assert.rejects(loadEvidenceImage(id));pages=1;
 bytes=Buffer.alloc(2_000_001);await assert.rejects(loadEvidenceImage(id),e=>e instanceof PhotoSafetyError&&e.code==='INVALID_PHOTO');
 bytes=Buffer.alloc(12);await assert.rejects(loadEvidenceImage(id));
 console.log('PASS trusted asset lookup, version pinning, bounded transformed bytes, full-resolution evidence URL, SVG/multipage/oversize/signature rejection. No network.');
}finally{env.CLOUDINARY_CLOUD_NAME=original.name;env.CLOUDINARY_API_KEY=original.key;env.CLOUDINARY_API_SECRET=original.secret;cloudinary.api.resource=original.resource;globalThis.fetch=original.fetch;}
