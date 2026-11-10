/* BTT 2 position drawings: deterministic measurements, not executable orders. */
(function(root){
 'use strict';
 const defaults={targetColor:'#089981',stopColor:'#f23645',opacity:.18,lineWidth:1,
  showAlways:false,compact:false,showPriceLabels:true,accountSize:null,riskMode:'manual',
  riskAmount:null,quantity:null,pointValue:null,lotSize:null,leverage:null,
  accountCurrency:'',quoteCurrency:'',measurementUnit:'auto',pipSize:null};
 const positive=v=>v!==null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
 const validColor=v=>/^#[0-9a-f]{6}$/i.test(v||'');
 function isPosition(s){return s&&(s.type==='long'||s.type==='short');}
 const forexCurrencies=new Set(['USD','EUR','GBP','JPY','CHF','AUD','CAD','NZD','CNH','CNY','HKD','NOK','SEK','SGD','DKK','MXN','ZAR','TRY','PLN','HUF','CZK','ILS','THB','INR','RUB','BRL','KRW']);
 function measurement(s,symbol,outcome){
  const p={...defaults,...s.position},requested=['auto','pips','points'].includes(p.measurementUnit)?p.measurementUnit:'auto';
  const instrument=String(symbol||s.symbol||'').split('|').at(-1).split(':').at(-1).toUpperCase().trim().replace('/','');
  const forex=instrument.length===6&&instrument.slice(0,3)!==instrument.slice(3)&&forexCurrencies.has(instrument.slice(0,3))&&forexCurrencies.has(instrument.slice(3));
  const custom=positive(p.pipSize),resolved=custom||(forex?(instrument.endsWith('JPY') ? .01 : .0001):null);
  const pipSize=requested==='points'?null:resolved;
  const dir=s.type==='short'?-1:1,divisor=pipSize||1;
  return {unit:pipSize?'pips':'points',pipSize,source:pipSize?(custom?'custom':'forex'):'points',
   risk:dir*(s.entry-s.sl)/divisor,reward:dir*(s.tp-s.entry)/divisor,pnl:outcome?.pnl!=null?outcome.pnl/divisor:null,
   note:!pipSize&&requested==='pips'?'Pip size is undefined for this instrument; showing price points. Enter a custom pip size.':''};
 }
 function containingTime(time,bars){
  if(!Number.isFinite(time)||!bars?.length||time<bars[0].time||time>bars[bars.length-1].time)return time;
  let a=0,z=bars.length;while(a<z){const m=(a+z)>>1;if(bars[m].time<=time)a=m+1;else z=m;}
  return bars[Math.max(0,a-1)].time;
 }
 function normalize(s,bars){
  if(!isPosition(s))return s;
  const previous=s.position||{};
  s.position={...defaults,...previous};
  const p=s.position;
  p.targetColor=validColor(p.targetColor)?p.targetColor:defaults.targetColor;
  p.stopColor=validColor(p.stopColor)?p.stopColor:defaults.stopColor;
  p.opacity=Number.isFinite(Number(p.opacity))?Math.max(0,Math.min(1,Number(p.opacity))):defaults.opacity;
  p.lineWidth=Math.max(1,Math.min(5,positive(p.lineWidth)||1));
  p.showAlways=previous.showAlways==null?!!previous.alwaysStats:!!previous.showAlways;p.compact=!!p.compact;p.showPriceLabels=p.showPriceLabels!==false;
  p.riskMode=['manual','amount','percent'].includes(p.riskMode)?p.riskMode:'manual';
  p.measurementUnit=['auto','pips','points'].includes(p.measurementUnit)?p.measurementUnit:'auto';
  for(const k of ['accountSize','riskAmount','quantity','pointValue','lotSize','leverage','pipSize'])p[k]=positive(p[k]);
  p.accountCurrency=String(p.accountCurrency||'').toUpperCase().trim();p.quoteCurrency=String(p.quoteCurrency||'').toUpperCase().trim();
  if(s.points?.[0]){
   s.points[0].price=s.entry;
   if(bars)p.startBarTime=containingTime(s.points[0].time,bars);
   if(!Number.isFinite(s.endTime)&&Number.isFinite(s.points[0].time)){
    const interval=typeof Coords!=='undefined'?Coords.barSecs():bars?.length>1?bars[1].time-bars[0].time:900;
    s.endTime=s.points[0].time+Math.max(1,interval)*30;
   }
  }
  return s;
 }
 // Pure helper. quantity is instrument units; lotSize is the quantity step.
 // pointValue is quote-currency value per 1.0 price move per quantity unit.
 function statistics(s,bars,evaluator,symbol){
  const p={...defaults,...s.position},dir=s.type==='short'?-1:1;
  p.quoteCurrency=String(p.quoteCurrency||'').toUpperCase().trim();
  p.accountCurrency=String(p.accountCurrency||'').toUpperCase().trim();
  p.riskMode=['manual','amount','percent'].includes(p.riskMode)?p.riskMode:'manual';
  const risk=dir*(s.entry-s.sl),reward=dir*(s.tp-s.entry);
  const missing=[],warnings=[];
  const pv=positive(p.pointValue),step=positive(p.lotSize),account=positive(p.accountSize),lev=positive(p.leverage);
  const currenciesKnown=!!p.quoteCurrency&&!!p.accountCurrency;
  const sameCurrency=currenciesKnown&&p.quoteCurrency===p.accountCurrency;
  let quantity=positive(p.quantity),requestedRisk=null;
  const validLevels=[s.entry,s.tp,s.sl,risk,reward].every(Number.isFinite)&&risk>0&&reward>0;
  if(!validLevels)warnings.push('Invalid price levels');
  if(p.riskMode!=='manual'){
   if(!pv)missing.push('pointValue');
   if(!p.quoteCurrency)missing.push('quoteCurrency');
   if(!p.accountCurrency)missing.push('accountCurrency');
   if(currenciesKnown&&!sameCurrency)warnings.push('Account and quote currencies differ; conversion is unavailable');
   if(p.riskMode==='percent'&&!account)missing.push('accountSize');
   const amount=positive(p.riskAmount);if(!amount)missing.push('riskAmount');
   requestedRisk=p.riskMode==='percent'&&account&&amount?account*amount/100:p.riskMode==='amount'?amount:null;
   quantity=validLevels&&pv&&sameCurrency&&requestedRisk?requestedRisk/(risk*pv):null;
   if(quantity!=null&&!Number.isFinite(quantity)){quantity=null;warnings.push('Sizing exceeds the supported numeric range');}
   if(quantity&&step)quantity=Math.floor((quantity+step*1e-9)/step)*step;
   if(quantity===0){quantity=null;warnings.push('Risk budget is smaller than one quantity step');}
  }
  if(quantity&&!pv)missing.push('pointValue');
  if(quantity&&pv&&!p.quoteCurrency)missing.push('quoteCurrency');
  const monetary=validLevels&&quantity&&pv&&p.quoteCurrency;
  const outcome=evaluator?evaluator(s,bars||[]):null;
  const distance=measurement(s,symbol,outcome);
  if(distance.note)warnings.push(distance.note);
  const riskMoney=monetary&&risk>0?risk*quantity*pv:null;
  const rewardMoney=monetary&&reward>0?reward*quantity*pv:null;
  const pnlMoney=monetary&&outcome?.pnl!=null?outcome.pnl*quantity*pv:null;
  const notional=monetary?Math.abs(s.entry)*quantity*pv:null;
  return {risk,reward,rr:risk>0?reward/risk:null,quantity,requestedRisk,riskMoney,rewardMoney,pnlMoney,
   measurement:distance,riskPips:distance.pipSize?distance.risk:null,rewardPips:distance.pipSize?distance.reward:null,pnlPips:distance.pipSize?distance.pnl:null,
   notional,margin:lev&&notional!=null?notional/lev:null,currency:p.quoteCurrency||null,
   riskPercent:account&&sameCurrency&&riskMoney!=null?riskMoney/account*100:null,
   missing:[...new Set(missing)],warnings,outcome};
 }
 const api={defaults,fields:Object.keys(defaults),normalize,statistics,containingTime,measurement};
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.BTT2Positions=api;
 if(typeof Renderer==='undefined'||typeof Store==='undefined')return;
 const bars=()=>typeof app!=='undefined'?app.renderedBars||[]:[];
 const evaluate=(s,b)=>typeof PositionTools!=='undefined'?PositionTools.evaluate(s,b):null;
 api.statistics=(s,b)=>statistics(s,b||bars(),evaluate,typeof app!=='undefined'?app.symbol:undefined);
 const baseCapture=TemplateStore.capture;
 TemplateStore.capture=function(s){const t=baseCapture.call(this,s);if(isPosition(s)){
  const p={...defaults,...s.position};t.position=Object.fromEntries(Object.keys(defaults).map(k=>[k,p[k]]));
 }return t;};
 const baseAdd=Store.add;
 Store.add=function(s){if(isPosition(s)){
  const prefs=TemplateStore.activeFor(s.type)?.position;
  if(prefs)s.position={...prefs,...s.position};normalize(s,bars());
 }return baseAdd.call(this,s);};
 const baseLoad=Store.load;
 Store.load=function(){const result=baseLoad.call(this);for(const shapes of Object.values(this.bySymbol))for(const s of shapes||[])normalize(s);return result;};
 function rgba(hex,a){const n=parseInt(hex.slice(1),16);return `rgba(${n>>16},${n>>8&255},${n&255},${a})`;}
 const textPrice=v=>typeof formatPrice==='function'?formatPrice(v):Number(v).toFixed(5);
 function short(v,d=2){return Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:d}):'—';}
 Renderer.drawPosition=function(s){
  // Rendering may sanitize legacy fields for display, but must not change
  // saved objects or create history entries merely because the chart repaints.
  s=normalize({...s,points:s.points?.map(point=>({...point})),position:{...s.position}},bars());const p=s.position;
  const ctx=canvas.getContext('2d');
  const x0=Coords.positionXAtTime(s.points?.[0]?.time),x1=Coords.positionXAtTime(s.endTime);
  const ye=Coords.priceToY(s.entry),yt=Coords.priceToY(s.tp),ys=Coords.priceToY(s.sl);
  if([x0,x1,ye,yt,ys].some(v=>!Number.isFinite(v)))return;
  const pane=root.BTT2Drawing?.plotRect?.();
  const plotRight=pane?.right??app.chart?.timeScale().width?.()??Math.max(1,canvas.clientWidth-65);
  const plotBottom=pane?.bottom??app.chart?.paneSize?.(0)?.height??Math.max(1,canvas.clientHeight-28);
  const left=Math.min(x0,x1),right=Math.max(x0,x1),width=Math.max(1,right-left);
  ctx.save();ctx.beginPath();ctx.rect(0,0,plotRight,plotBottom);ctx.clip();
  ctx.setLineDash([]);ctx.lineWidth=p.lineWidth;
  for(const [y,color] of [[yt,p.targetColor],[ys,p.stopColor]]){
   ctx.fillStyle=rgba(color,p.opacity);ctx.fillRect(left,Math.min(ye,y),width,Math.abs(y-ye));
   ctx.strokeStyle=color;ctx.strokeRect(left,Math.min(ye,y),width,Math.abs(y-ye));
  }
  ctx.strokeStyle=typeof Theme!=='undefined'&&Theme.current==='dark'?'#d1d4dc':'#363a45';
  ctx.beginPath();ctx.moveTo(left,ye);ctx.lineTo(right,ye);ctx.stroke();
  if(!s.selected&&!p.showAlways){ctx.restore();return;}
  const info=api.statistics(s),o=info.outcome||{},r=info.rr;
  const pct=v=>s.entry?short(v/Math.abs(s.entry)*100)+'%':'—';
  const money=v=>v!=null?' · '+short(v)+' '+info.currency:'';
  const distance=info.measurement,units=distance.unit;
  const distanceText=value=>short(value,units==='pips'?2:8);
  const riskText=`Stop: ${distanceText(distance.risk)} ${units} · ${textPrice(s.sl)}`+(p.compact?'':` · ${pct(info.risk)}${money(info.riskMoney)}`);
  const rewardText=`Target: ${distanceText(distance.reward)} ${units} · ${textPrice(s.tp)}`+(p.compact?'':` · ${pct(info.reward)}${money(info.rewardMoney)}`);
  const state=['Target hit','Stop hit'].includes(o.status)?'Closed P&L':o.status==='Open'?'Open P&L':o.status||'Waiting';
  const center=`${state}${o.pnl!=null?': '+distanceText(distance.pnl)+' '+units:''} · R/R ${short(r)}${info.quantity?' · Qty '+short(info.quantity,6):''}${money(info.pnlMoney)}`;
  const rows=[{text:rewardText,color:p.targetColor,y:yt,side:yt<ye?-1:1},{text:center,color:'#434651',y:ye,side:0},{text:riskText,color:p.stopColor,y:ys,side:ys<ye?-1:1}];
  if(info.missing.length)rows.push({text:'Sizing needs '+info.missing.join(', '),color:'#6b5b24',y:ye+45,side:1});
  if(info.warnings.length)rows.push({text:info.warnings.join(' · '),color:'#8d4b25',y:ye+66,side:1});
  ctx.font='11px -apple-system,Segoe UI,Arial,sans-serif';ctx.textBaseline='middle';ctx.textAlign='left';
  const padding=7,rowHeight=19,maxWidth=Math.max(60,Math.min(380,plotRight-12));
  // Word-wrap instead of hiding values with ellipses. Place labels away from
  // selected handles and resolve collisions with every earlier label.
  const placed=[];
  for(const row of rows){
   const words=row.text.split(' '),lines=[];let line='';
   for(const word of words){const next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>maxWidth-2*padding){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);
   const w=Math.min(maxWidth,Math.max(45,...lines.map(t=>ctx.measureText(t).width+padding*2))),h=lines.length*rowHeight;
   let lx=(left+right-w)/2,ly=row.side<0?row.y-h-9:row.side>0?row.y+9:row.y-h/2;
   if(row.side===0){if(right+w+14<plotRight)lx=right+12;else if(left-w-14>0)lx=left-w-12;else ly=ye+10;}
   lx=Math.max(4,Math.min(plotRight-w-4,lx));ly=Math.max(3,Math.min(plotBottom-h-3,ly));
   const collides=(x,y)=>placed.some(b=>x<b.x+b.w+3&&x+w+3>b.x&&y<b.y+b.h+3&&y+h+3>b.y);
   if(collides(lx,ly)){let found=false;for(let n=1;n<60&&!found;n++){for(const sign of [1,-1]){const y=ly+sign*n*(rowHeight+3);if(y>=3&&y+h<=plotBottom-3&&!collides(lx,y)){ly=y;found=true;break;}}}}
   placed.push({x:lx,y:ly,w,h});ctx.fillStyle=row.color;ctx.fillRect(lx,ly,w,h);ctx.fillStyle='#fff';
   lines.forEach((line,i)=>ctx.fillText(line,lx+padding,ly+rowHeight*(i+.5)));
  }
  ctx.restore();
  // Draw price tags in the scale margin after restoring the pane clip.
  if(p.showPriceLabels){
   ctx.save();ctx.font='10px -apple-system,Segoe UI,Arial,sans-serif';ctx.textBaseline='middle';ctx.textAlign='left';
   const tags=[{y:yt,value:s.tp,color:p.targetColor},{y:ye,value:s.entry,color:'#434651'},{y:ys,value:s.sl,color:p.stopColor}].sort((a,b)=>a.y-b.y);
   let last=-Infinity;
   for(const tag of tags){if(tag.y<0||tag.y>plotBottom)continue;const ty=Math.max(9,Math.min(plotBottom-9,Math.max(tag.y,last+19)));last=ty;
    const t=textPrice(tag.value),w=ctx.measureText(t).width+10;ctx.fillStyle=tag.color;ctx.fillRect(Math.max(plotRight,canvas.clientWidth-w),ty-9,w,18);ctx.fillStyle='#fff';ctx.fillText(t,Math.max(plotRight,canvas.clientWidth-w)+5,ty);
   }ctx.restore();
  }
 };
})(typeof globalThis!=='undefined'?globalThis:this);
