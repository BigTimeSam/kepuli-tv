// Marionette adapter for the browser interactions used by dev/playcheck.mjs.
// The assertions and app code are shared with Chrome; input uses real
// WebDriver actions, not synthetic DOM events.
import { build, DIST } from './build.mjs';
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
