const { chromium }=require('playwright');const {pathToFileURL}=require('node:url');const path=require('node:path');const fs=require('node:fs');const assert=require('node:assert/strict');const {executablePath}={executablePath:()=>process.env.OSMOLOG_TEST_BROWSER||chromium.executablePath()};
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:executablePath()});
try{
const page=await browser.newPage({viewport:{width:640,height:560}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
const s={ready:true,extensionConnected:true,appVersion:'1.2.5',fileLoaded:true,player:'steam',sessionId:'steam-session',title:'Persona 5 Royal',languageCode:'ja',defaultLanguage:'ja',sessionSeconds:2538,sessionActiveSeconds:2110,sessionPassiveSeconds:428,todaySeconds:5040,desktop:{startWithWindows:false,startMinimized:false,keepInTray:true,openWith:{mpv:true,steam:false,manatan:false}},playerLanguages:{},updateStatus:{state:'current'},players:{mpv:{connected:true},manatan:{connected:false},steam:{connected:true,playing:true,mode:'active',sessionId:'steam-session',manualPaused:false}},steam:{enabled:true,appId:'1687950',title:'Persona 5 Royal',sessionId:'steam-session',idleThresholdSeconds:300}};
const listeners=[];const publish=()=>listeners.forEach(f=>f(structuredClone(s)));window.fixture=s;window.publish=publish;
window.osmolog={getState:async()=>structuredClone(s),onState:f=>listeners.push(f),onWindowMode:()=>{},windowAction:()=>{},configureDesktop:async patch=>{Object.assign(s.desktop,patch);if(patch.startWithWindows)s.desktop.openWith={mpv:true,steam:true,manatan:true};publish();return {ok:true};},setTrackingPaused:async(p,paused,id)=>{if(id!==s.sessionId)throw Error('wrong session');Object.assign(s.players[p],{manualPaused:paused,playing:!paused});publish();return {ok:true};},setPlayerLanguage:async(p,code)=>{s.playerLanguages[p]=code;publish();return {ok:true};},configureSteam:async()=>({ok:true}),setupMpv:async()=>({ok:true,message:'MPV configured.'}),syncNow:async()=>({ok:true,message:'Synced.'}),checkForUpdates:async()=>({ok:true}),restartForUpdate:async()=>({ok:true}),openDashboard:async()=>true,startPairing:async()=>({})};
});
await page.goto(pathToFileURL(path.resolve('src/app/index.html')).href);
await page.locator('#mediaTitle').waitFor();
assert.equal(await page.locator('#connectionBanner').isVisible(),false);
assert.equal(await page.locator('#steamConnection').innerText(),'Now tracking');
await page.locator('#pauseButton').click();assert.match(await page.locator('#activityCircle').getAttribute('class'),/stopped/);
await page.locator('#pauseButton').click();
await page.evaluate(()=>{fixture.players.steam.mode='passive';publish();});assert.match(await page.locator('#activityCircle').getAttribute('class'),/passive/);
const out=path.resolve('artifacts/companion-1.2.5-ui');fs.mkdirSync(out,{recursive:true});
await page.mouse.move(1,1);await page.screenshot({animations:'disabled',path:path.join(out,'session.png')});
const overflows=[];
assert.equal(await page.locator('#todayLanguage').innerText(),'Japanese');
assert.equal(await page.locator('#todayTime').innerText(),'1h 24m');
assert.equal(await page.locator('.app-version-footer').innerText(),'Companion v1.2.5');
assert.equal(await page.locator('.today-panel progress').count(),0);
const sessionSize=await page.locator('.window-body').evaluate(el=>({client:el.clientHeight,scroll:el.scrollHeight}));
if(sessionSize.scroll>sessionSize.client+1)overflows.push({screen:'session',...sessionSize});
await page.evaluate(()=>{window.osmolog.syncNow=async()=>({ok:false,message:'Connection interrupted.'});});
await page.locator('#syncNow').click();
assert.equal(await page.locator('#feedback').innerText(),'Connection interrupted.');
assert.doesNotMatch(await page.locator('#lastSyncStatus').innerText(),/Last synced/);
await page.evaluate(()=>{window.osmolog.syncNow=()=>new Promise(resolve=>{window.finishSync=resolve;});});
await page.locator('#syncNow').click();
assert.equal(await page.locator('#syncNow').isDisabled(),true);
assert.equal(await page.locator('#syncNow').innerText(),'Syncing…');
assert.equal(await page.locator('#pauseButton').isDisabled(),false,'sync must not block tracking controls');
await page.evaluate(()=>publish());
assert.equal(await page.locator('#syncNow').isDisabled(),true);
await page.evaluate(()=>finishSync({ok:true}));
await page.waitForFunction(()=>document.querySelector('#syncNow').disabled===false);
assert.equal(await page.locator('#lastSyncStatus').innerText(),'Last synced just now');

for(const screen of ['general','mpv','steam','manatan']){
 await page.locator('#settingsButton').click();if(screen!=='general')await page.locator(`.settings-tabs [data-page="${screen}"]`).click();
 if(screen==='general'){await page.locator('#startWithWindows').check();assert.deepEqual(await page.evaluate(()=>fixture.desktop.openWith),{mpv:true,steam:true,manatan:true});}
 if(screen==='mpv'){await page.locator('#playerLanguage').selectOption('ko');assert.equal(await page.evaluate(()=>fixture.playerLanguages.mpv),'ko');}
 await page.mouse.move(1,1);await page.screenshot({animations:'disabled',path:path.join(out,screen+'.png')});
 const size=await page.locator('.window-body').evaluate(el=>({client:el.clientHeight,scroll:el.scrollHeight}));if(size.scroll>size.client+1)overflows.push({screen,...size});
}
await page.locator('[data-page="home"]').click();await page.evaluate(()=>{fixture.fileLoaded=false;fixture.players.steam.playing=false;fixture.players.steam.connected=false;fixture.players.mpv.connected=false;publish();});await page.mouse.move(1,1);await page.screenshot({animations:'disabled',path:path.join(out,'idle.png')});
assert.equal(await page.locator('.idle-state img').count(),0);
assert.equal(await page.locator('.idle-state svg').count(),1);
assert.equal(await page.locator('#steamConnection').innerText(),'Idle');
assert.equal(await page.locator('#todayLanguage').innerText(),'Japanese');
await page.evaluate(()=>{fixture.updateStatus={state:'ready',version:'1.2.6'};publish();});assert.equal(await page.locator('#restartUpdateButton').isVisible(),true);await page.mouse.move(1,1);await page.screenshot({animations:'disabled',path:path.join(out,'update.png')});
await page.locator('#settingsButton').click();
assert.equal(await page.locator('#updateBanner').isVisible(),false);
assert.equal(await page.locator('#settingsRestartUpdate').isVisible(),true);
for(const status of ['checking','downloading','error','current']){
 await page.evaluate(status=>{fixture.updateStatus={state:status,percent:42};publish();},status);
 assert.equal(await page.locator('#checkUpdates').isDisabled(),['checking','downloading'].includes(status));
 if(status==='error')assert.match(await page.locator('#settingsUpdateDot').getAttribute('class'),/error/);
}
await page.locator('.settings-tabs [data-page="manatan"]').focus();await page.keyboard.press('Enter');
assert.equal(await page.locator('.settings-tabs .selected').innerText(),'Manatan');
assert.equal(await page.locator('.settings-tabs .selected').evaluate(el=>el===document.activeElement),true);
for(const viewport of [{width:520,height:520},{width:800,height:700}]){
 await page.setViewportSize(viewport);
 for(const screen of ['home','general','mpv','steam','manatan']){
  if(screen==='home')await page.locator('[data-page="home"]').click();
  else {await page.locator('#settingsButton').click();if(screen!=='general')await page.locator(`.settings-tabs [data-page="${screen}"]`).click();}
  const clipped=await page.evaluate(()=>[...document.querySelectorAll('.setting-row select,.setting-row button,.settings-tabs button,.connection')].filter(el=>el.getClientRects().length).some(el=>{const b=el.getBoundingClientRect();return b.left<0||b.right>innerWidth;}));
  assert.equal(clipped,false,`${screen} controls fit at ${viewport.width}px`);
 }
}
await page.evaluate(()=>{fixture.extensionConnected=false;publish();});assert.equal(await page.locator('#connectionBanner').isVisible(),true);
assert.deepEqual(errors,[]);assert.deepEqual(overflows,[],'default window must fit all settings pages');
console.log('Passed: session states, connected/disconnected UI, all settings pages, startup defaults, language control, updates; no default-size scrolling or runtime errors.');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
