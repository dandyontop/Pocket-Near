import { ArrowDownUp, Clock3, Fingerprint, Pause, Pencil, Play, Plus, Shield, Trash2, Wallet } from "lucide-react";
import type { AgentPolicy, Asset } from "@pocket-near/shared";

type PolicyPair = AgentPolicy["allowedPairs"][number];
type SavedPolicy={id:string;body:AgentPolicy;active:boolean;createdAt:string;updatedAt:string};

type PolicyEditorProps = {
  policies: SavedPolicy[];
  assets: Asset[];
  accountId: string | null;
  pairs: PolicyPair[];
  onPairsChange: (pairs: PolicyPair[]) => void;
  defaultFrom: string;
  defaultTo: string;
  maxTrade: string;
  setMaxTrade: (value: string) => void;
  daily: string;
  setDaily: (value: string) => void;
  weekly: string;
  setWeekly: (value: string) => void;
  maxSlippage: string;
  setMaxSlippage: (value: string) => void;
  destinationInput: string;
  setDestinationInput: (value: string) => void;
  windowStart: string;
  setWindowStart: (value: string) => void;
  windowEnd: string;
  setWindowEnd: (value: string) => void;
  activeDaysLabel: string;
  additionalWindowCount: number;
  timezone: string;
  busy: boolean;
  passwordSet: boolean;
  canSign:boolean;
  editingPolicyId: string | null;
  onSign: () => void;
  onEdit: (policy:SavedPolicy) => void;
  onCancelEdit: () => void;
  onFreeze: (policy:SavedPolicy) => void;
  onDelete: (policyId:string) => void;
};

