/* Display adapter. Existing BTT drawing/replay coordinates remain WAT-clock
 * coordinates (UTC + 3600). Never shift candles or saved drawings for a label.
 * CSV unix time remains authoritative; timezone formatting is display-only. */
(function(root){
 'use strict';
 const OFFSET=3600, DAY=86400;
 const formatters=new Map();
 function parts(sec,zone){
   if(!formatters.has(zone)) formatters.set(zone,new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));
   return Object.fromEntries(formatters.get(zone).formatToParts(new Date(sec*1000)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 }
 function utc(time){return Number(time)-OFFSET;}
 function wall(sec,zone){const p=parts(sec,zone);return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)/1000;}
 function fromWall(sec,zone){let guess=sec;for(let i=0;i<4;i++)guess+=sec-wall(guess,zone);return guess;}
 function dateStamp(time,tf,forex,zone='UTC'){
   const stamp=utc(time);
   if(['1d','1w','1mo','3mo'].includes(tf)){
     // FOREX.com's evening session belongs to the following trading date.
     // NY calendar conversion handles DST; other feeds retain their UTC date.
     const p=parts(stamp,forex?'America/New_York':'UTC');
     return Date.UTC(+p.year,+p.month-1,+p.day+(forex&&+p.hour>=17?1:0))/1000;
   }
   return wall(stamp,zone);
 }
 function iso(time,tf,forex,zone='UTC') {return new Date(dateStamp(time,tf,forex,zone)*1000).toISOString().slice(0,['1d','1w','1mo','3mo'].includes(tf)?10:16).replace('T',' ');}
 function crosshair(time,tf,forex,zone='UTC'){
   const d=new Date(dateStamp(time,tf,forex,zone)*1000);
   const date=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'2-digit'}).format(d);
   return date+(['1d','1w','1mo','3mo'].includes(tf)?'':'  '+d.toISOString().slice(11,16));
 }
 function tick(time,type,tf,forex,zone='UTC'){
   const d=new Date(dateStamp(time,tf,forex,zone)*1000);
   if(type===0)return String(d.getUTCFullYear());
   if(type===1)return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',month:'short'}).format(d);
   if(type===2||['1d','1w','1mo','3mo'].includes(tf))return String(d.getUTCDate());
   return d.toISOString().slice(11,type===4?19:16);
 }
 function weekBounds(time,forex,openHour=17){
   const local=wall(utc(time),forex?'America/New_York':'UTC');
   const d=new Date(local*1000);const date=Math.floor(local/DAY)*DAY;
   let start;
   if(forex){start=date-d.getUTCDay()*DAY+openHour*3600;if(local<start)start-=7*DAY;}
   else start=date-((d.getUTCDay()+6)%7)*DAY;
   return {start:fromWall(start,forex?'America/New_York':'UTC')+OFFSET,end:fromWall(start+7*DAY,forex?'America/New_York':'UTC')+OFFSET};
 }
 function findDate(rows,date,tf,forex,zone){
   let previous=0;
   for(let i=0;i<rows.length;i++){const key=iso(rows[i].time,tf,forex,zone).slice(0,10);if(key===date)return i;if(key>date)break;previous=i;}
   return previous;
 }
 const api={OFFSET,utc,parts,wall,fromWall,dateStamp,iso,crosshair,tick,weekBounds,findDate};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.BttTime=api;
})(typeof globalThis!=='undefined'?globalThis:this);
