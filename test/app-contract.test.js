"use strict";
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {mode,connection,duration}=require('../src/app/view-model');
const read=name=>fs.readFileSync(path.join(__dirname,'../src/app',name),'utf8');
test('player status distinguishes discovery, connection, and actual counting',()=>{
  assert.equal(connection({connected:false,enabled:true}).label,'Idle');
  assert.equal(connection({connected:true,playing:false}).label,'Connected');
  assert.deepEqual(connection({connected:true,playing:true,mode:'passive'}),{label:'Now tracking',color:'detected'});
});
test('activity circle is green for active, amber for passive, gray for every stopped state',()=>{
  assert.equal(mode({playing:true,mode:'active'}).color,'active');assert.equal(mode({playing:true,mode:'passive'}).color,'passive');
  for(const p of [{manualPaused:true},{muted:true},{paused:true},{reason:'idle'},{reason:'excluded'}])assert.equal(mode(p).color,'stopped');
  assert.equal(mode({manualPaused:true}).label,'Tracking paused');assert.equal(mode({muted:true}).label,'Muted');
});
test('timer tolerates missing values and formats hours and minutes',()=>{assert.equal(duration(undefined),'0s');assert.equal(duration(2538),'42m 18s');assert.equal(duration(5020),'1h 23m');});
test('desktop retains secure preload, tray, compact dragging and resizable expanded mode',()=>{
  const main=read('main.js'),html=read('index.html'),renderer=read('renderer.js');
  assert.match(main,/contextIsolation: true/);assert.match(main,/nodeIntegration: false/);assert.match(main,/sandbox: true/);
  assert.match(main,/setResizable\(true\)/);assert.match(main,/setMinimumSize\(156, 42\)/);assert.match(main,/new Tray\(icon\)/);
  assert.match(html,/id="compactOverlay"/);assert.match(renderer,/api.windowAction\("move"/);
  assert.match(html,/Content-Security-Policy/);assert.doesNotMatch(renderer,/innerHTML\s*=\s*state\./);
});
