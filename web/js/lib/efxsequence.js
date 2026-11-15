// Native metadata uses page roles, not ascending page numbers.
// 49FE00 derives the per-result interval; 49FD5C/4A08E9 start the result
// page once for each result record. 50A293 gates last-result-only events.
export function sequencePages(meta,{charge=30,release,results=1}={}){
  const pages=[],add=(id,start,role,result=-1)=>{if(id)pages.push({id,start:Math.max(0,start),role,result});};
  add(meta.initialPage,meta.cueFrames[0],'initial');
  for(let i=0;i<meta.cuePages.length;i++)add(meta.cuePages[i],charge+meta.cueFrames[i+1],`cue ${i}`);
  const first=release??charge+meta.resultFrame;
  const interval=Math.max(1,meta.intervalFromResultEnd?meta.resultEndFrame-meta.resultFrame:meta.resultFrame-meta.cueFrames[1]);
  if(meta.resultPage){
    const count=meta.perResult?Math.max(1,Math.min(32,results)):1;
    for(let i=0;i<count;i++)add(meta.resultPage,first+i*interval,'result',i);
  }
  // Finish pages wait for children in the game. This envelope is only a
  // preview boundary until all sequence termination events are interpreted.
  if(meta.finishPage){
    const end=Math.max(first,...pages.map(p=>p.start+Math.max(0,...meta.schedulers.filter(s=>s.page===p.id).map(s=>s.end))));
    add(meta.finishPage,end,'finish');
  }
  return pages;
}
