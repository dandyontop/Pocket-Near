import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import type { FlywheelOverview } from "@pocket-near/shared";
import { api } from "../lib/api.js";
import "../flywheel.css";

const usd=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumSignificantDigits:6}).format(value);
const compactUsd=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(value);
const number=(value:number)=>new Intl.NumberFormat("en-US").format(value);

type FlywheelScreenProps={
  accountId:string|null;
  nativeBalance:string|null;
  busy:boolean;
  onConnect:()=>void;
  onStake:(amount:string)=>void;
  showStaking?:boolean;
};

export function FlywheelScreen({accountId,nativeBalance,busy,onConnect,onStake,showStaking=true}:FlywheelScreenProps){
  const [overview,setOverview]=useState<FlywheelOverview|null>(null);
  const [nearPrice,setNearPrice]=useState<number|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [priceNote,setPriceNote]=useState("");
  const [multiplier,setMultiplier]=useState("10");
  const [nearShare,setNearShare]=useState("");
  const [stakeAmount,setStakeAmount]=useState("");

  const refresh=useCallback(async()=>{
    setLoading(true);
    setError("");
    setPriceNote("");
    const [snapshot,prices]=await Promise.allSettled([api.flywheelOverview(),api.prices()]);
    if(snapshot.status==="fulfilled")setOverview(snapshot.value);
    else setError(snapshot.reason instanceof Error?snapshot.reason.message:"Hourly Intents metrics are unavailable.");
    if(prices.status==="fulfilled"){
      const near=prices.value.rows.find(row=>row.symbol.toUpperCase()==="NEAR");
      setNearPrice(near?.priceUsd??null);
      if(!near)setPriceNote("The live price feed did not include NEAR.");
    }else{
      setNearPrice(null);
      setPriceNote("Live NEAR price unavailable; the scenario cannot be converted to NEAR.");
    }
    setLoading(false);
  },[]);

  useEffect(()=>{
    void refresh();
    const timer=window.setInterval(()=>void refresh(),60*60*1000);
    return()=>window.clearInterval(timer);
  },[refresh]);

  const multiplierValue=Number(multiplier);
  const shareValue=Number(nearShare);
  const snapshotStale=overview!==null&&Date.now()-Date.parse(overview.updatedAt)>90*60*1000;
  const validScenario=overview!==null&&nearPrice!==null&&Number.isFinite(multiplierValue)&&multiplierValue>0
    &&Number.isFinite(shareValue)&&nearShare.trim()!==""&&shareValue>=0&&shareValue<=100;
  const modeledNear=validScenario
    ? overview.network.volumeUsd24h*multiplierValue*(shareValue/100)/nearPrice!
    : null;
  const stakeAmountValid=/^(?:0|[1-9]\d*)(?:\.\d{1,24})?$/.test(stakeAmount)
    &&(()=>{const [whole="0",fraction=""]=stakeAmount.split(".");return BigInt(whole)*10n**24n+BigInt(fraction.padEnd(24,"0")||"0")>0n;})();
  const stakeExceedsBalance=stakeAmountValid&&nativeBalance!==null&&Number(stakeAmount)>Number(nativeBalance);

  return <section className="page-title flywheel-screen">
    <div className="flywheel-heading">
      <div><p className="eyebrow">HOURLY ROLLING WINDOW</p><h1>NEAR Intents network</h1></div>
      <button className="icon-button light" aria-label="Reload the latest hourly metrics" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={15}/></button>
    </div>
    <p>Real Intents activity and clearly labeled scenarios. The wallet stays in control of every swap.</p>
    {loading&&!overview&&<article className="flywheel-state"><span className="loader"/><span>Loading the latest hourly snapshot…</span></article>}
    {error&&!overview&&<article className="flywheel-state error"><strong>Flywheel data is not ready</strong><span>{error}</span><p>For the first snapshot, the owner must configure the scheduled worker and server-only Explorer credentials. Retrying here cannot replace that setup.</p><button className="secondary-button" onClick={()=>void refresh()} disabled={loading}>Retry</button></article>}
    {overview&&<>
      <div className="flywheel-updated"><span>Snapshot computed {new Date(overview.updatedAt).toLocaleString()}</span><span>{overview.partial?"Partial Explorer sample":"Explorer sample complete"}</span></div>
      {overview.partial&&<div className="alert warning"><span>Explorer safety limits were reached. The sample may not cover the full rolling 24 hours.</span></div>}
      {snapshotStale&&<div className="alert warning"><span>This hourly snapshot is over 90 minutes old. The scheduled worker may have failed; shown values are from its last successful run.</span></div>}
      <section className="flywheel-card">
        <div className="section-heading compact"><div><p className="eyebrow">NETWORK-WIDE CONTEXT</p><h2>NEAR Intents Explorer (24h)</h2></div></div>
        <div className="flywheel-primary-metrics">
          <div><span>Network-wide volume</span><strong>{usd(overview.network.volumeUsd24h)}</strong></div>
          <div><span>Transactions</span><strong>{number(overview.network.txCount24h)}</strong></div>
          <div><span>Success rate</span><strong>{(overview.network.successRate24h*100).toFixed(1)}%</strong></div>
        </div>
        <p className="flywheel-note">This Explorer total covers all integrators. It is not Pocket Near-attributed volume.</p>
      </section>

      {showStaking&&<section className="flywheel-card">
        <div className="section-heading compact"><div><p className="eyebrow">RHEA LIQUID STAKING</p><h2>Stake NEAR for rNEAR</h2></div></div>
        <p className="flywheel-note">Rhea’s live rNEAR contract stakes NEAR and returns rNEAR to your wallet. This is native liquid staking—not an rNEAR/USDC pool. The displayed pool market is rNEAR/wNEAR.</p>
        {accountId?<>
          <label className="field">NEAR amount<input inputMode="decimal" value={stakeAmount} onChange={event=>setStakeAmount(event.target.value)} placeholder="Amount to stake" aria-label="NEAR amount to stake"/></label>
          <p className="flywheel-note">{nativeBalance===null?"Your wallet balance is unavailable; staking is paused until it can be checked.":`Connected balance: ${nativeBalance} NEAR. Leave extra NEAR for transaction fees${" and one-time token registration if required."}`}</p>
          {stakeExceedsBalance&&<p className="flywheel-note">That amount is higher than the available NEAR balance.</p>}
          <button className="primary-button" onClick={()=>onStake(stakeAmount)} disabled={busy||!stakeAmountValid||stakeExceedsBalance||nativeBalance===null}>{busy?<span className="loader small"/>:"Review stake in wallet"}</button>
        </>:<button className="secondary-button" onClick={onConnect} disabled={busy}>Connect NEAR wallet to stake</button>}
        <p className="flywheel-note">Your wallet signs and submits the transaction. Rhea’s official SDK adds a one-time token-registration call when needed. rNEAR output follows Rhea’s live exchange rate; it is not guaranteed to be 1:1.</p>
      </section>}

      <section className="flywheel-card">
        <div className="section-heading compact"><div><p className="eyebrow">POCKET NEAR ATTRIBUTION</p><h2>Routed via Pocket Near (24h)</h2></div></div>
        <div className="flywheel-primary-metrics">
          <div><span>Successful matched volume</span><strong>{usd(overview.pocketNear.volumeUsd24h)}</strong></div>
          <div><span>Successful matched swaps</span><strong>{number(overview.pocketNear.successfulTxCount24h)}</strong></div>
          <div><span>Success rate of Explorer matches</span><strong>{(overview.pocketNear.successRate24h*100).toFixed(1)}%</strong></div>
        </div>
        <p className="flywheel-note">Explorer matches across all statuses: {number(overview.pocketNear.matchedTxCount24h)}.</p>
        {overview.pocketNear.matchedTxCount24h===0&&<p className="flywheel-note">No saved Pocket Near deposit address/memo matched an Explorer row in this window. This does not prove that no swaps were attempted.</p>}
        <p className="flywheel-note">Attributed only when an Explorer deposit address and memo exactly match a saved Pocket Near swap. Volume uses Explorer amountInUsd for SUCCESS rows.</p>
        <div className="flywheel-columns">
          <div><h3>Top matched pairs</h3>{overview.pocketNear.byPair.length?<ul>{overview.pocketNear.byPair.slice(0,5).map(row=><li key={row.pair}><span>{row.pair}</span><strong>{compactUsd(row.volumeUsd)} · {number(row.successTxCount)}/{number(row.txCount)} success</strong></li>)}</ul>:<p className="flywheel-note">No matched pairs in this sample.</p>}</div>
          <div><h3>Matched source chains</h3>{overview.pocketNear.bySourceChain.length?<ul>{overview.pocketNear.bySourceChain.slice(0,5).map(row=><li key={row.sourceChain}><span>{row.sourceChain}</span><strong>{compactUsd(row.volumeUsd)} · {number(row.successTxCount)}/{number(row.txCount)} success</strong></li>)}</ul>:<p className="flywheel-note">No matched source-chain data in this sample.</p>}</div>
        </div>
      </section>

      <section className="flywheel-card">
        <div className="section-heading compact"><div><p className="eyebrow">POCKET NEAR FUNNEL</p><h2>Saved swaps started in this 24h window</h2></div></div>
        <div className="flywheel-funnel">
          <div><span>Started</span><strong>{number(overview.pocketNear.funnel.started24h)}</strong></div>
          <div><span>Deposit hash submitted</span><strong>{number(overview.pocketNear.funnel.depositHashSubmitted24h)}</strong></div>
          <div><span>Saved status: SUCCESS</span><strong>{number(overview.pocketNear.funnel.successful24h)}</strong></div>
        </div>
        <p className="flywheel-note">Provider status can change after the snapshot; counts describe saved Pocket Near swap records, not all quotes.</p>
      </section>

      <section className="flywheel-card">
        <div className="section-heading compact"><div><p className="eyebrow">NETWORK-WIDE SCENARIO, NOT OBSERVED DEMAND</p><h2>10× NEAR-demand model</h2></div></div>
        <p className="flywheel-note">Uses the Explorer's network-wide rolling 24-hour volume across all integrators—not just swaps routed through Pocket Near. Multiplies that market baseline by your scale factor and assumed NEAR conversion share. This is a hypothetical market-size scenario, not Pocket Near volume or measured NEAR buying demand.</p>
        <div className="flywheel-assumptions">
          <label className="field">Volume multiplier<input type="number" min="0.1" step="0.1" value={multiplier} onChange={event=>setMultiplier(event.target.value)}/></label>
          <label className="field">Assumed volume converted to NEAR (%)<input type="number" min="0" max="100" step="1" value={nearShare} onChange={event=>setNearShare(event.target.value)} placeholder="Enter 0–100"/></label>
        </div>
        <p className="flywheel-note">Explorer network baseline: {usd(overview.network.volumeUsd24h)} across {number(overview.network.txCount24h)} transactions in the rolling 24-hour window.{overview.partial?" The Explorer sample is partial, so this baseline may understate the full window.":""}</p>
        {modeledNear!==null?<div className="flywheel-model-output"><span>Illustrative NEAR equivalent</span><strong>{number(modeledNear)} NEAR</strong><small>{compactUsd(overview.network.volumeUsd24h*multiplierValue*(shareValue/100))} modeled USD at {usd(nearPrice!)} per NEAR; assumptions are user-entered.</small></div>:<p className="flywheel-note">{priceNote||"Enter the conversion percentage to calculate this scenario."}</p>}
      </section>

      <section className="flywheel-card">
        <div className="section-heading compact"><div><p className="eyebrow">DEFILLAMA REFERENCES</p><h2>Fees per $1M volume</h2></div></div>
        {overview.defiLlamaPeers.length?<ul className="flywheel-peers">{overview.defiLlamaPeers.map(peer=><li key={peer.id}><div><strong>{peer.name}</strong><small>Fees {compactUsd(peer.feesUsd24h)} · volume {compactUsd(peer.volumeUsd24h)} / 24h</small></div><b>{usd(peer.feesPerMillionUsd)} / $1M</b></li>)}</ul>:<p className="flywheel-note">DefiLlama did not return comparable 24h fee and volume data for these protocols, so no peer rows are shown.</p>}
        <p className="flywheel-note">{overview.peersMethodology} NEAR Intents uses DefiLlama's DEX-volume dimension; 1inch and CoWSwap use aggregator-volume dimensions. These are references, not apples-to-apples rankings. NEAR Intents totals are network-wide and do not describe Pocket Near activity.</p>
      </section>
      <p className="flywheel-methodology">{overview.methodology}</p>
    </>}
    {error&&overview&&<article className="flywheel-state error"><span>{error}</span><button className="secondary-button" onClick={()=>void refresh()} disabled={loading}>Retry</button></article>}
    {loading&&overview&&<div className="flywheel-reloading"><Activity size={14}/> Updating the displayed snapshot…</div>}
  </section>;
}
