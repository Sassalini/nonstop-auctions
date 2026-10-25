import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
test('offline variants are dry-run by default, never overwrite originals, and reject path traversal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'nonstop-photo-test-'));
 try{const originals=join(root,'originals');await mkdir(originals);const bytes=await readFile('public/images/auction-house-background.png');await writeFile(join(originals,'photo.png'),bytes);
 const manifest=join(root,'input.json'),out=join(root,'output');await writeFile(manifest,JSON.stringify([{image_id:'20000000-0000-0000-0000-000000000701',storage_path:'photo.png'}]));
 const run=(...args)=>spawnSync(process.execPath,['scripts/prepare-photo-variants.mjs',manifest,originals,out,...args],{encoding:'utf8'});
 assert.equal(run().status,0);await assert.rejects(stat(out));assert.equal(run('--write').status,0);
 assert.deepEqual(await readFile(join(originals,'photo.png')),bytes);
 assert.equal((await sharp(await readFile(join(out,'photo.png.thumb.webp'))).metadata()).width,400);
 assert.equal(run('--write').status,0);
 await writeFile(join(out,'photo.png.thumb.webp'),'mismatched');assert.notEqual(run('--write').status,0);
 await writeFile(manifest,JSON.stringify([{image_id:'20000000-0000-0000-0000-000000000701',storage_path:'../escape.png'}]));assert.notEqual(run().status,0);
 }finally{const checked=resolve(root);assert.ok(checked.startsWith(resolve(tmpdir())+requireSeparator()));assert.ok(checked.includes('nonstop-photo-test-'));await rm(checked,{recursive:true,force:true});}
});
function requireSeparator(){return process.platform==='win32'?'\\':'/';}
