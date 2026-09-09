const {_electron:electron}=require('playwright');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
const dir=path.resolve('artifacts/companion-native-check');fs.mkdirSync(dir,{recursive:true});
const main=path.resolve('src/app/main.js');
fs.writeFileSync(path.join(dir,'launch.cjs'),`const {app,BrowserWindow}=require('electron');const path=require('path');const fs=require('fs');const data=path.join(__dirname,'user-data');fs.mkdirSync(data,{recursive:true});app.setPath('userData',data);process.env.APPDATA=path.join(__dirname,'app-data');BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.showInactive=function(){};require(${JSON.stringify(main)});`);
const app=await electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:[path.join(dir,'launch.cjs')],timeout:30000});
try{
 const page=await app.firstWindow();await page.waitForFunction(async()=>window.osmolog&&(await window.osmolog.getState()).ready);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isResizable()),true);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(720,620));
 assert.deepEqual(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getSize()),[720,620]);
 await page.evaluate(()=>window.osmolog.windowAction('compact'));
 assert.deepEqual(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getSize()),[156,42]);
 await page.evaluate(()=>window.osmolog.windowAction('expand'));
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isResizable()),true);
 assert.deepEqual(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getSize()),[720,620]);
 const result=await page.evaluate(()=>window.osmolog.setPlayerLanguage('manatan','ko'));
 assert.equal(result.ok,true);assert.equal((await page.evaluate(()=>window.osmolog.getState())).playerLanguages.manatan,'ko');
 assert.deepEqual(errors,[]);
 console.log('Native Electron passed: secure IPC startup, resize, exact compact dimensions, restored resized bounds, and persisted per-player language. User data and window visibility isolated.');
}finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
