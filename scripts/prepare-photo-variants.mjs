// Offline-only preparation. No credentials, network, upload or source overwrite.
// Safe repeat runs verify/skip identical outputs; originals are always read-only.
// node scripts/prepare-photo-variants.mjs manifest.json originals/ new-output/ [--write]
// Manifest: [{"image_id":"uuid","storage_path":"seller/lot/image.png"}]
import {readFile,writeFile,mkdir,stat,lstat,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const [manifestFile,originalsFolder,outFolder,...flags]=process.argv.slice(2);
if(!manifestFile||!originalsFolder||!outFolder||flags.some(flag=>flag!=='--write'))throw new Error('Usage: node scripts/prepare-photo-variants.mjs manifest.json originals/ NEW-output/ [--write]');
const originalRoot=resolve(originalsFolder),outputRoot=resolve(outFolder),write=flags.includes('--write');
const inside=(root,path)=>{if(typeof path!=='string'||isAbsolute(path)||path.includes('\\')||path.includes('\0'))throw new Error('Invalid object path');const target=resolve(root,path),rel=relative(root,target);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('Path escapes selected folder');return target;};
const manifest=JSON.parse(await readFile(manifestFile,'utf8'));if(!Array.isArray(manifest))throw new Error('Manifest must be an array');
const seen=new Set();for(const row of manifest){if(!/^[0-9a-f-]{36}$/i.test(row.image_id)||seen.has(row.storage_path))throw new Error('Invalid or duplicate manifest entry');seen.add(row.storage_path);inside(originalRoot,row.storage_path);inside(outputRoot,row.storage_path);}
const overlap=relative(originalRoot,outputRoot);
if(!overlap||(!overlap.startsWith('..')&&!isAbsolute(overlap)))throw new Error('Output must be outside the original folder');
if(write){await mkdir(outputRoot,{recursive:true});if((await lstat(outputRoot)).isSymbolicLink())throw new Error('Output cannot be a symlink');}
const canonicalOutput=write?await realpath(outputRoot):outputRoot;
async function writeOrVerify(target,bytes){
 await mkdir(dirname(target),{recursive:true});
 const parent=await realpath(dirname(target)),rel=relative(canonicalOutput,parent);
 if(rel.startsWith('..')||isAbsolute(rel))throw new Error('Output parent escapes selected folder');
 try{await writeFile(target,bytes,{flag:'wx'});return 'created';}
 catch(error){if(error.code!=='EEXIST')throw error;}
 const existing=await lstat(target);
 if(!existing.isFile()||existing.isSymbolicLink()||!(await readFile(target)).equals(Buffer.from(bytes)))throw new Error('Existing output differs; refusing overwrite: '+target);
 return 'verified existing';
}
const result=[];
for(const row of manifest){const source=inside(originalRoot,row.storage_path);const info=await stat(source);if(!info.isFile()||info.size>5242880)throw new Error('Unexpected original size');
 const bytes=await readFile(source);const originalSha256=createHash('sha256').update(bytes).digest('hex');const variants=[];
 for(const [kind,edge,quality] of [['thumb',400,78],['display',1600,86]]){
  const path=row.storage_path+'.'+kind+'.webp';const {data,info:encoded}=await sharp(bytes,{limitInputPixels:40000000}).rotate().resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).webp({quality}).toBuffer({resolveWithObject:true});
  if(data.length>5242880)throw new Error('Variant exceeds bucket limit');
  if(write)await writeOrVerify(inside(outputRoot,path),data);
  variants.push({path,bytes:data.length,width:encoded.width,height:encoded.height,sha256:createHash('sha256').update(data).digest('hex')});
 }
 result.push({...row,original_bytes:bytes.length,original_sha256:originalSha256,variants});
}
if(write)await writeOrVerify(resolve(outputRoot,'review-manifest.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({mode:write?'local files prepared':'dry run; no files written',images:result},null,2));
