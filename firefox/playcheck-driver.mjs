// Marionette adapter for the browser interactions used by dev/playcheck.mjs.
// The assertions and app code are shared with Chrome; input uses real
// WebDriver actions, not synthetic DOM events.
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { build, DIST } from './build.mjs';
import { downscale, WIDTH, HEIGHT } from '../dev/screenshot.mjs';
import { ensureFirefox, session as firefoxSession, sleep } from './marionette.mjs';
export { sleep };
let client, url;
export async function ensureChrome() {
  build();
  await ensureFirefox();
  client = await firefoxSession();
  const id = await client.installTemporary(DIST);
  url = await client.extensionUrl(id, 'player.html');
  await client.ensureWindow();
  await client.navigate(url);
  console.log('Firefox:', await client.evaluate('return navigator.userAgent'));
}
export async function openPlayer() { return { url, webSocketDebuggerUrl: 'marionette' }; }

/**
 * A CSS viewport of exactly WIDTHxHEIGHT. Marionette sizes the window, not
 * the viewport, and what the browser's own chrome takes off it differs by
 * platform and by whether a scrollbar is showing — so the window is set from
 * the difference and the difference measured again, until it is nothing.
 */
export async function setViewport() {
  for (let i = 0; i < 4; i++) {
    const inner = await client.evaluate('return {w: innerWidth, h: innerHeight}');
    if (inner.w === WIDTH && inner.h === HEIGHT) return;
    const rect = await client.call('WebDriver:GetWindowRect');
    await client.call('WebDriver:SetWindowRect', {
      width: rect.width + (WIDTH - inner.w), height: rect.height + (HEIGHT - inner.h) });
    await sleep(400);
  }
}

export async function clearViewport() { /* the window keeps the size it was given */ }

/** The same picture the Chrome path produces, taken through Marionette. */
export async function capture(page, out) {
  for (let attempt = 1; ; attempt++) {
    await client.evaluate('return document.fonts.ready.then(() => new Promise(r => setTimeout(r, 800)))');
    const { value } = await client.call('WebDriver:TakeScreenshot', { full: false });
    const raw = `${out}.2x.png`;
    writeFileSync(raw, Buffer.from(value, 'base64'));
    // 1x: see the note on downscale's scale parameter.
    if (downscale(raw, out, 1) === 'quadrants' && attempt < 4) { unlinkSync(raw); await sleep(1000); continue; }
    unlinkSync(raw);
    console.log(`${out}  ${WIDTH}x${HEIGHT}  ${(readFileSync(out).length / 1024).toFixed(0)} kB`);
    return;
  }
}

const KEYS = { Enter: '\uE007', Escape: '\uE00C', Tab: '\uE004', Backspace: '\uE003', ArrowDown: '\uE015', ArrowUp: '\uE013', ArrowLeft: '\uE012', ArrowRight: '\uE014', PageDown: '\uE00F', PageUp: '\uE00E', Home: '\uE011', End: '\uE010', Shift: '\uE008', Control: '\uE009', Alt: '\uE00A', Meta: '\uE03D' };
async function actions(type, id, actions) { await client.call('WebDriver:PerformActions', { actions: [{type,id,...(type==='pointer'?{parameters:{pointerType:'mouse'}}:{}),actions}] }); }
async function viewport(width, height) {
  const chrome = await client.evaluate('return {w:outerWidth-innerWidth,h:outerHeight-innerHeight}');
  await client.call('WebDriver:SetWindowRect', {width:width+chrome.w,height:height+chrome.h});
}
export function session() {
  return {
    close() {}, // One Firefox connection for the whole suite.
    async doubleClick(x, y) {
      await actions('pointer', 'mouse', [
        { type: 'pointerMove', x: Math.round(x), y: Math.round(y), duration: 0, origin: 'viewport' },
        { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
        { type: 'pause', duration: 80 },
        { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
      ]);
    },
    async call(method, p={}) {
      switch(method) {
        case 'Runtime.evaluate': {
          // Firefox extension promises use browser.*, including test stubs.
          const value=await client.evaluate('const chrome=globalThis.browser; return eval(arguments[0]);', [p.expression]);
          return {result:{value}};
        }
        case 'Page.navigate': await client.navigate(p.url); return {};
        case 'Page.reload': await client.refresh(); return {};
        case 'Page.bringToFront': return {};
        case 'Browser.getWindowForTarget': return {windowId:1};
        case 'Browser.setWindowBounds': return {};
        case 'Emulation.setDeviceMetricsOverride': await viewport(p.width,p.height); return {};
        case 'Emulation.clearDeviceMetricsOverride': await viewport(1280,800); return {};
        case 'Page.captureScreenshot': return {data:(await client.call('WebDriver:TakeScreenshot',{full:false})).value};
        case 'Input.dispatchMouseEvent': {
          const move={type:'pointerMove',x:Math.round(p.x),y:Math.round(p.y),duration:0,origin:'viewport'};
          const a=[move];
          if(p.type==='mousePressed') a.push({type:'pointerDown',button:0});
          if(p.type==='mouseReleased') a.push({type:'pointerUp',button:0});
          await actions('pointer','mouse',a);return {};
        }
        case 'Input.dispatchKeyEvent': {
          const down=p.type==='keyDown', a=[];
          const modifiers=[[1,'Alt'],[2,'Control'],[4,'Meta'],[8,'Shift']].filter(([bit])=>(p.modifiers||0)&bit).map(([,key])=>KEYS[key]);
          if(down) for(const value of modifiers)a.push({type:'keyDown',value});
          a.push({type:down?'keyDown':'keyUp',value:KEYS[p.key]||p.key});
          if(!down) for(const value of modifiers.reverse())a.push({type:'keyUp',value});
          await actions('key','keyboard',a);return {};
        }
        default: throw new Error('Unsupported Firefox test operation: '+method);
      }
    },
  };
}
