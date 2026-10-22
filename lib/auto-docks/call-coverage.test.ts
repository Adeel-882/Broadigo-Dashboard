import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
const mocks=vi.hoisted(()=>({execute:vi.fn(),ingest:vi.fn()}));
vi.mock('./service',()=>({autoDockDb:()=>({execute:mocks.execute}),readAutoDockSettings:async()=>({workspaceId:'workspace'}),resultRows:(r:unknown)=>r}));
vi.mock('@/lib/slack/ingest',()=>({ingestSlackHistoryBatch:mocks.ingest}));
import {fetchCallDay,syncCallDay} from './call-coverage';
import {AUTO_DOCK_CALL_CHANNEL_IDS} from './policy';
const response=(body:unknown)=>new Response(JSON.stringify(body));
describe('complete canonical call-channel coverage',()=>{
  beforeEach(()=>{vi.stubEnv('SLACK_BOT_TOKEN','test-only');mocks.execute.mockReset().mockResolvedValue([]);mocks.ingest.mockReset().mockResolvedValue({imported:0});});
  afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
  it('reads every page, includes start and excludes next business-day start',async()=>{
    const start=Date.parse('2026-10-16T14:00:00Z')/1000,end=start+32400;
    const fetchMock=vi.fn().mockResolvedValueOnce(response({ok:true,messages:[{ts:String(start)}],has_more:true,response_metadata:{next_cursor:'next'}})).mockResolvedValueOnce(response({ok:true,messages:[{ts:String(end-1)},{ts:String(end)}]}));
    vi.stubGlobal('fetch',fetchMock);
    expect((await fetchCallDay('C0BADNJL14L','2026-10-16')).map(m=>m.ts)).toEqual([String(start),String(end-1)]);
    expect(fetchMock.mock.calls[1][0]).toContain('cursor=next');
  });
  it.each([{ok:false,error:'not_in_channel'},{ok:true,messages:[],has_more:true},{ok:true}])('never certifies unavailable or partial history: %j',async body=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(body)));
    await expect(syncCallDay('2026-10-16',true)).rejects.toThrow();
    expect(mocks.ingest).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('fetches all three channels before importing any, so third-channel denial blocks writes',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(response({ok:true,messages:[]})).mockResolvedValueOnce(response({ok:true,messages:[]})).mockResolvedValueOnce(response({ok:false,error:'not_in_channel'})));
    await expect(syncCallDay('2026-10-16',true)).rejects.toThrow('not_in_channel');
    expect(mocks.ingest).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('dry-run uses existing source identity and ignores thread replies',async()=>{
    const ts=String(Date.parse('2026-10-16T15:00:00Z')/1000);
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>response({ok:true,messages:[{ts,text:'Call scheduled',user:'U1'},{ts:String(+ts+1),thread_ts:ts,text:'reply',user:'U1'}]})));
    mocks.execute.mockResolvedValue([{slack_ts:ts,parser_status:'PARSED'}]);
    const result=await syncCallDay('2026-10-16');
    expect(result.results.map(r=>r.pending)).toEqual([0,0,0]);expect(mocks.ingest).not.toHaveBeenCalled();
  });
  it('SQL trigger source registry matches the canonical runtime source set',()=>{
    const migration=readFileSync('drizzle/0013_auto_dock_third_channel.sql','utf8');
    const seed=migration.match(/INSERT INTO auto_dock_call_sources VALUES ([^;]+)/)![1];
    expect([...seed.matchAll(/'([^']+)'/g)].map(m=>m[1])).toEqual([...AUTO_DOCK_CALL_CHANNEL_IDS]);
  });
  it('refuses to certify an empty channel without its canonical parser mapping',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>response({ok:true,messages:[]})));
    await expect(syncCallDay('2026-10-16',true)).rejects.toThrow('active canonical appointment parser');
    expect(mocks.execute).toHaveBeenCalledTimes(1);expect(mocks.ingest).not.toHaveBeenCalled();
  });
  it('certifies all three empty channels but does not replay settled ingestion',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>response({ok:true,messages:[]})));
    mocks.execute.mockResolvedValueOnce(AUTO_DOCK_CALL_CHANNEL_IDS.map(id=>({slack_channel_id:id,parser_type:'leadsedge-appointment'})));
    const result=await syncCallDay('2026-10-16',true);
    expect(result.complete).toBe(true);expect(result.results).toHaveLength(3);
    expect(mocks.execute).toHaveBeenCalledTimes(7);expect(mocks.ingest).not.toHaveBeenCalled();
  });
  it('reconsiders an unparsed valid call but not ordinary conversation',async()=>{
    const ts=String(Date.parse('2026-10-20T15:16:42Z')/1000);
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>response({ok:true,messages:[{ts,text:'Call schedule from TX for tomorrow at 10 AM CST with John +1234567890',user:'U1'},{ts:String(+ts+1),text:'schedule this later',user:'U1'}]})));
    mocks.execute.mockResolvedValue([{slack_ts:ts,parser_status:'UNPARSED'},{slack_ts:String(+ts+1),parser_status:'UNPARSED'}]);
    expect((await syncCallDay('2026-10-20')).results.map(r=>r.pending)).toEqual([1,1,1]);
    mocks.execute.mockResolvedValue([{slack_ts:ts,parser_status:'PARSED'},{slack_ts:String(+ts+1),parser_status:'UNPARSED'}]);
    expect((await syncCallDay('2026-10-20')).results.map(r=>r.pending)).toEqual([0,0,0]);
  });

});
