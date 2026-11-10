import { ArrowDownUp, Clock3, Fingerprint, Pause, Play, Plus, Shield, Trash2, Wallet } from "lucide-react";
import type { AgentPolicy, Asset } from "@pocket-near/shared";

type PolicyPair = AgentPolicy["allowedPairs"][number];

type PolicyEditorProps = {
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
  busy: boolean;
  passwordSet: boolean;
  canSign:boolean;
  hasPolicy: boolean;
  frozen: boolean;
  onSign: () => void;
  onFreeze: () => void;
};

export function PolicyEditor({
  assets,accountId,pairs,onPairsChange,defaultFrom,defaultTo,maxTrade,setMaxTrade,daily,setDaily,
  weekly,setWeekly,maxSlippage,setMaxSlippage,destinationInput,setDestinationInput,windowStart,
  setWindowStart,  windowEnd,setWindowEnd,busy,passwordSet,canSign,hasPolicy,frozen,onSign,onFreeze,
}:PolicyEditorProps){
  const assetById=new Map(assets.map(asset=>[asset.assetId,asset]));
  const limitAsset=pairs[0]?assetById.get(pairs[0].from):undefined;
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
      {assets.map(asset=><option key={asset.assetId} value={asset.assetId}>{asset.symbol} · {asset.blockchain}</option>)}
    </select></label>
  );

  return <section className="form-card multi-pair-editor">
    <div className="form-title"><Shield size={17}/><div><strong>Allowed pairs</strong><span>Every listed asset pair is included in the wallet-signed policy.</span></div></div>
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
    <div className="window-note"><Clock3 size={15}/><span>Active every day · {windowStart}–{windowEnd}</span></div>
    <div className="form-grid">
      <label className="field">Window starts<input type="time" value={windowStart} onChange={event=>setWindowStart(event.target.value)}/></label>
      <label className="field">Window ends<input type="time" value={windowEnd} onChange={event=>setWindowEnd(event.target.value)}/></label>
    </div>
    <div className="action-pair">
      <button className="secondary-button" disabled={busy||!canSign||!passwordSet||!assets.length} onClick={onSign}><Fingerprint size={16}/>Sign and save policy</button>
      <button className="freeze-button" disabled={busy||!hasPolicy||!canSign} onClick={onFreeze}>{frozen?<Play size={15}/>:<Pause size={15}/>} {frozen?"Resume":"Freeze"}</button>
    </div>
  </section>;
}