export function PolicyEditor({
  policies,assets,accountId,pairs,onPairsChange,defaultFrom,defaultTo,maxTrade,setMaxTrade,daily,setDaily,
  weekly,setWeekly,maxSlippage,setMaxSlippage,destinationInput,setDestinationInput,windowStart,
  setWindowStart,windowEnd,setWindowEnd,activeDaysLabel,additionalWindowCount,timezone,busy,passwordSet,canSign,editingPolicyId,onSign,onEdit,onCancelEdit,onFreeze,onDelete,
}:PolicyEditorProps){
  const assetById=new Map(assets.map(asset=>[asset.assetId,asset]));
  const limitAsset=pairs[0]?assetById.get(pairs[0].from):undefined;
  const assetLabel=(asset:Asset)=>`${asset.symbol} · ${asset.blockchain}${asset.assetId.startsWith("near:")?" · Rhea pool":" · Intents"}`;
  const formattedAmount=(value:string,assetId:string)=>{
    const decimals=assetById.get(assetId)?.decimals??0;
    if(!decimals)return value;
    const padded=value.padStart(decimals+1,"0");
    const whole=padded.slice(0,-decimals);
    const fraction=padded.slice(-decimals).replace(/0+$/,"");
    return fraction?`${whole}.${fraction}`:whole;
  };
  const updatePair=(index:number,field:"from"|"to",value:string)=>{
    onPairsChange(pairs.map((pair,pairIndex)=>pairIndex===index?{...pair,[field]:value}:pair));
  };
  const addPair=()=>{
    if(pairs.length>=30||assets.length<2)return;
    const orderedAssets=[...assets].sort((a,b)=>Number(b.assetId===defaultFrom)-Number(a.assetId===defaultFrom));
    const orderedDestinations=[...assets].sort((a,b)=>Number(b.assetId===defaultTo)-Number(a.assetId===defaultTo));
    for(const from of orderedAssets)for(const to of orderedDestinations){
      if(from.assetId!==to.assetId&&!pairs.some(pair=>pair.from===from.assetId&&pair.to===to.assetId)){
        onPairsChange([...pairs,{from:from.assetId,to:to.assetId}]);
        return;
      }
    }
  };
  const assetOptions=(value:string,onChange:(value:string)=>void,label:string)=>(
    <label className="field">{label}<select value={value} onChange={event=>onChange(event.target.value)} aria-label={label}>
      {assets.map(asset=><option key={asset.assetId} value={asset.assetId}>{assetLabel(asset)}</option>)}
    </select></label>
  );

  return <>
    <section className="form-card policy-list">
      <div className="form-title"><Shield size={17}/><div><strong>Saved policies</strong><span>{policies.length}/3 saved. New policies are added; they do not replace existing ones. A swap may match any one active policy.</span></div></div>
      {policies.length===0?<p className="empty-activity">No signed policies yet. Create one below.</p>:<div className="saved-policy-list">{policies.map((saved,index)=>{
        const firstPair=saved.body.allowedPairs[0];
        const fromAsset=firstPair?assetById.get(firstPair.from):undefined;
        const pairsLabel=saved.body.allowedPairs.map(pair=>`${assetById.get(pair.from)?.symbol??pair.from} → ${assetById.get(pair.to)?.symbol??pair.to}`).join(" · ");
        const windowsLabel=saved.body.timeWindows.map(window=>`${window.days.map(day=>["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][day]).join(",")} ${window.start}–${window.end} (${window.timezone})`).join(" · ");
        return <article className="saved-policy" key={saved.id}>
          <div className="saved-policy-heading"><strong>Policy {index+1}</strong><span className={`saved-policy-status ${saved.active?"active":"paused"}`}>{saved.active?"Active":"Frozen"}</span></div>
          <span>{pairsLabel||"No allowed pairs"}</span>
          <small>{fromAsset?`${formattedAmount(saved.body.maxTradeAmount,fromAsset.assetId)} ${fromAsset.symbol} max/trade · ${formattedAmount(saved.body.dailyLimit,fromAsset.assetId)} daily · ${formattedAmount(saved.body.weeklyLimit,fromAsset.assetId)} weekly`:"Limits are set in the origin token's smallest units"} · {saved.body.maxSlippageBps} bps slippage</small>
          <small>Destinations: {saved.body.allowedDestinations.join(", ")}</small>
          <small>Time windows: {windowsLabel}</small>
          <small>Updated {new Date(saved.updatedAt).toLocaleString()}</small>
          <div className="saved-policy-actions">
            <button className="secondary-button" disabled={busy||!canSign||!passwordSet} onClick={()=>onEdit(saved)}><Pencil size={14}/>{editingPolicyId===saved.id?"Editing":"Edit"}</button>
            <button className="secondary-button" disabled={busy||!canSign||!passwordSet} onClick={()=>onFreeze(saved)}>{saved.active?<Pause size={15}/>:<Play size={15}/>} {saved.active?"Freeze":"Resume"}</button>
            <button className="subtle-button" disabled={busy||!passwordSet} onClick={()=>onDelete(saved.id)}><Trash2 size={15}/>Delete</button>
          </div>
        </article>;
      })}</div>}
    </section>
    <section className="form-card multi-pair-editor">
    <div className="form-title"><Shield size={17}/><div><strong>{editingPolicyId?"Edit saved policy":"Create a policy"}</strong><span>Every listed asset pair is included in the wallet-signed policy.</span></div></div>
    <div className="policy-pair-list">{pairs.map((pair,index)=><div className="policy-pair-row" key={`${index}:${pair.from}:${pair.to}`}>
      <span className="policy-pair-number">{index+1}</span>
      {assetOptions(pair.from,value=>updatePair(index,"from",value),`Pair ${index+1} origin`)}
      <ArrowDownUp className="policy-pair-arrow" size={15}/>
      {assetOptions(pair.to,value=>updatePair(index,"to",value),`Pair ${index+1} destination`)}
      <button className="mini-icon" type="button" aria-label={`Remove pair ${index+1}`} disabled={pairs.length<=1} onClick={()=>onPairsChange(pairs.filter((_,pairIndex)=>pairIndex!==index))}><Trash2 size={15}/></button>
    </div>)}</div>
    <button className="secondary-button policy-add-pair" type="button" disabled={pairs.length>=30||assets.length<2} onClick={addPair}><Plus size={14}/>Add allowed pair ({pairs.length}/30)</button>
    <div className="form-grid">
      <label className="field">Maximum per trade ({limitAsset?.symbol??"origin asset"})<input inputMode="decimal" value={maxTrade} onChange={event=>setMaxTrade(event.target.value)}/></label>
      <label className="field">Daily limit ({limitAsset?.symbol??"origin asset"})<input inputMode="decimal" value={daily} onChange={event=>setDaily(event.target.value)}/></label>
    </div>
    <div className="form-grid">
      <label className="field">Weekly limit ({limitAsset?.symbol??"origin asset"})<input inputMode="decimal" value={weekly} onChange={event=>setWeekly(event.target.value)}/></label>
      <label className="field">Maximum slippage<input inputMode="numeric" value={maxSlippage} onChange={event=>setMaxSlippage(event.target.value)}/><small>basis points (100 = 1%)</small></label>
    </div>
    <div className="destination"><div className="destination-icon"><Wallet size={15}/></div><div><span>Wallet identity</span><strong>{accountId??"Connect your wallet"}</strong></div></div>
    <label className="field">Allowed destination addresses<input value={destinationInput} onChange={event=>setDestinationInput(event.target.value)} placeholder="Comma-separated wallet addresses"/><small>Only these recipients pass the policy check.</small></label>
    <div className="window-note"><Clock3 size={15}/><span>{activeDaysLabel} · {windowStart}–{windowEnd} ({timezone}){additionalWindowCount>0?` · ${additionalWindowCount} additional window${additionalWindowCount===1?"":"s"} preserved`:""}</span></div>
    <div className="form-grid">
      <label className="field">Window starts<input type="time" value={windowStart} onChange={event=>setWindowStart(event.target.value)}/></label>
      <label className="field">Window ends<input type="time" value={windowEnd} onChange={event=>setWindowEnd(event.target.value)}/></label>
    </div>
    <div className="action-pair">
      <button className="secondary-button" disabled={busy||!canSign||!passwordSet||!assets.length||(policies.length>=3&&!editingPolicyId)} onClick={onSign}><Fingerprint size={16}/>{editingPolicyId?"Save signed changes":policies.length>=3?"Maximum of 3 policies":"Add and sign policy"}</button>
      {editingPolicyId&&<button className="subtle-button" disabled={busy} onClick={onCancelEdit}>Cancel edit</button>}
    </div>
    </section>
  </>;
}
