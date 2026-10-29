import { listenForTests } from './helpers/http-server.mjs';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.js';
const dataDir=await mkdtemp(path.join(tmpdir(),'aman-tobi-cancel-'));
let started=false,aborted=false;
const server=await createApp({dataDir,tobiOptions:{apiKey:'test-only-no-real-request',aiFetch:async(_url,{signal})=>new Promise((_resolve,reject)=>{started=true;signal.addEventListener('abort',()=>{aborted=true;reject(new Error('Cancelled test request'));},{once:true});})}});
await listenForTests(server);const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true,args:[`--explicitly-allowed-ports=${server.address().port}`]});
try{
 const context=await browser.newContext();await context.addInitScript(()=>localStorage.setItem('aman-language','en'));
 const api=context.request;
 assert.equal((await api.post(base+'/api/auth/signup',{data:{name:'Test Owner',email:'cancel@example.test',password:'long cancellation test password'}})).status(),201);
 const code=(await readFile(path.join(dataDir,'tobi-owner-code.txt'),'utf8')).trim();
 assert.equal((await api.post(base+'/api/tobi/claim',{data:{code}})).status(),200);
 const state=await (await api.get(base+'/api/tobi/config')).json();state.config.openAIEnabled=true;
 assert.equal((await api.put(base+'/api/tobi/admin',{data:{config:state.config,revision:state.revision}})).status(),200);
 const page=await context.newPage();await page.goto(base+'/tobi.html#chat');
 await page.locator('#chat-input').fill('Explain the rings around Saturn.');await page.locator('#chat-input').press('Enter');
 await page.locator('.typing').waitFor();
 const deadline=Date.now()+5000;while(!started&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));assert.equal(started,true);
 await page.locator('.mission-nav').getByRole('button',{name:'Mission home',exact:true}).click();
 assert.equal(await page.locator('.mission-card').count(),4);
 const cancelDeadline=Date.now()+5000;while(!aborted&&Date.now()<cancelDeadline)await new Promise(r=>setTimeout(r,20));assert.equal(aborted,true,'Home cancels the upstream request too');
 await page.locator('.mission-nav').getByRole('button',{name:'Talk to Tobi',exact:true}).click();assert.equal(await page.locator('.typing').count(),0);assert.equal(await page.locator('#chat-input').isEnabled(),true);
 await page.locator('#chat-input').fill('What is your name?');await page.locator('#chat-input').press('Enter');await page.locator('.bubble').filter({hasText:'I’m Tobi! Your digital-safety buddy.'}).waitFor();
 console.log('PASS: real mouse navigation cancels a pending simulated AI request; all Home buttons and the next chat remain usable.');
 // Simulate cancellation while the config response body is still downloading.
 // Fetch headers have arrived, but response.json rejects with AbortError on Stop.
 await page.evaluate(()=>{
  const originalFetch=window.fetch;
  window.delayedConfigBody=false;
  window.fetch=async(url,options)=>{
   const response=await originalFetch(url,options);
   if(url==='/api/tobi/config'&&options.signal){
    response.json=()=>new Promise((_resolve,reject)=>{
     window.delayedConfigBody=true;
     const abort=()=>reject(new DOMException('Test download cancelled','AbortError'));
     if(options.signal.aborted)abort();else options.signal.addEventListener('abort',abort,{once:true});
    });
   }
   return response;
  };
  window.restoreFetch=()=>{window.fetch=originalFetch;};
 });
 await page.locator('#chat-input').fill('Explain the ocean currents.');
 await page.locator('#chat-input').press('Enter');
 await page.waitForFunction(()=>window.delayedConfigBody);
 await page.locator('[data-action=stop-chat]').click();
 await page.evaluate(()=>{window.restoreFetch();});
 await page.locator('.mission-nav').getByRole('button',{name:'Mission home',exact:true}).click();
 assert.equal(await page.getByText(/Server unavailable/).count(),0,'Stopping a config download does not mark the server offline');
 await page.locator('.mission-nav').getByRole('button',{name:'Talk to Tobi',exact:true}).click();
 assert.equal(await page.locator('#chat-input').isEnabled(),true);
 console.log('PASS: cancelling a config response body keeps the server connected and chat usable.');
}finally{await browser.close();await new Promise(r=>server.close(r));assert.ok(path.resolve(dataDir).startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(dataDir).startsWith('aman-tobi-cancel-'));await rm(dataDir,{recursive:true,force:true});}
