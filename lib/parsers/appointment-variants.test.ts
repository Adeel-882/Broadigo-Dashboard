import {describe,it,expect} from 'vitest';
import {parserRegistry} from './registry';
const parse=(text:string)=>parserRegistry.parse('broadigo-appointment',{rawSourceId:'source',text,postedAt:new Date('2026-10-20T15:16:42Z'),employeeId:'zack'});
describe('canonical call wording',()=>{
 const samples=[
 'Call schedule from Fl for tomorrow at 12 PM EST with Samuel +17866135432',
 'Call schedule from ON(Toronto) for tomorrow at 10:30 AM EST with Renee Bovos +14162200321 assigned to @Dameon Wolfe',
 'Call scheduled from TX for tomorrow at 10 AM CST with John +1234567890',
 'Call schedule from TX for tomorrow at 10 AM CST with John +1234567890',
 'CALL SCHEDULE FROM TX FOR TOMORROW AT 10 AM CST WITH JOHN +1234567890',
 'Call scheduled from TX for today at 2 PM CST with Ukima Wallace <tel:+16822198879|+16822198879>'
 ];
 it.each(samples)('accepts %s',text=>{expect(parse(text)?.recordType).toBe('APPOINTMENT');expect(parse(text)?.values.prospectName).toBeTruthy();});
 it.each(['schedule this later','we need to call him','Call schedule','Call schedule with no phone'])('rejects %s',text=>expect(parse(text)).toBeNull());
 it.each(samples.slice(0,2))('accepts original Slack phone markup too',text=>expect(parse(text.replace(/(\+\d+)/,'<tel:$1|$1>'))?.recordType).toBe('APPOINTMENT'));
});
