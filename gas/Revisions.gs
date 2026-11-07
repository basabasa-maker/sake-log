/* Revision-v1: append-only edits. No updateCells to the source log. Default off.
 * Source structural/content changes are conflicts, never repaired from history. */
var REVISION_V1={name:'日本酒ログ_改訂履歴_v1',header:'改訂イベントJSON_v1',maxEvents:10000,maxEventChars:45000,viewName:'日本酒ログ_最新内容_v1'};
function revisionAnchorKey_(source){return 'SAKE_REVISION_V1_'+digest_(source).slice(0,20)+'_MANIFEST';}
function revisionUses_(source){return prop_('REVISION_ENABLED')==='true'||!!prop_(revisionAnchorKey_(source));}
function revisionHash_(event){var copy=Object.assign({},event);delete copy.hash;return digest_(sorted_(copy));}
function revisionManifest_(events){return digest_(events.map(function(e){return e.hash;}).sort());}
function revisionTable_(source,expected){
  var rawPending=prop_(saveKeys_(source,'').pending),pendingRevision=rawPending?JSON.parse(rawPending):null;if(!expected&&pendingRevision&&pendingRevision.kind==='revisionV1')throw new Error('改訂の受付が未確定です。原本だけへ戻して表示しません');
  var raw=prop_(revisionAnchorKey_(source)),anchor=raw?JSON.parse(raw):null;
  var info=sheetApi_(source,'?fields=sheets.properties'),matches=(info.sheets||[]).filter(function(s){return s.properties.title===REVISION_V1.name;});
  if(!matches.length){if(anchor||expected)throw new Error('改訂履歴が欠落しています。原本へ戻した扱いにはしません');return{sheetId:null,events:[],heads:{}};}
  if(matches.length!==1)throw new Error('改訂履歴の保存先が一致しません');
  var id=matches[0].properties.sheetId,grid=freshAppendCells_(source,{getSheetId:function(){return id;}},["'"+REVISION_V1.name+"'!A1:B"+(REVISION_V1.maxEvents+2)]),events=[],byHash={},byId={},groups={},heads={};
  if(((grid[1]||[])[0]||{}).stringValue!==REVISION_V1.header)throw new Error('改訂履歴headerが変更されています');
  Object.keys(grid).forEach(function(n){var row=grid[n]||[];if(row.slice(1).some(function(v){return Object.keys(v||{}).length;}))throw new Error('改訂履歴に別列があります');if(+n===1||!Object.keys(row[0]||{}).length)return;
    var e;try{e=JSON.parse(row[0].stringValue);}catch(error){throw new Error('改訂履歴のJSON/式が不正です');}
    if(!e||typeof e.recordId!=='string'||!e.recordId||e.recordId.length>256||e.key!=='id2-'+digest_([source,e.tabId,e.recordId])||!Number.isInteger(e.originalRow)||e.originalRow<2||e.v!==1||e.source!==source||!Number.isInteger(e.tabId)||!/^id2-[a-f0-9]{64}$/.test(e.key||'')||!/^fp2-[a-f0-9]{64}$/.test(e.baseFingerprint||'')||!Number.isFinite(e.createdAt)||!/^op-[a-z0-9]+-[A-Za-z0-9_-]{20,100}$/.test(e.id||'')||!e.changes||typeof e.changes!=='object'||Array.isArray(e.changes)||!Array.isArray(e.headers)||['hash','digest','baseVersion','parentVersion','resultVersion'].some(function(k){return !/^[a-f0-9]{64}$/.test(e[k]||'');})||revisionHash_(e)!==e.hash||byHash[e.hash]||byId[e.id])throw new Error('改訂履歴の整合性を確認できません');
    Object.keys(e.changes).forEach(function(h){var cell=e.changes[h],keys=Object.keys(cell||{});if(e.headers.indexOf(h)<0||keys.length>1||keys.some(function(k){return ['stringValue','numberValue','boolValue'].indexOf(k)<0;})||(keys[0]==='numberValue'&&!Number.isFinite(cell.numberValue)))throw new Error('改訂値の形式が不正です');});
    byHash[e.hash]=e;byId[e.id]=e;(groups[e.key]||(groups[e.key]=[])).push(e);events.push(e);
  });
  if(events.length>REVISION_V1.maxEvents)throw new Error('改訂履歴の上限です。自動削除しません');
  Object.keys(groups).forEach(function(key){var group=groups[key],children={},roots=[];
    group.forEach(function(e){if(e.previous==='none'){if(e.parentVersion!==e.baseVersion)throw new Error('改訂の開始版が不正です');roots.push(e);}else{var parent=byHash[e.previous];if(!parent||parent.key!==key||parent.baseVersion!==e.baseVersion||parent.baseFingerprint!==e.baseFingerprint||parent.resultVersion!==e.parentVersion||children[e.previous])throw new Error('改訂履歴が欠損または分岐しています');children[e.previous]=e;}});
    if(roots.length!==1)throw new Error('改訂履歴の開始点が不正です');var current=roots[0],ordered=[current];while(children[current.hash]){current=children[current.hash];ordered.push(current);if(ordered.length>group.length)throw new Error('改訂が循環しています');}if(ordered.length!==group.length)throw new Error('改訂履歴が連続しません');heads[key]={event:current,chain:ordered};
  });
  var pendingRaw=prop_(saveKeys_(source,'').pending),pending=pendingRaw?JSON.parse(pendingRaw):null,proof=expected&&pending&&pending.id===expected.id?{sheetId:expected.revisionSheetId,count:expected.revisionCount,digest:expected.revisionDigest}:anchor;
  if(!proof||proof.sheetId!==id||proof.count!==events.length||proof.digest!==revisionManifest_(events))throw new Error('改訂履歴と保存確認が一致しません。履歴欠損を原本への復帰と扱いません');
  return{sheetId:id,events:events,heads:heads};
}
function revisionSnapshot_(source,sh){
  var info=appendSourceInfo_(source,sh),title="'"+sh.getName().replace(/'/g,"''")+"'!",grid={},formats={};
  var fresh=sheetApi_(source,'?includeGridData=true&ranges='+encodeURIComponent(title+'A1:'+colName_(info.columns)+info.rows)+'&fields=sheets(properties(sheetId),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveFormat(numberFormat)))))');
  (fresh.sheets||[]).filter(function(s){return s.properties.sheetId===sh.getSheetId();}).forEach(function(s){(s.data||[]).forEach(function(block){(block.rowData||[]).forEach(function(row,y){var n=(block.startRow||0)+y+1;grid[n]=grid[n]||[];formats[n]=formats[n]||[];(row.values||[]).forEach(function(cell,x){var c=(block.startColumn||0)+x;grid[n][c]=cell.userEnteredValue||{};formats[n][c]=cell.effectiveFormat&&cell.effectiveFormat.numberFormat&&cell.effectiveFormat.numberFormat.type;});});});});
  var cells=grid[1]||[],end=cells.length;while(end&&!Object.keys(cells[end-1]||{}).length)end--;var headers=cells.slice(0,end).map(function(c){return c.stringValue||'';}),data=[],formulas=[],dateDisplays={};
  var last=Math.max.apply(null,Object.keys(grid).map(Number));for(var row=2;row<=last;row++){var values=[],expressions=[];for(var c=0;c<headers.length;c++){var v=(grid[row]||[])[c]||{};expressions[c]=v.formulaValue||'';values[c]=expressions[c]?'式: '+expressions[c]:'stringValue'in v?v.stringValue:'numberValue'in v?v.numberValue:'boolValue'in v?v.boolValue:'';}if((grid[row]||[]).slice(headers.length).some(function(v){return Object.keys(v||{}).length;}))throw new Error('列名のない原本セルがあります');var dateCol=headers.indexOf('日付');if(dateCol>=0&&typeof values[dateCol]==='number'&&['DATE','DATE_TIME'].indexOf((formats[row]||[])[dateCol])>=0){var day=new Date(Date.UTC(1899,11,30)+Math.floor(values[dateCol])*86400000);if(!isFinite(day.getTime()))throw new Error('原本の日付を確認できません');dateDisplays[row]=day.toISOString().slice(0,10);}data.push(values);formulas.push(expressions);}
  return{source:source,tabId:sh.getSheetId(),headers:headers,data:data,formulas:formulas,dateDisplays:dateDisplays};
}
function revisionContext_(source,sh,stateTable,expected){
  var quarantineKey='SAKE_REVISION_CONFLICT_V1_'+digest_(source).slice(0,20),rawQuarantine=prop_(quarantineKey),quarantine=rawQuarantine?JSON.parse(rawQuarantine):{},quarantineDirty=false;if(!quarantine||typeof quarantine!=='object'||Array.isArray(quarantine))throw new Error('改訂競合の保持情報が不正です');
  function suspend(key,head){if(!quarantine[key]){quarantine[key]={head:head,observedAt:Date.now()};quarantineDirty=true;}}
  var snapshot=revisionSnapshot_(source,sh),table=revisionTable_(source,expected),index=stateIndex_(source,sh,stateTable,snapshot),projected={source:source,tabId:snapshot.tabId,headers:snapshot.headers.slice(),data:snapshot.data.map(function(r){return r.slice();}),formulas:snapshot.formulas.map(function(r){return r.slice();})},matched={},conflicts=0;
  index.entries.forEach(function(entry){entry.baseVersion=entry.sourceVersion;entry.revisionVersion='none';entry.revisionReason=entry.reason;var group=table.heads[entry.key];if(!group)return;
    var head=group.event;matched[entry.key]=true;
    if(entry.reason||head.tabId!==snapshot.tabId||head.baseVersion!==entry.baseVersion||head.baseFingerprint!==entry.fingerprint||JSON.stringify(head.headers)!==JSON.stringify(snapshot.headers)){suspend(entry.key,head.hash);entry.revisionReason='原本が外部変更/移動/重複されています。改訂を別内容へ適用しません';conflicts++;return;}
    if(quarantine[entry.key]){entry.revisionReason='原本の変更/欠落を検出済みです。元に戻っても改訂を自動再適用しません。管理者の照合が必要です';conflicts++;return;}
    group.chain.forEach(function(e){Object.keys(e.changes).forEach(function(h){var c=snapshot.headers.indexOf(h),v=e.changes[h];if(projected.formulas[entry.row-2][c])throw new Error('改訂が原本の式を上書きしています');projected.data[entry.row-2][c]='stringValue'in v?v.stringValue:'numberValue'in v?v.numberValue:'boolValue'in v?v.boolValue:'';});if(recordVersion_(snapshot.headers,projected.data[entry.row-2],projected.formulas[entry.row-2])!==e.resultVersion)throw new Error('改訂の結果内容版が一致しません');});
    entry.sourceVersion=head.resultVersion;entry.revisionVersion=head.hash;
  });
  index.entries.forEach(function(e){var head=stateTable.heads[e.key];if(head&&head.v===3&&head.revisionHead!==e.revisionVersion&&!e.revisionReason)throw new Error('改訂と一覧状態の組合せが一致しません。自動適用しません');});
  var detached=Object.keys(table.heads).filter(function(key){if(!matched[key]){suspend(key,table.heads[key].event.hash);return true;}return false;}).length;conflicts+=detached;
  if(quarantineDirty){var serialized=JSON.stringify(quarantine);if(serialized.length>7500)throw new Error('競合情報の安全上限です。自動削除しません');PropertiesService.getScriptProperties().setProperty(quarantineKey,serialized);}
  return{snapshot:snapshot,projected:projected,index:index,table:table,conflicts:conflicts,stateTable:stateTable};
}
function revisionResponse_(source,sh,b,stateTable,expected){
  var ctx=revisionContext_(source,sh,stateTable,expected),response=baseList_(ctx.projected),capable=!!(b&&b.includeTrash===true&&b.recordStateContract==='state-v3'),revisionCapable=!!(b&&b.revisionContract==='revision-v1');
  if(ctx.table.events.length&&!revisionCapable)throw new Error('保存された改訂があります。更新版アプリで一覧を同期してください');
  if(!capable&&ctx.index.notice)throw new Error('一覧状態が競合しています。更新版アプリで確認してください');
  response.recordStateFormat=capable?'state-v3':'';response.recordStateEnabled=prop_('RECORD_STATE_ENABLED')==='true';response.revisionFormat='revision-v1';response.revisionEnabled=prop_('REVISION_ENABLED')==='true';response.revisionNotice=ctx.conflicts?'原本の変更/欠落等で適用しない改訂が'+ctx.conflicts+'件あります。履歴は保持しています':'';response.stateNotice=[ctx.index.notice,response.revisionNotice].filter(Boolean).join(' / ');
  response.records=response.records.map(function(r){var e=ctx.index.entries.filter(function(e){return e.row===r.row;})[0];if(!e)throw new Error('改訂対象を識別できません');if(ctx.snapshot.dateDisplays[r.row]&&typeof r.date==='number')r.date=ctx.snapshot.dateDisplays[r.row];r.sourceVersion=e.sourceVersion;r.baseVersion=e.baseVersion;r.revisionVersion=e.revisionVersion;r.revisionFormat='revision-v1';r.revisionReason=e.revisionReason||(response.revisionEnabled?'':'改訂保存は準備/停止中です。閲覧のみ利用できます');r.revisionEligible=revisionCapable&&response.revisionEnabled&&!e.revisionReason&&!e.deletedAt;r.deletedAt=e.deletedAt;r.pinned=e.pinned;r.archived=e.archived;r.sortOrder=e.sortOrder;r.stateMissingId=!e.id;r.stateReason=e.reason;r.stateEligible=capable&&response.recordStateEnabled&&!e.reason&&!e.revisionReason;if(capable){r.recordKey=e.key;r.stateVersion=e.stateVersion;}return(r.deletedAt||r.archived)&&!capable?null:r;}).filter(Boolean);return{response:response,ctx:ctx};
}
function actionList_(b){
  var source=String(prop_('SHEET_ID')||'');if(!revisionUses_(source)){var r=legacyActionList_(b);r.revisionFormat='revision-v1';r.revisionEnabled=false;r.records.forEach(function(x){x.revisionFormat='revision-v1';x.revisionVersion='none';x.baseVersion=x.sourceVersion;x.revisionEligible=false;x.revisionReason='改訂保存の準備/有効化が未完了です';});return r;}
  var lock=LockService.getScriptLock();lock.waitLock(30000);try{return revisionResponse_(source,logSheet_(source),b,stateTable_(source,false)).response;}finally{lock.releaseLock();}
}
function revisionEdits_(rec,photos,ctx,target){
  var row=ctx.projected.data[target.row-2],formulas=ctx.projected.formulas[target.row-2],headers=ctx.snapshot.headers,changes={};
  function put(name,value){var c=headers.indexOf(name);if(c<0)throw saveError_('SCHEMA_PREPARATION_REQUIRED','改訂保存の必要列を先に準備してください');var v=value==null?'':value;if(name==='日付'&&ctx.snapshot.dateDisplays[target.row]===v&&typeof row[c]==='number')return;if(JSON.stringify(row[c]==null?'':row[c])===JSON.stringify(v))return;if(formulas[c])throw new Error('数式項目はアプリから編集できません: '+name);changes[name]=entered_(v);}
  Object.keys(KEYMAP).forEach(function(k){if(['recordId','updatedAt','fixedJson','estimatesJson','scale','bottleUrl','labelUrl'].indexOf(k)>=0)return;if(rec[k]!==undefined)put(KEYMAP[k],rec[k]);});
  if(rec.fixed!==undefined)put('確定項目',JSON.stringify(rec.fixed||[]));if(rec.estimates!==undefined)put('推定値JSON',JSON.stringify(rec.estimates||{}));
  var edits=validatedScoreEdits_(rec,false),meta={},col=headers.indexOf('評価尺度JSON');if(col>=0&&row[col]){try{meta=JSON.parse(row[col]);}catch(error){throw new Error('評価尺度のJSONを確認できません');}if(!meta||typeof meta!=='object'||Array.isArray(meta))throw new Error('評価尺度の形式が不正です');}
  Object.keys(edits).forEach(function(k){var before=meta[k],scoreCol=headers.indexOf(SCORE[k]),scaleCol=headers.indexOf('評価尺度'),previous={value:scoreCol<0?'':row[scoreCol],scale:before&&before.scale===10?10:scaleCol<0?'':row[scaleCol]};meta[k]={scale:10,origin:edits[k].origin,previous:previous,original:before&&before.original||previous};put(SCORE[k],edits[k].value);});if(Object.keys(edits).length)put('評価尺度JSON',JSON.stringify(meta));
  ['bottle','label'].forEach(function(k){if(photos[k]&&headers.indexOf(k==='bottle'?'写真URL':'ラベル写真URL')<0)throw saveError_('SCHEMA_PREPARATION_REQUIRED','写真参照列がありません');});
  put('更新日時',Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd HH:mm:ss'));return changes;
}
function revisionTarget_(ctx,rec){var matches=ctx.index.entries.filter(function(e){return e.key===rec.recordKey;});if(matches.length!==1||matches[0].revisionReason||matches[0].deletedAt)throw new Error('固定ID/原本版/ごみ箱状態が競合しているため保存しません');var e=matches[0];if(e.id!==String(rec.recordId)||e.baseVersion!==rec.baseVersion||e.sourceVersion!==rec.sourceVersion||e.revisionVersion!==rec.revisionVersion||e.stateVersion!==rec.stateVersion)throw new Error('内容または状態が更新されました。古い入力を上書きせず同期してください');return e;}
function verifyRevisionSave_(source,sh,journal){
  if(journal.phase!=='batch')return null;var table=revisionTable_(source,journal),e=table.events.filter(function(e){return e.id===journal.id&&e.digest===journal.digest&&e.hash===journal.eventHash;})[0];if(!e)return null;
  // Acknowledgement proves the immutable accepted edit, even if the source was
  // edited/deleted afterwards. It never pretends that the edit is still applied.
  var verifiedState=verifyRevisionStatePair3_(source,e,journal);var ctx=revisionContext_(source,sh,verifiedState,journal),target=ctx.index.entries.filter(function(t){return t.key===e.key&&!t.revisionReason&&t.baseVersion===e.baseVersion&&t.revisionVersion===e.hash;});
  var r={ok:true,revisionFormat:'revision-v1',revisionVersion:e.hash,baseVersion:e.baseVersion,sourceSheetId:source,sourceVersion:e.resultVersion,recordId:journal.recordId,recordKey:e.key,acceptedRevision:true,revisionConflict:target.length!==1,latestView:{status:'not-confirmed',message:'最新内容タブの更新は別途確認してください'}};
  if(target.length===1){r.row=target[0].row;r.stateVersion=target[0].stateVersion;r.recordStateFormat='state-v3';r.recordStateEnabled=prop_('RECORD_STATE_ENABLED')==='true';r.stateEligible=r.recordStateEnabled&&!target[0].reason&&!target[0].revisionReason;r.pinned=target[0].pinned;r.archived=target[0].archived;r.deletedAt=target[0].deletedAt;r.sortOrder=target[0].sortOrder;var current=baseList_(ctx.projected).records.filter(function(x){return x.row===r.row;})[0];r.bottleUrl=current.bottleUrl||'';r.labelUrl=current.labelUrl||'';}else r.row=journal.row;
  return r;
}
function actionRevisionSave_(b,checkOnly){
  if(!checkOnly&&b.recordStateContract!=='state-v3')throw new Error('アーカイブ対応の更新版アプリから保存してください');
  if(!checkOnly&&prop_('REVISION_ENABLED')!=='true')throw new Error('既存記録の改訂保存は準備/有効化待ちです。原本行は更新しません');
  var rec=b.record||{},photos=b.photos||{},source=String(prop_('SHEET_ID')||''),id=String(rec.saveOperationId||''),stamp=parseInt(id.split('-')[1],36);
  if(rec.sourceSheetId!==source||rec.revisionMode!=='revision-v1'||rec.scoreMode!=='preserve-v1'||!/^op-[a-z0-9]+-[A-Za-z0-9_-]{20,100}$/.test(id)||!isFinite(stamp)||(!checkOnly&&Math.abs(Date.now()-stamp)>7*86400000))throw new Error('更新版の改訂保存と取得元を確認してください');
  var digest=digest_(sorted_({record:rec,photos:photos})),lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    if(String(prop_('SHEET_ID')||'')!==source)throw new Error('接続先が変わりました');if(!checkOnly&&prop_('REVISION_ENABLED')!=='true')throw new Error('改訂保存は停止しました');var props=PropertiesService.getScriptProperties(),keys=saveKeys_(source,id),pending=props.getProperty(keys.pending),done=props.getProperty(keys.done),sh=logSheet_(source);
    if(pending){var old=JSON.parse(pending);if(checkOnly&&old.id!==id)throw saveError_('SAVE_UNKNOWN','別の保存が未確定です');if(old.id===id&&old.digest!==digest)throw new Error('同じ操作IDの内容が変わりました');var recovered=reconcileSave_(props,keys,old,source,sh);if(old.id===id)return recovered;throw saveError_('SAVE_REJECTED','前の保存は確認済みです。今回の操作は実行しません');}
    if(done){var previous=JSON.parse(done);if(previous.kind!=='revisionV1'||previous.digest!==digest)throw new Error('操作IDの内容が変わりました');var replay=verifyRevisionSave_(source,sh,previous);if(!replay)throw saveError_('SAVE_UNKNOWN','改訂の受付を確認できません。再送しません');return replay;}
    if(checkOnly){var history=revisionTable_(source),found=history.events.filter(function(e){return e.id===id&&e.digest===digest;})[0];if(!found)throw saveError_('SAVE_UNKNOWN','改訂の受付情報がありません。再送しません');var result=verifyRevisionSave_(source,sh,{kind:'revisionV1',phase:'batch',id:id,digest:digest,eventHash:found.hash,recordId:found.recordId,row:found.originalRow});if(!result)throw saveError_('SAVE_UNKNOWN','改訂の受付を確認できません');return result;}
    pruneSaveReceipts_(props);var ctx=revisionContext_(source,sh,stateTable_(source,false)),target=revisionTarget_(ctx,rec),changes=revisionEdits_(rec,photos,ctx,target);if(ctx.table.events.length>=REVISION_V1.maxEvents)throw new Error('改訂履歴の上限です。自動削除しません');if(JSON.stringify(changes).length>REVISION_V1.maxEventChars-3000)throw new Error('改訂内容が1件の安全上限を超えています');
    var journal={kind:'revisionV1',id:id,digest:digest,phase:'preparing',createdAt:Date.now(),recordId:target.id,row:target.row};props.setProperty(keys.pending,JSON.stringify(journal));var uploaded=false,dispatched=false;
    try{
      var stampText=Utilities.formatDate(new Date(),'Asia/Tokyo','yyyyMMdd-HHmmss');if(photos.bottle){changes['写真URL']=entered_(saveBlob_(photos.bottle,'bottle-'+stampText+'.jpg',source));uploaded=true;}if(photos.label){changes['ラベル写真URL']=entered_(saveBlob_(photos.label,'label-'+stampText+'.jpg',source));uploaded=true;}
      var values=ctx.projected.data[target.row-2].slice(),formulas=ctx.projected.formulas[target.row-2];Object.keys(changes).forEach(function(h){var v=changes[h];values[ctx.snapshot.headers.indexOf(h)]='stringValue'in v?v.stringValue:'numberValue'in v?v.numberValue:'boolValue'in v?v.boolValue:'';});
      var event={v:1,source:source,tabId:sh.getSheetId(),key:target.key,recordId:target.id,originalRow:target.row,baseVersion:target.baseVersion,baseFingerprint:target.fingerprint,previous:target.revisionVersion,parentVersion:target.sourceVersion,id:id,digest:digest,createdAt:Date.now(),pairedState:true,statePrevious:target.stateVersion,headers:ctx.snapshot.headers,changes:changes,resultVersion:recordVersion_(ctx.snapshot.headers,values,formulas)};event.hash=revisionHash_(event);if(JSON.stringify(event).length>REVISION_V1.maxEventChars)throw new Error('改訂履歴の1件上限です');
      var info=sheetApi_(source,'?fields=sheets.properties'),requests=[],numeric=ctx.table.sheetId;
      if(numeric===null){var used=(info.sheets||[]).map(function(s){return s.properties.sheetId;});numeric=1000000+Math.floor(Math.random()*2000000000);while(used.indexOf(numeric)>=0)numeric++;requests.push({addSheet:{properties:{sheetId:numeric,title:REVISION_V1.name,hidden:true}}});requests.push({appendCells:{sheetId:numeric,rows:[{values:[{userEnteredValue:{stringValue:REVISION_V1.header}}]}],fields:'userEnteredValue'}});}else if(!(info.sheets||[]).some(function(s){return s.properties.sheetId===numeric&&s.properties.title===REVISION_V1.name;}))throw new Error('改訂履歴の保存先が変わりました');
      requests.push({appendCells:{sheetId:numeric,rows:[{values:[{userEnteredValue:{stringValue:JSON.stringify(event)}}]}],fields:'userEnteredValue'}});var paired=prepareRevisionState3_(source,sh,ctx.stateTable,target,event,[numeric]);requests=requests.concat(paired.requests);Object.assign(journal,paired.journal);journal.phase='batch';journal.eventHash=event.hash;journal.revisionSheetId=numeric;journal.revisionCount=ctx.table.events.length+1;journal.revisionDigest=revisionManifest_(ctx.table.events.concat([event]));props.setProperty(keys.pending,JSON.stringify(journal));dispatched=true;
      try{sheetApi_(source,':batchUpdate','post',{requests:requests});}catch(error){if(error.code==='SAVE_REJECTED'&&!uploaded){props.deleteProperty(keys.pending);throw error;}}
      var result=reconcileSave_(props,keys,journal,source,sh);try{result.latestView=revisionView_(source,sh);}catch(viewError){result.latestView={status:'not-confirmed',message:'改訂は保存済みです。表示専用タブは未更新または結果不明: '+viewError.message};}return result;
    }catch(error){if(!dispatched&&!uploaded&&error.code!=='PHOTO_UNKNOWN'){props.deleteProperty(keys.pending);throw error;}if(error.code==='SAVE_REJECTED'&&!uploaded)throw error;throw saveError_('SAVE_UNKNOWN','改訂の保存結果が未確定です。再送せず受付を照合してください');}
  }finally{lock.releaseLock();}
}
/* Display-only projection: same file, never read as source. Existing editors
 * can technically edit it; their edits are disposable, not accepted revisions. */
function revisionViewKey_(source){return 'SAKE_REVISION_VIEW_V1_'+digest_(source).slice(0,20);}
function revisionView_(source,sh){
  var resolved=revisionResponse_(source,sh,{includeTrash:true,recordStateContract:'state-v3',revisionContract:'revision-v1'},stateTable_(source,false)),ctx=resolved.ctx,records=resolved.response.records;
  if(records.length>1000)throw new Error('表示専用タブの1000件上限です。部分表示を最新とは扱いません');
  var generatedAt=new Date().toISOString(),version=digest_([ctx.snapshot,revisionManifest_(ctx.table.events),records.map(function(r){return[r.recordKey,r.stateVersion,r.revisionVersion,r.revisionReason];})]),rows=[['表示専用・作成時点のスナップショット / 原本タブは変更していません',generatedAt,version],['直接編集は正本に反映されません。原本の手動変更へ自動追従しません。次回の明示更新または改訂保存で再生成します。'],['状態','改訂head'].concat(ctx.snapshot.headers)];
  records.forEach(function(r){var values=ctx.projected.data[r.row-2].map(function(v,c){return ctx.projected.formulas[r.row-2][c]?'式（原本参照）: '+ctx.projected.formulas[r.row-2][c]:ctx.snapshot.headers[c]==='日付'&&typeof v==='number'&&ctx.snapshot.dateDisplays[r.row]?ctx.snapshot.dateDisplays[r.row]:v;});rows.push([r.revisionReason?'競合: '+r.revisionReason:r.deletedAt?'ごみ箱':r.archived?(r.pinned?'アーカイブ・ピン留め':'アーカイブ'):r.pinned?'ピン留め':'通常',r.revisionVersion].concat(values));});
  var props=PropertiesService.getScriptProperties(),raw=props.getProperty(revisionViewKey_(source)),anchor=raw?JSON.parse(raw):null,info=sheetApi_(source,'?fields=sheets.properties'),matches=(info.sheets||[]).filter(function(s){return s.properties.title===REVISION_V1.viewName;}),requests=[],numeric;
  if(anchor){if(matches.length!==1||matches[0].properties.sheetId!==anchor.sheetId)throw new Error('表示専用タブが削除/置換されています。別タブへ書きません');numeric=anchor.sheetId;}
  else{if(matches.length)throw new Error('同名の既存タブは表示専用と確認できないため変更しません');var used=(info.sheets||[]).map(function(s){return s.properties.sheetId;});numeric=1000000+Math.floor(Math.random()*2000000000);while(used.indexOf(numeric)>=0)numeric++;requests.push({addSheet:{properties:{sheetId:numeric,title:REVISION_V1.viewName,hidden:false,gridProperties:{rowCount:Math.max(1000,rows.length),columnCount:Math.max(40,ctx.snapshot.headers.length+2)}}}});}
  var width=Math.max(ctx.snapshot.headers.length+2,anchor&&anchor.width||0,3),height=Math.max(rows.length,anchor&&anchor.height||0);
  var gridProperties=matches.length?matches[0].properties.gridProperties:null;if(gridProperties&&gridProperties.rowCount<height)requests.push({appendDimension:{sheetId:numeric,dimension:'ROWS',length:height-gridProperties.rowCount}});if(gridProperties&&gridProperties.columnCount<width)requests.push({appendDimension:{sheetId:numeric,dimension:'COLUMNS',length:width-gridProperties.columnCount}});
  var cells=Array.from({length:height},function(_,r){return{values:Array.from({length:width},function(_,c){return{userEnteredValue:entered_((rows[r]||[])[c])};})};});requests.push({updateCells:{start:{sheetId:numeric,rowIndex:0,columnIndex:0},rows:cells,fields:'userEnteredValue'}});
  sheetApi_(source,':batchUpdate','post',{requests:requests});var verified=freshAppendCells_(source,{getSheetId:function(){return numeric;}},["'"+REVISION_V1.viewName+"'!A1:C1"]);
  if(((verified[1]||[])[1]||{}).stringValue!==generatedAt||((verified[1]||[])[2]||{}).stringValue!==version)throw new Error('表示専用タブの更新結果が未確認です');
  props.setProperty(revisionViewKey_(source),JSON.stringify({sheetId:numeric,width:width,height:height,generatedAt:generatedAt,version:version}));return{status:'updated',generatedAt:generatedAt,version:version,url:'https://docs.google.com/spreadsheets/d/'+source+'/edit#gid='+numeric,message:'作成時点の表示専用スナップショットです。原本の直接編集には自動追従しません'};
}
function actionLatestView_(b){
  if(prop_('REVISION_ENABLED')!=='true'||!b||b.revisionContract!=='revision-v1')throw new Error('更新版の表示専用タブ更新は準備待ちです');
  var source=String(prop_('SHEET_ID')||''),lock=LockService.getScriptLock();lock.waitLock(30000);try{if(prop_(saveKeys_(source,'').pending))throw new Error('保存結果が未確定のため表示更新しません');return{ok:true,latestView:revisionView_(source,logSheet_(source))};}finally{lock.releaseLock();}
}
