import { db } from "./db/index.js";
import { reportPhotos } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { PhotoSafetyError, loadEvidenceImage } from "./services/photoSafety.service.js";
import { analyzeSafePhoto } from "./services/photoSafety.service.js";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireTrustedOrigin } from "./auth.js";
import { analyzeDamagePhoto, photoAnalysisFailure, photoAnalysisInput, validatePhotoImage } from "./services/photoAnalysis.service.js";

export function createPhotoAnalysisRouter(analyze = analyzeSafePhoto) {
 const router = Router();
 router.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
 router.post("/analyze-photo", requireTrustedOrigin, rateLimit({windowMs:60*1000,max:30,standardHeaders:true,legacyHeaders:false,message:{success:false,error:{code:"AI_BURST_LIMIT",detail:"Terlalu banyak percobaan dalam satu menit. Tunggu sebentar sebelum mencoba lagi."}}}), rateLimit({windowMs:15*60*1000,max:5,skipFailedRequests:true,standardHeaders:true,legacyHeaders:false,message:{success:false,error:{code:"AI_RATE_LIMIT",detail:"Batas analisis foto tercapai. Coba lagi dalam 15 menit atau isi secara manual."}}}), async(req,res)=>{
  const parsed=photoAnalysisInput.safeParse(req.body);
  if(!parsed.success){res.status(400).json({success:false,error:{code:"INVALID_PHOTO",detail:"Kirim satu foto JPG, PNG, atau WebP, maksimal 2 MB."}});return;}
  let image:string;
  try{
    if("photoId" in parsed.data){
      const [photo]=await db.select().from(reportPhotos).where(eq(reportPhotos.id,parsed.data.photoId)).limit(1);
      if(!photo||!["REPORT","BEFORE"].includes(photo.kind))throw new Error("Foto laporan tidak ditemukan.");
      image=(await loadEvidenceImage(photo.cloudinaryPublicId)).image;
    }else image=validatePhotoImage(parsed.data.image);
  }catch(error){res.status(400).json({success:false,error:{code:"INVALID_PHOTO",detail:error instanceof Error?error.message:"Foto tidak valid."}});return;}
  try{const data=await analyze(image);res.setHeader("Cache-Control","no-store");res.json({success:true,data});}
  catch(error){const failure=photoAnalysisFailure(error);console.error("[photo-analysis]",{code:failure.code,status:(error as {status?:number})?.status});res.status(error instanceof PhotoSafetyError ? error.status : 503).json({success:false,error:failure});}
 });
 return router;
}
