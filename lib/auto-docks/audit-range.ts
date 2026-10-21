import {businessWindow,latestClosedBusinessDate} from './policy';
export function auditRange(params:URLSearchParams){
  const single=params.get('date')??latestClosedBusinessDate();
  const from=params.get('from')??single,to=params.get('to')??single;
  if(params.has('from')!==params.has('to'))throw new Error('Both From and To are required');
  const start=businessWindow(from).start,end=businessWindow(to).start;
  const count=(end.getTime()-start.getTime())/86400000+1;
  if(count<1||count>90)throw new Error('Choose an ordered range of at most 90 business days');
  return {from,to,days:Array.from({length:count},(_,i)=>new Date(start.getTime()+i*86400000).toISOString().slice(0,10))};
}
