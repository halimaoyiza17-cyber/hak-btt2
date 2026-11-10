/* Drawing measurements only: no orders, fees, currency conversion or execution. */
(function(root){
 function evaluate(s,bars){
  const dir=s.type==='short'?-1:1, risk=dir*(s.entry-s.sl),reward=dir*(s.tp-s.entry);
  const result={risk,reward,rr:risk>0?reward/risk:null,status:'Waiting',pnl:null,r:null,price:null};
  if(![s.entry,s.tp,s.sl,risk,reward].every(Number.isFinite)||risk<=0||reward<=0)return {...result,status:'Invalid levels'};
  // Derive the containing candle from the CURRENT anchor. Saved startBarTime
  // is display metadata and may refer to the old location after a body drag.
  const anchor=s.points?.[0]?.time;
  if(!Number.isFinite(anchor))return {...result,status:'Invalid dates'};
  let start=anchor;
  if(bars.length&&anchor>=bars[0].time&&anchor<=bars[bars.length-1].time){
   let lo=0,hi=bars.length;while(lo<hi){const m=(lo+hi)>>1;if(bars[m].time<=anchor)lo=m+1;else hi=m;}
   start=bars[Math.max(0,lo-1)].time;
  }
  const end=s.endTime??Infinity;
  if((end!==Infinity&&!Number.isFinite(end))||end<anchor)return {...result,status:'Invalid dates'};
  let active=false,last=null;
  // Include the containing candle, but never assert its exit order when the
  // left edge is inside it: the observed high/low may predate the drawing.
  for(const b of bars){
   if(b.time<start||b.time>end)continue;
   last=b;
   const entry=b.low<=s.entry&&b.high>=s.entry;
   const target=dir===1?b.high>=s.tp:b.low<=s.tp;
   const stop=dir===1?b.low<=s.sl:b.high>=s.sl;
   const wasActive=active;
   if(!active&&entry)active=true;
   if(!active)continue;
    if((target&&stop)||(!wasActive&&(b.open!==s.entry||b.time<anchor)&&(target||stop))){return {...result,status:'Ambiguous',price:b.close};}
   if(target||stop){const price=target?s.tp:s.sl,pnl=dir*(price-s.entry);return {...result,status:target?'Target hit':'Stop hit',price,pnl,r:pnl/risk};}
  }
  if(last){const pnl=dir*(last.close-s.entry);return {...result,status:active?'Open':'Awaiting entry',price:last.close,pnl:active?pnl:null,r:active?pnl/risk:null};}
  return result;
 }
 const api={evaluate};if(typeof module==='object'&&module.exports)module.exports=api;else root.PositionTools=api;
})(typeof globalThis!=='undefined'?globalThis:this);
