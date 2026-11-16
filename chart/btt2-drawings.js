/* BTT 2 drawing gestures and history. Loaded after legacy definitions, before boot. */
(function () {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const histories = new Map();
  const templateFields=['extendLeft','extendRight','timeframes','fibLevels','fibReverse','endMarker','showStats','showPriceLabels'];
  let transaction = null, restoring = false, currentPointer = null;
  let magnet = localStorage.getItem('btt2_magnet') || 'off';
  if (!['off','weak','strong'].includes(magnet)) magnet = 'off';
  const original = {
    save: Store.save, load: Store.load, select: Store.select, deselect: Store.deselect,
    add: Store.add, remove: Store.remove, clear: Store.clear,
    down: Interaction.pointerDown, move: Interaction.pointerMove, up: Interaction.pointerUp,
    place: Interaction._place, renderShape: Renderer.drawShape,
    body: HitTest.body, handles: HitTest.handles, setTool: Interaction.setTool
  };

  function key() { return Store._key(); }
  function snapshot() {
    return { key:key(), items:clone(Store.items).map(s => ({...s,selected:false})), selectedId:Store.selectedId };
  }
  function equal(a,b) { return a.key === b.key && JSON.stringify(a.items) === JSON.stringify(b.items); }
  function history() {
    const k=key();
    if (!histories.has(k)) histories.set(k,{undo:[],redo:[],baseline:snapshot()});
    return histories.get(k);
  }
  function emit(name, detail) { window.dispatchEvent(new CustomEvent(name,{detail})); }
  function notify() {
    const h=history();
    emit('btt2-history',{canUndo:!!h.undo.length,canRedo:!!h.redo.length,undoLabel:h.undo.at(-1)?.label||'',redoLabel:h.redo.at(-1)?.label||'',magnet});
    emit('btt2-selection',{id:Store.selectedId,shape:Store.selected()||null});
  }
  function repaint() { ObjectTree?.render?.(); Renderer.render(); notify(); }
  function persist() {
    try {
      const clean={};
      for(const [symbol,items] of Object.entries(Store.bySymbol))clean[symbol]=items.map(s=>({...s,selected:false}));
      localStorage.setItem(Store.KEY,JSON.stringify({bySymbol:clean,nextId:Store.nextId}));
      emit('btt2-save',{ok:true,message:'Drawings saved'});return true;
    }catch(error){emit('btt2-save',{ok:false,message:'Drawings could not be saved. Browser storage may be full; keep this tab open and export your work.',error:String(error)});return false;}
  }
  function restore(snap) {
    restoring=true;
    try {
      Store.bySymbol[snap.key]=clone(snap.items);
      if(snap.key===key()){
        Store.selectedId=snap.selectedId;
        Store.items.forEach(s=>{s.selected=s.id===Store.selectedId;});
        if (!Store.items.some(s=>s.id===Store.selectedId)) Store.selectedId=null;
      }
      ObjectTree?.clearSelection?.();
      persist();
    } finally { restoring=false; }
  }
  function record(before,after,label) {
    const h=history();
    if (!equal(before,after)) {
      h.undo.push({before,after,label:label||'Edit drawing'});
      if(h.undo.length>100)h.undo.shift();
      h.redo.length=0;
    }
    h.baseline=after;
  }
  function begin(label) {
    history();
    if(transaction){transaction.depth++;return;}
    transaction={label:label||'Edit drawing',before:snapshot(),depth:1};
  }
  function commit() {
    if(!transaction)return false;
    if(--transaction.depth>0)return false;
    const tx=transaction;transaction=null;
    if(tx.before.key!==key())return false;
    const after=snapshot();record(tx.before,after,tx.label);persist();notify();
    return !equal(tx.before,after);
  }
  function cancel() {
    if(transaction){const tx=transaction;transaction=null;restore(tx.before);const h=histories.get(tx.before.key);if(h)h.baseline=tx.before;}
    Interaction.drag=null;Interaction.draft=null;Interaction.mode=Store.selectedId==null?'idle':'selected';
    Interaction._pan(true);Renderer.render();notify();
  }
  function mutate(label,fn) {
    begin(label);
    try {const result=fn();commit();repaint();return result;}
    catch(error){cancel();throw error;}
  }
  function undo() {
    if(transaction)cancel();
    const h=history(),item=h.undo.pop();if(!item)return false;
    h.redo.push(item);restore(item.before);h.baseline=snapshot();repaint();return true;
  }
  function redo() {
    if(transaction)cancel();
    const h=history(),item=h.redo.pop();if(!item)return false;
    h.undo.push(item);restore(item.after);h.baseline=snapshot();repaint();return true;
  }
  Store.save=function(){
    if(!restoring&&!transaction){const h=history(),after=snapshot();record(h.baseline,after,'Edit drawing');}
    persist();if(!transaction&&!restoring)notify();
  };
  Store.load=function(){original.load.call(this);histories.clear();transaction=null;history();notify();};
  for(const name of ['add','remove','clear'])Store[name]=function(...args){
    if(restoring)return original[name].apply(this,args);
    return mutate(name==='add'?'Create drawing':name==='remove'?'Delete drawing':'Remove drawings',()=>{
      const result=original[name].apply(this,args);
      if(name==='add'){
        const template=TemplateStore.activeFor(result.type);
        for(const field of templateFields)if(template?.[field]!==undefined&&args[0][field]===undefined)result[field]=clone(template[field]);
      }
      return result;
    });
  };
  Store.select=function(id){original.select.call(this,id);notify();};
  Store.deselect=function(){original.deselect.call(this);notify();};
  const onSymbol=Store.onSymbolChange;
  Store.onSymbolChange=function(){if(transaction)cancel();onSymbol.call(this);history();notify();};

  /* Time on the drawing model remains UTC seconds. Gestures translate in logical
     bar coordinates so Friday->Monday does not stretch a drawing on the screen. */
  let cachedBars=null,cachedBase=null,cachedFuture=null,cachedSignature='';
  let futureProjCache={key:'',times:[]};
  function bars() {
    const base=app.renderedBars?.length?app.renderedBars:app.fullData||[];
    const future=app.futureAxisBars||[],signature=`${base.length}/${base.at(-1)?.time}/${future.length}/${future.at(-1)?.time}`;
    if(base!==cachedBase||future!==cachedFuture||signature!==cachedSignature){cachedBase=base;cachedFuture=future;cachedSignature=signature;cachedBars=future.length?base.concat(future):base;}
    return cachedBars;
  }
  function isWeekendTime(t) {
    return typeof BttTime!=='undefined'&&[0,6].includes(new Date((t-BttTime.OFFSET)*1000).getUTCDay());
  }
  function futureTimeline(baseLastTime, seconds, needTime, needStep) {
    const forex=typeof isForexComSymbol==='function'&&isForexComSymbol()&&seconds<6*86400;
    if(!forex)return null;
    const tfKey=app.tf?.key||'', key=`${baseLastTime}|${tfKey}|${seconds}|1`;
    if(futureProjCache.key!==key)futureProjCache={key,times:[]};
    const arr=futureProjCache.times, maxSteps=6500;
    let t=arr.length?arr[arr.length-1]:baseLastTime;
    while(arr.length<maxSteps){
      if(needStep!=null&&arr.length>=needStep)break;
      if(needTime!=null&&t>=needTime)break;
      const next=typeof candleEndTime==='function'?candleEndTime({time:t},tfKey):t+seconds;
      if(!Number.isFinite(next)||next<=t)break;
      t=next;
      if(isWeekendTime(t))continue;
      arr.push(t);
    }
    return arr;
  }
  function timeToLogical(time) {
    const d=bars(),n=d.length;if(!n||!Number.isFinite(time))return null;
    const seconds=Coords.barSecs();
    if(time<=d[0].time)return (time-d[0].time)/seconds;
    if(time>=d[n-1].time){
      const arr=futureTimeline(d[n-1].time,seconds,time,null);
      if(arr&&arr.length){
        if(time===d[n-1].time)return n-1;
        if(time<=arr[0])return n-1+(time-d[n-1].time)/Math.max(1,arr[0]-d[n-1].time);
        const lastFut=arr[arr.length-1];
        if(time<=lastFut){
          let lo=0,hi=arr.length-1;
          while(lo+1<hi){const mid=(lo+hi)>>1;if(arr[mid]<=time)lo=mid;else hi=mid;}
          return n+lo+(time-arr[lo])/Math.max(1,arr[hi]-arr[lo]);
        }
        return n+arr.length-1+(time-lastFut)/seconds;
      }
      return n-1+(time-d[n-1].time)/seconds;
    }
    let lo=0,hi=n-1;
    while(lo+1<hi){const mid=(lo+hi)>>1;if(d[mid].time<=time)lo=mid;else hi=mid;}
    return lo+(time-d[lo].time)/Math.max(1,d[hi].time-d[lo].time);
  }
  function logicalToTime(logical) {
    const d=bars(),n=d.length;if(!n||!Number.isFinite(logical))return null;
    const seconds=Coords.barSecs();
    if(logical<=0)return d[0].time+logical*seconds;
    if(logical>=n-1){
      const step=Math.floor(logical)-(n-1), frac=logical-Math.floor(logical);
      const arr=futureTimeline(d[n-1].time,seconds,null,step+2);
      if(arr&&arr.length){
        if(step===0)return d[n-1].time+frac*(arr[0]-d[n-1].time);
        if(step<arr.length)return arr[step-1]+frac*(arr[step]-arr[step-1]);
        const tail=arr[arr.length-1];
        return tail+(step-arr.length+frac)*seconds;
      }
      return d[n-1].time+(logical-n+1)*seconds;
    }
    const i=Math.floor(logical);return d[i].time+(logical-i)*(d[i+1].time-d[i].time);
  }
  function logicalToX(logical) {
    const ts=app.chart?.timeScale();if(!ts||!Number.isFinite(logical))return null;
    const i=Math.floor(logical),frac=logical-i,x0=ts.logicalToCoordinate(i);
    if(frac===0&&Number.isFinite(x0))return x0;
    const x1=ts.logicalToCoordinate(i+1);
    if(Number.isFinite(x0)&&Number.isFinite(x1))return x0+(x1-x0)*frac;
    const spacing=ts.options?.().barSpacing||6;
    if(Number.isFinite(x0))return x0+frac*spacing;
    const vr=ts.getVisibleLogicalRange?.();
    if(vr&&Number.isFinite(vr.from)){
      const ref=Math.round(vr.from),rx=ts.logicalToCoordinate(ref);
      if(Number.isFinite(rx))return rx+(logical-ref)*spacing;
    }
    return null;
  }
  function xToLogical(x) {
    const ts=app.chart?.timeScale();if(!ts||!Number.isFinite(x))return null;
    const raw=ts.coordinateToLogical(x);if(!Number.isFinite(raw))return null;
    const center=ts.logicalToCoordinate(raw),next=ts.logicalToCoordinate(raw+1);
    if(Number.isFinite(center)&&Number.isFinite(next)&&next!==center)return raw+(x-center)/(next-center);
    const spacing=ts.options?.().barSpacing||6;
    return Number.isFinite(center)?raw+(x-center)/spacing:raw;
  }
  // A stored hourly (or minute) anchor belongs to its containing coarse candle.
  // Interpolating23:00 between daily opens painted it beside tomorrow's candle.
  // Projection must not rewrite the timestamp: returning to H1 recovers23:00.
  function projectedLogical(time){
    const logical=timeToLogical(time);
    return Number.isFinite(logical)?Math.floor(logical+1e-9):null;
  }
  Coords.timeToX=time=>logicalToX(projectedLogical(time));
  // Pointer placement uses candle slots, while the continuous helpers remain
  // available for translating existing timestamps through session gaps.
  Coords.xToTime=x=>{const logical=xToLogical(x);return Number.isFinite(logical)?logicalToTime(Math.round(logical)):null;};
  Coords.positionXAtTime=Coords.timeToX;
  Coords.positionTimeAtX=Coords.xToTime;
  Coords.snapTime=time=>logicalToTime(projectedLogical(time));
  function plotRect() {
    const w=canvas.clientWidth||document.getElementById('chartArea').clientWidth;
    const h=canvas.clientHeight||document.getElementById('chartArea').clientHeight;
    let right=w,bottom=h;
    try {const width=app.chart.timeScale().width();if(Number.isFinite(width)&&width>0)right=Math.min(w,width);}catch(_){}
    try {const height=app.chart.timeScale().height();if(Number.isFinite(height)&&height>=0)bottom=Math.max(1,h-height);}catch(_){}
    if(right===w)try{right=w-app.chart.priceScale('right').width();}catch(_){}
    return {left:0,top:0,right,bottom,width:right,height:bottom};
  }
  function inside(x,y) {const r=plotRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;}
  function constrained(x,y) {
    if(!currentPointer?.shiftKey)return {x,y};
    let anchor=null;
    if(Interaction.draft?.type==='trend')anchor=Interaction.draft.points[0];
    else if(Interaction.drag?.kind==='handle'){
      const s=Store.get(Interaction.drag.id);
      if(s?.type==='trend')anchor=s.points[Interaction.drag.handle==='p0'?1:0];
    }
    if(!anchor)return {x,y};
    const p=Coords.pointToScreen(anchor);if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return{x,y};
    const dx=x-p.x,dy=y-p.y,length=Math.hypot(dx,dy),angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4;
    return{x:p.x+Math.cos(angle)*length,y:p.y+Math.sin(angle)*length};
  }
  function magnetPoint(x,y,pt) {
    if(magnet==='off'||Interaction.drag?.kind==='body')return pt;
    const drawing=Interaction.tool!=='cursor'||Interaction.drag?.kind==='handle';if(!drawing)return pt;
    const logical=xToLogical(x),i=Math.round(logical),d=app.renderedBars||[];
    const bar=d[i];if(!bar)return pt;
    let best=null;
    for(const price of [bar.open,bar.high,bar.low,bar.close]){
      const yy=Coords.priceToY(price);if(!Number.isFinite(yy))continue;
      const distance=Math.hypot(logicalToX(i)-x,yy-y);
      if(!best||distance<best.distance)best={time:bar.time,price,distance};
    }
    if(best&&(magnet==='strong'||best.distance<=12))return {time:best.time,price:best.price};
    return pt;
  }
  Coords.screenToPoint=function(sx,sy){
    if(!Number.isFinite(sx)||!Number.isFinite(sy))return{time:null,price:null};
    const p=constrained(sx,sy);
    return magnetPoint(p.x,p.y,{time:Coords.xToTime(p.x),price:Coords.yToPrice(p.y)});
  };
  function setMagnet(value){magnet=['off','weak','strong'].includes(value)?value:'off';localStorage.setItem('btt2_magnet',magnet);notify();return magnet;}
  function toggleMagnet(){return setMagnet(magnet==='off'?'weak':magnet==='weak'?'strong':'off');}
  function visible(s){return s?.visible!==false&&(!Array.isArray(s.timeframes)||s.timeframes.includes(app.tf?.key));}
  const captureTemplate=TemplateStore.capture;
  TemplateStore.capture=function(s){
    const result=captureTemplate.call(this,s);
    for(const field of templateFields)if(s[field]!==undefined)result[field]=clone(s[field]);
    return result;
  };

  /* Selected handles have priority. Unselected objects are hit in visual order;
     their invisible handles never intercept the body of a newer drawing. */
  HitTest.at=function(x,y){
    if(!inside(x,y))return null;
    const selected=Store.selected(),radius=matchMedia('(pointer:coarse)').matches?13:8;
    if(selected&&visible(selected)&&!selected.locked){
      for(const h of this.handles(selected))if(Number.isFinite(h.x)&&Number.isFinite(h.y)&&Math.hypot(x-h.x,y-h.y)<=radius)return{shape:selected,kind:'handle',handle:h.name};
    }
    for(let i=Store.items.length-1;i>=0;i--){const s=Store.items[i];if(visible(s)&&this.body(s,x,y,radius))return{shape:s,kind:'body'};}
    return null;
  };
  function trendSegment(s) {
    const a=Coords.pointToScreen(s.points?.[0]),b=Coords.pointToScreen(s.points?.[1]);
    if([a.x,a.y,b.x,b.y].some(v=>!Number.isFinite(v)))return null;
    if(!s.extendLeft&&!s.extendRight)return{a,b};
    const r=plotRect(),dx=b.x-a.x,dy=b.y-a.y;
    if(Math.hypot(dx,dy)<.01)return{a,b};
    const reverse=b.x<a.x;
    let low=(reverse?s.extendRight:s.extendLeft)?-Infinity:0,high=(reverse?s.extendLeft:s.extendRight)?Infinity:1;
    for(const [p,q] of [[-dx,a.x-r.left],[dx,r.right-a.x],[-dy,a.y-r.top],[dy,r.bottom-a.y]]){
      if(p===0){if(q<0)return null;continue;}
      const t=q/p;if(p<0)low=Math.max(low,t);else high=Math.min(high,t);
    }
    if(low>high||!Number.isFinite(low)||!Number.isFinite(high))return null;
    return{a:{x:a.x+dx*low,y:a.y+dy*low},b:{x:a.x+dx*high,y:a.y+dy*high}};
  }
  function textBounds(s){
    const p=Coords.pointToScreen(s.points[0]);if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return null;
    const size=Number(s.style?.fontSize)||12,lines=String(s.text||'Text').split('\n');
    ctx.save();ctx.font=`${size}px -apple-system,Segoe UI,Arial,sans-serif`;
    const width=Math.max(...lines.map(line=>ctx.measureText(line).width))+8;ctx.restore();
    return{left:p.x,right:p.x+width,top:p.y-size-4,bottom:p.y+(lines.length-1)*(size+5)+4};
  }
  HitTest.body=function(s,x,y,radius){
    if(!visible(s))return false;
    if(s.type==='trend'){const l=trendSegment(s);return!!l&&distSeg(x,y,l.a.x,l.a.y,l.b.x,l.b.y)<=radius;}
    if(s.type==='text'){const b=textBounds(s);return!!b&&x>=b.left-radius&&x<=b.right+radius&&y>=b.top-radius&&y<=b.bottom+radius;}
    if(s.type==='fib'){
      const a=Coords.pointToScreen(s.points[0]),b=Coords.pointToScreen(s.points[1]);
      if(!Number.isFinite(a.x)||!Number.isFinite(b.x)||x<Math.min(a.x,b.x)-radius||x>Math.max(a.x,b.x)+radius)return false;
      return fibLevels(s).some(level=>Math.abs(y-Coords.priceToY(fibPrice(s,level)))<=radius);
    }
    return original.body.call(this,s,x,y,radius);
  };
  function normOp(v,fallback=1){const n=(v===null||v===undefined||v==='')?NaN:Number(v);return Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback;}
  function rgbaCol(col,a){return typeof hexRgba==='function'?hexRgba(col,a):col;}
  function fibLevels(s){const levels=Array.isArray(s.fibLevels)?s.fibLevels:[0,.5,1];return levels.filter(Number.isFinite).slice(0,50);}
  function fibPrice(s,level){return s.points[0].price+(s.points[1].price-s.points[0].price)*(s.fibReverse?1-level:level);}
  function drawFib(s){
    const a=Coords.pointToScreen(s.points[0]),b=Coords.pointToScreen(s.points[1]);
    if([a.x,a.y,b.x,b.y].some(v=>!Number.isFinite(v)))return;
    const left=Math.min(a.x,b.x),right=Math.max(a.x,b.x),col=s.style?.color||'#2962ff';
    const lineOp=normOp(s.style?.opacity,1),strokeCol=rgbaCol(col,lineOp);
    const opacity=normOp(s.style?.fillOpacity,.12);
    const levels=fibLevels(s).map(level=>({level,price:fibPrice(s,level)})).map(item=>({...item,y:Coords.priceToY(item.price)})).filter(item=>Number.isFinite(item.y));
    const bands=[...levels].sort((one,two)=>one.y-two.y);
    // One fill preference applies to every configured band. Alternating opacity
    // keeps neighboring levels legible without inventing per-level settings.
    if(opacity>0)for(let i=1;i<bands.length;i++){
      ctx.fillStyle=rgbaCol(s.style?.fillColor||col,opacity*(i%2?1:.55));
      ctx.fillRect(left,bands[i-1].y,right-left,bands[i].y-bands[i-1].y);
    }
    ctx.strokeStyle=strokeCol;ctx.fillStyle=strokeCol;ctx.lineWidth=s.style?.width||2;ctx.font='11px -apple-system,Segoe UI,Arial,sans-serif';
    ctx.setLineDash(s.lineStyle==='dashed'?[8,5]:s.lineStyle==='dotted'?[2,4]:[]);
    for(const {level,price,y} of levels){
      ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillText(`${Number((level*100).toFixed(3))}%  ${formatPrice(price)}`,right+5,y-3);
    }
    if(s.text)Renderer.drawShapeText(s);
  }
  const oldBounds=Renderer.shapeBounds;
  Renderer.shapeBounds=function(s){return s.type==='text'?textBounds(s):oldBounds.call(this,s);};
  Renderer.drawShape=function(s){
    if(!visible(s))return;
    const r=plotRect(),lineOp=normOp(s.style?.opacity,1),col=s.style?.color||'#2962ff';
    ctx.save();ctx.beginPath();ctx.rect(r.left,r.top,r.width,r.height);ctx.clip();
    try{
      if(s.type==='trend'){
        const l=trendSegment(s);if(!l)return;
        ctx.strokeStyle=rgbaCol(col,lineOp);ctx.lineWidth=s.style?.width||2;
        ctx.setLineDash(s.lineStyle==='dashed'?[8,5]:s.lineStyle==='dotted'?[2,4]:[]);
        ctx.beginPath();ctx.moveTo(l.a.x,l.a.y);ctx.lineTo(l.b.x,l.b.y);ctx.stroke();
        if(s.text)this.drawShapeText(s);
      }else if(s.type==='fib')drawFib(s);
      else original.renderShape.call(this,s);
    }finally{ctx.restore();}
    // Axis labels are painted outside the clipped drawing pane.
    if((s.type==='hline'||s.type==='hray')&&s.points?.[0])this.priceTag(Coords.priceToY(s.points[0].price),s.points[0].price,col,lineOp);
    if(s.type==='vline'&&s.points?.[0])this.timeTag(Coords.timeToX(s.points[0].time),s.points[0].time,col,lineOp);
    if(['long','short'].includes(s.type)&&s.position?.showPriceLabels!==false&&(s.selected||s.position?.showAlways)){
      const labelOp=normOp(s.position?.lineOpacity,1);
      for(const [value,tagCol] of [[s.tp,s.position?.targetColor||'#089981'],[s.entry,'#434651'],[s.sl,s.position?.stopColor||'#f23645']]){
        const y=Coords.priceToY(value);if(Number.isFinite(y)&&y>=r.top&&y<=r.bottom)this.priceTag(y,value,tagCol,labelOp);
      }
    }
  };
  const drawDraft=Renderer.drawDraft,drawHandles=Renderer.drawHandles;
  Renderer.drawDraft=function(s){const r=plotRect();ctx.save();ctx.beginPath();ctx.rect(0,0,r.width,r.height);ctx.clip();try{drawDraft.call(this,s);}finally{ctx.restore();}};
  Renderer.drawHandles=function(s){if(s.locked||!visible(s))return;const r=plotRect();ctx.save();ctx.beginPath();ctx.rect(0,0,r.width,r.height);ctx.clip();try{drawHandles.call(this,s);}finally{ctx.restore();}};

  Interaction._dragBody=function(s,snap,_dt,dp){
    const drag=this.drag;if(!drag)return;
    let delta=xToLogical(currentPointer?this._pos(currentPointer).x:drag.startX)-drag.startLogical;
    if(!Number.isFinite(delta))delta=0;
    delta=Math.round(delta);
    if(currentPointer?.shiftKey){const p=this._pos(currentPointer);if(Math.abs(p.x-drag.startX)>=Math.abs(p.y-drag.startY))dp=0;else delta=0;}
    const shifted=t=>logicalToTime(timeToLogical(t)+delta);
    if(['trend','rect','fib'].includes(s.type))s.points=snap.points.map(p=>({time:shifted(p.time),price:p.price+dp}));
    else if(s.type==='hline')s.points[0].price=snap.points[0].price+dp;
    else if(s.type==='vline')s.points[0]={time:Coords.snapTime(shifted(snap.points[0].time)),price:snap.points[0].price};
    else if(['hray','text'].includes(s.type))s.points[0]={time:shifted(snap.points[0].time),price:snap.points[0].price+dp};
    else if(['long','short'].includes(s.type)){
      s.points[0].time=shifted(snap.points[0].time);s.endTime=shifted(snap.endTime);
      s.entry=snap.entry+dp;s.tp=snap.tp+dp;s.sl=snap.sl+dp;s.points[0].price=s.entry;
      s.position={...(s.position||{}),startBarTime:s.points[0].time};
      window.BTT2Positions?.normalize?.(s);
    }
  };
  const touchLoupe={
    el:null,active:false,pointerId:null,corner:'tr',
    fingerX:0,fingerY:0,targetX:0,targetY:0,price:null,
    ensure(){
      if(this.el)return this.el;
      const area=document.getElementById('chartArea');if(!area)return null;
      const el=document.createElement('canvas');
      el.id='touchMagnifier';el.className='btt2-ui';
      el.setAttribute('aria-hidden','true');el.hidden=true;
      area.appendChild(el);this.el=el;return el;
    },
    sizeFor(r){return (r.height<230||r.width<320)?72:86;},
    pickCorner(fx,fy,tx,ty,r,size,prev){
      const pad=10,maxX=Math.max(pad,r.right-size-pad),maxY=Math.max(8,r.bottom-size-pad);
      const topLeftY=Math.min(28,maxY);
      const opts=[
        {id:'tr',x:maxX,y:8,top:true},
        {id:'tl',x:pad,y:topLeftY,top:true},
        {id:'br',x:maxX,y:maxY,top:false},
        {id:'bl',x:pad,y:maxY,top:false},
      ];
      const midX=r.right*0.5,hyst=28;
      let pref=prev&&(prev==='tl'||prev==='tr')?prev:(fx<midX?'tr':'tl');
      if(pref==='tr'&&fx>midX+hyst)pref='tl';
      else if(pref==='tl'&&fx<midX-hyst)pref='tr';
      const clearDist=(c)=>{
        const cx=c.x+size/2,cy=c.y+size/2;
        const dFinger=Math.hypot(cx-fx,cy-fy);
        const dHand=Math.hypot(cx-(fx+12),cy-(fy+28));
        const dTarget=Number.isFinite(tx)&&Number.isFinite(ty)?Math.hypot(cx-tx,cy-ty):dFinger;
        return Math.min(dFinger,dHand,dTarget);
      };
      const safeThreshold=size*0.65+46;
      const prefBox=opts.find(o=>o.id===pref)||opts[0];
      if(clearDist(prefBox)>=safeThreshold)return prefBox;
      let best=prefBox,bestD=-1;
      for(const c of opts){
        const d=clearDist(c)+(c.top?12:0);
        if(d>bestD){bestD=d;best=c;}
      }
      return best;
    },
    targetFor(x,y){
      let tx=x,ty=y,price=Coords.yToPrice(y);
      if(Interaction.drag?.kind==='handle'){
        const s=Store.get(Interaction.drag.id);
        const h=s?HitTest.handles(s).find(item=>item.name===Interaction.drag.handle):null;
        if(h&&Number.isFinite(h.x)&&Number.isFinite(h.y)){
          tx=s.type==='hline'?x:h.x;
          ty=s.type==='vline'?y:h.y;
        }
        if(s){
          if(['trend','rect','fib'].includes(s.type)&&h){
            price=Coords.yToPrice(ty);
          }else if(s.type==='hline'||s.type==='hray')price=s.points?.[0]?.price??price;
          else if(s.type==='long'||s.type==='short'){
            if(Interaction.drag.handle==='entry')price=s.entry;
            else if(Interaction.drag.handle==='tp')price=s.tp;
            else if(Interaction.drag.handle==='sl')price=s.sl;
          }
        }
      }else if(Interaction.draft?.type==='rect'&&Interaction.draft.dragging){
        const pt=Interaction.draft.points?.[1];
        if(pt){
          const p=Coords.pointToScreen(pt);
          if(Number.isFinite(p.x)&&Number.isFinite(p.y)){tx=p.x;ty=p.y;}
          if(Number.isFinite(pt.price))price=pt.price;
        }
      }
      return {tx,ty,price};
    },
    paint(){
      if(!this.active)return;
      const el=this.ensure(),area=document.getElementById('chartArea');
      if(!el||!area)return;
      const r=plotRect();if(r.width<90||r.height<90){this.hide();return;}
      const size=this.sizeFor(r),dpr=window.devicePixelRatio||1,zoom=2.2,span=size/zoom,half=span/2;
      const box=this.pickCorner(this.fingerX,this.fingerY,this.targetX,this.targetY,r,size,this.corner);
      this.corner=box.id;
      const pw=Math.round(size*dpr),ph=Math.round(size*dpr);
      if(el.width!==pw||el.height!==ph){el.width=pw;el.height=ph;}
      el.style.width=size+'px';el.style.height=size+'px';
      el.style.left=Math.round(box.x)+'px';el.style.top=Math.round(box.y)+'px';
      el.hidden=false;el.style.display='block';
      const lctx=el.getContext('2d');if(!lctx)return;
      lctx.setTransform(dpr,0,0,dpr,0,0);
      lctx.clearRect(0,0,size,size);
      lctx.save();lctx.beginPath();lctx.arc(size/2,size/2,size/2-1,0,Math.PI*2);lctx.clip();
      const dark=typeof Theme!=='undefined'&&Theme.current==='dark';
      lctx.fillStyle=dark?'#0f1218':'#ffffff';lctx.fillRect(0,0,size,size);
      const ar=area.getBoundingClientRect();
      const sx0=this.targetX-half,sy0=this.targetY-half;
      const composite=(src,ox,oy,cw,ch)=>{
        if(!src||!src.width||!src.height||cw<=0||ch<=0)return;
        const rx0=Math.max(0,sx0-ox),ry0=Math.max(0,sy0-oy);
        const rx1=Math.min(cw,sx0+span-ox),ry1=Math.min(ch,sy0+span-oy);
        if(rx1<=rx0||ry1<=ry0)return;
        const scX=src.width/cw,scY=src.height/ch;
        lctx.drawImage(src,rx0*scX,ry0*scY,(rx1-rx0)*scX,(ry1-ry0)*scY,(rx0+ox-sx0)*zoom,(ry0+oy-sy0)*zoom,(rx1-rx0)*zoom,(ry1-ry0)*zoom);
      };
      const container=document.getElementById('chartContainer');
      if(container)for(const c of container.querySelectorAll('canvas')){
        const cr=c.getBoundingClientRect(),ox=cr.left-ar.left,oy=cr.top-ar.top;
        if(cr.width<40||cr.height<40||ox>=r.right||oy>=r.bottom)continue;
        composite(c,ox,oy,cr.width,cr.height);
      }
      const haks=document.getElementById('haksCanvas');
      if(haks&&haks.style.display!=='none')composite(haks,0,0,haks.clientWidth||r.width,haks.clientHeight||r.height);
      composite(canvas,0,0,canvas.clientWidth||r.width,canvas.clientHeight||r.height);
      const mid=size/2;
      lctx.strokeStyle=dark?'rgba(255,255,255,0.45)':'rgba(19,23,34,0.38)';lctx.lineWidth=1;
      lctx.beginPath();lctx.moveTo(0,mid);lctx.lineTo(size,mid);lctx.moveTo(mid,0);lctx.lineTo(mid,size);lctx.stroke();
      lctx.fillStyle='#3974f5';lctx.strokeStyle='#ffffff';lctx.lineWidth=1.2;
      lctx.beginPath();lctx.arc(mid,mid,3,0,Math.PI*2);lctx.fill();lctx.stroke();
      if(Number.isFinite(this.price)&&typeof formatPrice==='function'){
        const label=formatPrice(this.price);
        lctx.font='600 9px -apple-system,Segoe UI,Arial,sans-serif';
        const tw=Math.min(size-14,lctx.measureText(label).width+10);
        const lx=(size-tw)/2,ly=size-17;
        lctx.fillStyle=dark?'rgba(15,18,24,0.88)':'rgba(19,23,34,0.84)';
        lctx.fillRect(lx,ly,tw,14);
        lctx.fillStyle='#ffffff';lctx.textAlign='center';lctx.textBaseline='middle';
        lctx.fillText(label,mid,ly+7.5);
      }
      lctx.restore();
    },
    update(x,y,pointerId){
      const {tx,ty,price}=this.targetFor(x,y);
      this.active=true;this.pointerId=pointerId??null;
      this.fingerX=x;this.fingerY=y;this.targetX=tx;this.targetY=ty;this.price=price;
      this.paint();
    },
    refresh(){if(this.active)this.paint();},
    hide(){
      this.active=false;this.pointerId=null;
      if(this.el){this.el.hidden=true;this.el.style.display='none';}
    }
  };
  const loupeCancel=cancel;
  cancel=function(){touchLoupe.hide();return loupeCancel();};

  Interaction.pointerDown=function(e){
    if(e.pointerType!=='touch'&&e.button!==undefined&&e.button!==0)return;
    if(e.isPrimary===false)return;
    if(e.target?.closest?.('#settingsPopup,#objectTree,#replayPickerControls,#templateChip,#styleChip,.btt2-ui'))return;
    const p=this._pos(e);if(!inside(p.x,p.y))return;
    currentPointer=e;
    try{
      const canHit=this.tool==='cursor'||this.mode==='selected'||this.mode==='idle';
      if(canHit&&HitTest.at(p.x,p.y))begin('Move drawing');
      const tree=document.getElementById('objectTree'),keepTree=tree?.closest?.('#rightDock')&&tree.classList.contains('visible');
      original.down.call(this,e);
      if(keepTree){tree.classList.add('visible');document.getElementById('btnObjects')?.classList.add('active');}
      if(this.drag){this.drag.startLogical=xToLogical(p.x);this.drag.pointerId=e.pointerId;if(transaction)transaction.label=this.drag.kind==='handle'?'Resize drawing':'Move drawing';}
      if(this.draft?.dragging)this.draft.pointerId=e.pointerId;
      if(e.pointerType==='touch'&&((this.drag?.kind==='handle')||this.draft?.dragging)){
        touchLoupe.update(p.x,p.y,e.pointerId);
      }else if(e.pointerType!=='touch'){
        touchLoupe.hide();
      }
    }finally{currentPointer=null;}
  };
  Interaction.pointerMove=function(e){
    if(e.target?.closest?.('.btt2-ui'))return;
    if(this.drag?.pointerId!==undefined&&e.pointerId!==this.drag.pointerId)return;
    if(this.draft?.dragging&&this.draft.pointerId!==undefined&&e.pointerId!==this.draft.pointerId)return;
    currentPointer=e;
    try{
      const p=this._pos(e);
      if(this.drag&&!this.drag.moved){
        const threshold=e.pointerType==='touch'?5:3;
        if(Math.hypot(p.x-this.drag.startX,p.y-this.drag.startY)<threshold){e.preventDefault();e.stopPropagation();return;}
        this.drag.moved=true;
      }
      original.move.call(this,e);
      if(e.pointerType==='touch'&&((this.drag&&(this.drag.kind==='handle'||this.drag.moved))||this.draft?.dragging)){
        touchLoupe.update(p.x,p.y,e.pointerId);
      }else if(!this.drag&&!this.draft){
        touchLoupe.hide();
        const r=plotRect(),hit=HitTest.at(p.x,p.y);
        document.getElementById('chartArea').style.cursor=p.x>r.right?'ns-resize':p.y>r.bottom?'ew-resize':this.tool!=='cursor'?'crosshair':hit?.shape.locked?'default':hit?.kind==='handle'?'crosshair':hit?'move':'';
      }
    }finally{currentPointer=null;}
  };
  Interaction.pointerUp=function(e){
    if(e.pointerType!=='touch'&&e.button!==undefined&&e.button!==0)return;
    if(this.drag?.pointerId!==undefined&&e.pointerId!==this.drag.pointerId)return;
    if(this.draft?.dragging&&this.draft.pointerId!==undefined&&e.pointerId!==this.draft.pointerId)return;
    if(touchLoupe.pointerId===null||e.pointerId===touchLoupe.pointerId)touchLoupe.hide();
    if(e.target?.closest?.('#settingsPopup,#objectTree,#replayPickerControls,#templateChip,#styleChip,.btt2-ui'))return;
    if(ReplayPicker.active&&ReplayPicker.touchId===e.pointerId){ReplayPicker.touchId=null;e.preventDefault();e.stopPropagation();return;}
    const drag=this.drag;
    if(drag){
      this.drag=null;this.mode='selected';this._pan(true);
      if(transaction)commit();else Store.save();
      Renderer.render();
      // Selection opens only the compact toolbar. Observation boxes keep their
      // established triple-tap hide action; detailed properties belong to UI.
      if(!drag.moved){const shape=Store.get(drag.id);if(shape)Observations?.tap?.(shape);}
    }else if(this.tool==='cursor'&&!this.draft){
      const p=this._pos(e),which=WeekMarkers.hit(p.x);if(which)WeekMarkers.registerTap(which);
    }
    if(this.draft?.type==='rect'&&this.draft.dragging){
      const a=Coords.pointToScreen(this.draft.points[0]),b=Coords.pointToScreen(this.draft.points[1]);
      if(Math.abs(a.x-b.x)>=3&&Math.abs(a.y-b.y)>=3){
        if(this.tool==='observation')Observations.create(this.draft.points);
        else Store.add({type:'rect',points:clone(this.draft.points)});
      }
      this.draft=null;this.setTool('cursor');
    }
    touchLoupe.hide();
    notify();
  };
  Interaction._place=function(pt,x,y,e){
    if(this.tool==='long'||this.tool==='short'){
      const r=plotRect(),px=Coords.timeToX(pt.time);
      const startX=Number.isFinite(px)?px:x;
      if(!inside(startX,y)||!Number.isFinite(pt.price))return;
      const width=Math.min(160,r.width*.28,r.right-startX);
      if(width<8){showHint('Place the position slightly farther from the price scale');return;}
      const tick=10**-pricePrecisionForSymbol(app.symbol);
      const unit=Math.abs((Coords.yToPrice(y+1)??pt.price)-(Coords.yToPrice(y)??pt.price))||tick;
      const risk=Math.max(tick,unit*Math.min(38,r.height*.1)),reward=Math.max(tick,unit*Math.min(65,r.height*.17)),dir=this.tool==='long'?1:-1;
      const startTime=Coords.positionTimeAtX(startX),endTime=Coords.positionTimeAtX(startX+width);
      if(!Number.isFinite(startTime)||!Number.isFinite(endTime))return;
      Store.add({type:this.tool,points:[{time:startTime,price:pt.price}],entry:pt.price,sl:pt.price-dir*risk,tp:pt.price+dir*reward,endTime,position:{startBarTime:startTime}});
      this.setTool('cursor');e.preventDefault();e.stopPropagation();return;
    }
    // Reject zero-length second anchors, but keep the draft ready for a valid click.
    if(this.draft&&['trend','fib'].includes(this.draft.type)){
      const a=Coords.pointToScreen(this.draft.points[0]);
      if(Math.hypot(a.x-x,a.y-y)<3){e.preventDefault();e.stopPropagation();return;}
    }
    return original.place.call(this,pt,x,y,e);
  };
  Interaction.setTool=function(tool){touchLoupe.hide();if(transaction)cancel();original.setTool.call(this,tool);notify();};
  function editable(target){return !!target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]');}
  window.addEventListener('keydown',e=>{
    if(editable(e.target)){
      // Keep native text editing, but do not let legacy global Backspace/Delete
      // remove the selected chart object while typing in a textarea/editor.
      if(e.key==='Delete'||e.key==='Backspace')e.stopImmediatePropagation();
      return;
    }
    if(e.key==='Escape'&&document.querySelector('.dialog-shade'))return;
    if(e.key==='Escape')emit('btt2-cancel-tool',{reason:'escape'});
    if(e.key==='Escape'&&(transaction||Interaction.drag||Interaction.draft||Interaction.tool!=='cursor')){cancel();Interaction.setTool('cursor');e.preventDefault();e.stopImmediatePropagation();return;}
    if((e.ctrlKey||e.metaKey)&&!e.altKey){
      const k=e.key.toLowerCase();
      if(k==='z'||k==='y'){(k==='y'||e.shiftKey?redo:undo)();e.preventDefault();e.stopImmediatePropagation();}
    }
  },true);
  document.getElementById('chartArea').addEventListener('pointercancel',()=>{touchLoupe.hide();cancel();},true);
  window.addEventListener('blur',()=>{touchLoupe.hide();if(Interaction.drag||Interaction.draft)cancel();});
  window.addEventListener('btt2-chart-change',()=>touchLoupe.hide());
  const guide=CursorUI.guide;
  if(typeof guide==='function')CursorUI.guide=function(e){
    const p=Interaction._pos(e);if(!inside(p.x,p.y)){app.chart?.clearCrosshairPosition?.();return;}
    return guide.call(this,e);
  };

  window.BTT2TouchLoupe={refresh:()=>touchLoupe.refresh(),hide:()=>touchLoupe.hide(),pickCorner:(fx,fy,tx,ty,r,size,prev)=>touchLoupe.pickCorner(fx,fy,tx,ty,r,size,prev),active:()=>touchLoupe.active};
  window.BTT2Drawing={begin,commit,cancel,execute:mutate,mutate,undo,redo,notify,plotRect,visible,
    setTool:tool=>Interaction.setTool(tool),setMagnet,toggleMagnet,
    state:()=>({magnet,canUndo:!!history().undo.length,canRedo:!!history().redo.length,selectedId:Store.selectedId}),
    coordinates:{timeToLogical,logicalToTime,xToLogical,logicalToX,projectedLogical},
    resetHistory:()=>{histories.clear();transaction=null;history();notify();}
  };
  history();
})();
