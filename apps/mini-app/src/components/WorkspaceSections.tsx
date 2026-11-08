import { ArrowRight, Bot, RefreshCw, Shield, Sparkles, Wallet } from "lucide-react";
import type { AgentPolicy, Asset, PriceRow } from "@pocket-near/shared";

type HomeScreenProps = {
  accountId: string | null;
  nativeBalance: string | null;
  balanceError: string;
  policy: AgentPolicy | null;
  policyActive: boolean;
  agentOn: boolean;
  autoOn: boolean;
  onConnect: () => void;
  onNavigate: (tab: "Watch" | "Swap" | "You") => void;
};

export function HomeScreen({accountId,nativeBalance,balanceError,policy,policyActive,agentOn,autoOn,onConnect,onNavigate}:HomeScreenProps){
  return <section className="page-title workspace-home">
    <p className="eyebrow">POCKET NEAR</p>
    <h1>{accountId ? "Your pocket at a glance." : "A safer way to move."}</h1>
    <p>Policy-bounded NEAR Intents, with every settlement kept in your wallet's control.</p>
    <article className="home-portfolio">
      <div className="home-portfolio-head"><span>PORTFOLIO PEEK</span><Wallet size={18}/></div>
      <strong>{accountId ? nativeBalance !== null ? `${nativeBalance} NEAR` : balanceError || "Loading NEAR balance…" : "Connect a NEAR wallet"}</strong>
      {accountId&&<span className="home-account">{accountId}</span>}
      {!accountId&&<button className="secondary-button" onClick={onConnect}>Connect wallet <ArrowRight size={14}/></button>}
    </article>
    <div className="home-quick-grid">
      <button className="home-quick-card" onClick={()=>onNavigate("Watch")}><span className="discover-icon"><Bot size={17}/></span><strong>Agent</strong><small>{policy?.freeze?"Frozen":agentOn?autoOn?"Auto inside policy":"Notify only":"Off"}</small></button>
      <button className="home-quick-card" onClick={()=>onNavigate("Watch")}><span className="discover-icon"><Shield size={17}/></span><strong>Policy pairs</strong><small>{policy&&policyActive?`${policy.allowedPairs.length} signed pair${policy.allowedPairs.length===1?"":"s"}`:"No active signed policy"}</small></button>
    </div>
    <div className="section-heading compact"><div><p className="eyebrow">UP NEXT</p><h2>Quests</h2></div><Sparkles size={17}/></div>
    <article className="coming-soon-card"><strong>Quests are coming soon</strong><span>There are no rewards or completion tracking yet.</span></article>
    <button className="primary-button" onClick={()=>onNavigate(policy?"Watch":"You")}>{policy?"Review your watch pairs":"Create and sign a policy"} <ArrowRight size={15}/></button>
  </section>;
}

type WatchScreenProps = {
  assets: Asset[];
  policy: AgentPolicy | null;
  policyActive: boolean;
  agentOn: boolean;
  prices: PriceRow[];
  loading: boolean;
  onRefresh: () => void;
  onSwap: (from: string, to: string) => void;
  onCreatePolicy: () => void;
};

export function WatchScreen({assets,policy,policyActive,agentOn,prices,loading,onRefresh,onSwap,onCreatePolicy}:WatchScreenProps){
  const assetById=new Map(assets.map(asset=>[asset.assetId,asset]));
  const activePairs=policy&&policyActive&&!policy.freeze?policy.allowedPairs:[];
  return <section className="page-title">
    <div className="watch-heading"><div><p className="eyebrow">SIGNED POLICY ONLY</p><h1>Watch</h1></div><button className="icon-button light" aria-label="Refresh watch prices" onClick={onRefresh} disabled={loading}><RefreshCw size={15}/></button></div>
    <p>Live price context for pairs in your signed policy. Monitoring stays scoped to these pairs.</p>
    <div className={`policy-status ${!policy||!policyActive||policy.freeze?"blocked":"ok"}`}>{!policy?"No policy":policy.freeze?"Frozen":!policyActive?"No active policy":"Policy active"}{policy&&` · ${agentOn?"Agent monitoring":"Agent paused"}`}</div>
    {!policy?<article className="coming-soon-card"><strong>Create a signed policy to start watching</strong><span>Watch lists only pairs you explicitly authorize in your policy.</span><button className="secondary-button" onClick={onCreatePolicy}>Set up policy <ArrowRight size={14}/></button></article>:policy.freeze?<article className="coming-soon-card"><strong>Your policy is frozen</strong><span>Unfreeze it in You before resuming pair monitoring.</span><button className="secondary-button" onClick={onCreatePolicy}>Review policy <ArrowRight size={14}/></button></article>:!policyActive?<article className="coming-soon-card"><strong>No active signed policy</strong><span>Sign an active policy in You to resume policy-pair monitoring.</span><button className="secondary-button" onClick={onCreatePolicy}>Review policy <ArrowRight size={14}/></button></article>:activePairs.length===0?<article className="coming-soon-card"><strong>No policy pairs</strong><span>Add and sign an allowed pair to see its price context.</span><button className="secondary-button" onClick={onCreatePolicy}>Add a pair <ArrowRight size={14}/></button></article>:<div className="watch-pair-list">{activePairs.map((pair,index)=>{
      const from=assetById.get(pair.from),to=assetById.get(pair.to);
      const fromPrice=prices.find(price=>price.symbol.toUpperCase()===from?.symbol.toUpperCase());
      const toPrice=prices.find(price=>price.symbol.toUpperCase()===to?.symbol.toUpperCase());
      return <article className="watch-pair-card" key={`${pair.from}:${pair.to}:${index}`}>
        <div className="watch-pair-title"><div><strong>{from?.symbol??pair.from} <span>→</span> {to?.symbol??pair.to}</strong><small>{from?.blockchain??"Asset"} → {to?.blockchain??"Asset"}</small></div><span className="chip active">Policy OK</span></div>
        <div className="watch-prices">
          <div><small>{from?.symbol??"Origin"}</small><strong>{fromPrice?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumSignificantDigits:6}).format(fromPrice.priceUsd):"Price unavailable"}</strong></div>
          <div><small>{to?.symbol??"Destination"}</small><strong>{toPrice?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumSignificantDigits:6}).format(toPrice.priceUsd):"Price unavailable"}</strong></div>
        </div>
        <button className="secondary-button" onClick={()=>onSwap(pair.from,pair.to)}>Swap this pair <ArrowRight size={14}/></button>
      </article>;
    })}</div>}
  </section>;
}
