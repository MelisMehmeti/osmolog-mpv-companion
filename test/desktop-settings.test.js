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
  const app={isPackaged:true,setLoginItemSettings:s=>calls.push(s.openAtLogin),getLoginItemSettings:()=>({openAtLogin:false,launchItems:[]})};
  const settings=createDesktopSettings({app,service,platform:'win32',setMpvStartup:on=>{calls.push('mpv:'+on);return {ok:true};}});
  assert.equal(settings.configure({startWithWindows:true}).ok,false);assert.deepEqual(calls,['mpv:true',true,false,'mpv:false']);assert.equal(service.config.desktop.startWithWindows,false);
});
test('player detection opens once, never every timer tick or disabled preference',()=>{
  const connected={players:{steam:{connected:true}}};const desktop={openWith:{steam:true}};
  assert.equal(shouldOpenForPlayer({},connected,desktop),true);assert.equal(shouldOpenForPlayer(connected,connected,desktop),false);assert.equal(shouldOpenForPlayer({},connected,{}),false);
});

test('successful startup configuration persists independent controls and disabling removes login entry',()=>{
  let login=false;const service={config:{desktop:normalize({}).desktop},configStore:{update:patch=>({...service.config,...patch})},publish(){}};
  const app={isPackaged:true,setLoginItemSettings:s=>{login=s.openAtLogin;},getLoginItemSettings:()=>({openAtLogin:false,executableWillLaunchAtLogin:login,launchItems:login?[{name:'Osmolog Companion',scope:'user',enabled:true}]:[]})};
  const settings=createDesktopSettings({app,service,platform:'win32',setMpvStartup:()=>({ok:true})});
  assert.equal(settings.configure({startWithWindows:true}).ok,true);assert.equal(service.config.desktop.openWith.manatan,true);
  assert.equal(settings.configure({openWith:{steam:false}}).ok,true);assert.equal(service.config.desktop.openWith.mpv,true);
  assert.equal(settings.configure({startWithWindows:false}).ok,true);assert.equal(login,false);assert.equal(service.config.desktop.openWith.steam,false);
});


test('named startup entry succeeds even when Electron openAtLogin refers to a different app ID',()=>{
  const service={config:{desktop:normalize({}).desktop},configStore:{update:patch=>({...service.config,...patch})},publish(){}};
  const writes=[];
  const app={isPackaged:true,setLoginItemSettings:options=>writes.push(options),getLoginItemSettings:options=>{
    assert.equal(options.path, '"C:\\Program Files\\Osmolog Companion\\Companion.exe"');
    assert.deepEqual(options.args,['--startup']);
    return {openAtLogin:false,executableWillLaunchAtLogin:true,launchItems:[{name:'Osmolog Companion',scope:'user',enabled:true}]};
  }};
  const settings=createDesktopSettings({app,service,platform:'win32',environment:{PORTABLE_EXECUTABLE_FILE:'C:\\Program Files\\Osmolog Companion\\Companion.exe'},setMpvStartup:()=>({ok:true})});
  assert.equal(settings.configure({startWithWindows:true}).ok,true);
  assert.equal(service.config.desktop.startWithWindows,true);
  assert.equal(writes.length,1);
  assert.equal(writes[0].enabled,true);
  assert.equal(writes[0].path,'C:\\Program Files\\Osmolog Companion\\Companion.exe');
});

test('another startup entry cannot mask a missing or disabled Companion user entry',()=>{
  for(const entry of [null,{name:'Osmolog Companion',scope:'machine',enabled:true},{name:'Osmolog Companion',scope:'user',enabled:false}]){
    const calls=[];
    const service={config:{desktop:normalize({}).desktop},configStore:{update(){throw Error('must not save');}}};
    const app={isPackaged:true,setLoginItemSettings:options=>calls.push(options.openAtLogin),getLoginItemSettings:()=>({openAtLogin:true,executableWillLaunchAtLogin:true,launchItems:[{name:'Other app',scope:'user',enabled:true},...(entry?[entry]:[])]})};
    const settings=createDesktopSettings({app,service,platform:'win32',setMpvStartup:on=>{calls.push('mpv:'+on);return {ok:true};}});
    const result=settings.configure({startWithWindows:true});
    assert.equal(result.ok,false);
    assert.match(result.message,entry?.scope==='user'?/kept Companion's startup entry disabled/:/Could not register/);
    assert.deepEqual(calls,['mpv:true',true,false,'mpv:false']);
    assert.equal(service.config.desktop.startWithWindows,false);
  }
});

test('removal is verified against the named user entry even when other launch items remain',()=>{
  for(const remains of [false,true]){
    const previous=desktopPatch(normalize({}).desktop,{startWithWindows:true});
    const service={config:{desktop:previous},configStore:{update:patch=>({...service.config,...patch})},publish(){}};
    const writes=[];
    const app={isPackaged:true,setLoginItemSettings:options=>writes.push(options.openAtLogin),getLoginItemSettings:()=>({openAtLogin:false,executableWillLaunchAtLogin:true,launchItems:[{name:'Other app',scope:'user',enabled:true},...(remains?[{name:'Osmolog Companion',scope:'user',enabled:true}]:[])]})};
    const settings=createDesktopSettings({app,service,platform:'win32',setMpvStartup:()=>({ok:true})});
    const result=settings.configure({startWithWindows:false});
    assert.equal(result.ok,!remains);
    assert.equal(service.config.desktop.startWithWindows,remains);
    assert.deepEqual(writes,remains?[false,true]:[false]);
  }
});
