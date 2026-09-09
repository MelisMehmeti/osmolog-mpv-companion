"use strict";
const test=require('node:test');const assert=require('node:assert/strict');
const {normalize}=require('../src/config');const {desktopPatch,createDesktopSettings,shouldOpenForPlayer,loginOptions}=require('../src/app/desktop-settings');
test('legacy MPV launcher migrates without enabling Windows startup or other players',()=>{
  const c=normalize({runOnlyWithMpv:true,defaultLanguage:'ja'});assert.equal(c.desktop.openWith.mpv,true);assert.equal(c.desktop.startWithWindows,false);assert.equal(c.desktop.openWith.steam,false);
});
test('enabling Windows startup enables all player launch defaults and allows later overrides',()=>{
  const previous=normalize({}).desktop;const enabled=desktopPatch(previous,{startWithWindows:true});
  assert.deepEqual(enabled.openWith,{mpv:true,steam:true,manatan:true});
  assert.equal(desktopPatch(enabled,{openWith:{steam:false}}).openWith.steam,false);
  assert.throws(()=>desktopPatch(previous,{openWith:{other:true}}));assert.throws(()=>desktopPatch(previous,{startWithWindows:'yes'}));
});
test('login settings use stable portable executable and startup argument',()=>{
  const settings=loginOptions({isPackaged:true},{PORTABLE_EXECUTABLE_FILE:'C:\\Tools\\Companion.exe'});
  assert.equal(settings.path,'C:\\Tools\\Companion.exe');assert.deepEqual(settings.args,['--startup']);
});
test('OS startup failure rolls back launcher and does not persist enabled state',()=>{
  const calls=[];const service={config:{desktop:normalize({}).desktop},configStore:{update(){throw Error('must not save');}}};
  const app={isPackaged:true,setLoginItemSettings:s=>calls.push(s.openAtLogin),getLoginItemSettings:()=>({openAtLogin:false})};
  const settings=createDesktopSettings({app,service,platform:'win32',setMpvStartup:on=>{calls.push('mpv:'+on);return {ok:true};}});
  assert.equal(settings.configure({startWithWindows:true}).ok,false);assert.deepEqual(calls,['mpv:true',true,false,'mpv:false']);assert.equal(service.config.desktop.startWithWindows,false);
});
test('player detection opens once, never every timer tick or disabled preference',()=>{
  const connected={players:{steam:{connected:true}}};const desktop={openWith:{steam:true}};
  assert.equal(shouldOpenForPlayer({},connected,desktop),true);assert.equal(shouldOpenForPlayer(connected,connected,desktop),false);assert.equal(shouldOpenForPlayer({},connected,{}),false);
});

test('successful startup configuration persists independent controls and disabling removes login entry',()=>{
  let login=false;const service={config:{desktop:normalize({}).desktop},configStore:{update:patch=>({...service.config,...patch})},publish(){}};
  const app={isPackaged:true,setLoginItemSettings:s=>{login=s.openAtLogin;},getLoginItemSettings:()=>({openAtLogin:login,executableWillLaunchAtLogin:login})};
  const settings=createDesktopSettings({app,service,platform:'win32',setMpvStartup:()=>({ok:true})});
  assert.equal(settings.configure({startWithWindows:true}).ok,true);assert.equal(service.config.desktop.openWith.manatan,true);
  assert.equal(settings.configure({openWith:{steam:false}}).ok,true);assert.equal(service.config.desktop.openWith.mpv,true);
  assert.equal(settings.configure({startWithWindows:false}).ok,true);assert.equal(login,false);assert.equal(service.config.desktop.openWith.steam,false);
});
