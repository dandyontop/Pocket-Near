import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import type { FlywheelOverview } from "@pocket-near/shared";
import { api } from "../lib/api.js";
import "../flywheel.css";

const usd=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumSignificantDigits:6}).format(value);
const compactUsd=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(value);
const number=(value:number)=>new Intl.NumberFormat("en-US").format(value);

export function FlywheelScreen(){
  const [overview,setOverview]=useState<FlywheelOverview|null>(null);
  const [nearPrice,setNearPrice]=useState<number|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [priceNote,setPriceNote]=useState("");
  const [multiplier,setMultiplier]=useState("10");
  const [nearShare,setNearShare]=useState("");

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
    ? overview.pocketNear.volumeUsd24h*multiplierValue*(shareValue/100)/nearPrice!
    : null;

  return <section className="page-title flywheel-screen">
    <div className="flywheel-heading">
      <div><p className="eyebrow">HOURLY ROLLING WINDOW</p><h1>Flywheel</h1></div>
      <button className="icon-button light" aria-label="Reload the latest hourly metrics" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={15}/></button>
    </div>
    <p>Real Intents activity and clearly labeled scenarios. The wallet stays in control of every swap.</p>
    {loading&&!overview&&<article className="flywheel-state"><span className="loader"/><span>Loading the latest hourly snapshot…</span></article>}
    {error&&!overview&&<article className="flywheel-state error"><strong>Flywheel data is not ready</strong><span>{error}</span><button className="secondary-button" onClick={()=>void refresh()} disabled={loading}>Retry</button></article>}
    {overview&&<>
      <div className="flywheel-updated"><span>Snapshot computed {new Date(overview.updatedAt).toLocaleString()}</span><span>{overview.partial?"Partial Explorer sample":"Explorer sample complete"}</span></div>
      {overview.partial&&<div className="alert warning"><span>Explorer safety limits were reached. The sample may not cover the full rolling 24 hours.</span></div>}
      {snapshotStale&&<div className="alert warning"><span>This hourly snapshot is over 90 minutes old. The scheduled worker may have failed; shown values are from its last successful run.</span></div>}
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
        <div className="section-heading compact"><div><p className="eyebrow">NETWORK-WIDE CONTEXT</p><h2>NEAR Intents Explorer (24h)</h2></div></div>
        <div className="flywheel-primary-metrics">
          <div><span>Network-wide volume</span><strong>{usd(overview.network.volumeUsd24h)}</strong></div>
          <div><span>Transactions</span><strong>{number(overview.network.txCount24h)}</strong></div>
          <div><span>Success rate</span><strong>{(overview.network.successRate24h*100).toFixed(1)}%</strong></div>
        </div>
        <p className="flywheel-note">This Explorer total covers all integrators. It is not Pocket Near-attributed volume.</p>
      </section>

      <section className="flywheel-card">
        <div className="section-heading compact"><div><p className="eyebrow">SCENARIO, NOT OBSERVED DEMAND</p><h2>10× NEAR-demand model</h2></div></div>
        <p className="flywheel-note">Illustrates a hypothetical scale-up of matched Pocket Near volume. Enter what share you assume converts to NEAR buying demand; no output is shown until you provide that assumption.</p>
        <div className="flywheel-assumptions">
          <label className="field">Volume multiplier<input type="number" min="0.1" step="0.1" value={multiplier} onChange={event=>setMultiplier(event.target.value)}/></label>
          <label className="field">Assumed volume converted to NEAR (%)<input type="number" min="0" max="100" step="1" value={nearShare} onChange={event=>setNearShare(event.target.value)} placeholder="Enter 0–100"/></label>
        </div>
        {modeledNear!==null?<div className="flywheel-model-output"><span>Illustrative NEAR equivalent</span><strong>{number(modeledNear)} NEAR</strong><small>{compactUsd(overview.pocketNear.volumeUsd24h*multiplierValue*(shareValue/100))} modeled USD at {usd(nearPrice!)} per NEAR; assumptions are user-entered.</small></div>:<p className="flywheel-note">{priceNote||"Enter the conversion percentage to calculate this scenario."}</p>}
      </section>

      <section className="flywheel-card">
        <div className="section-heading compact"><div><p className="eyebrow">SOFT DATA-QUALITY SIGNAL</p><h2>Repeated-size bursts</h2></div></div>
        <p className="flywheel-note">{number(overview.pocketNear.signals.repeatedSizeBurstTxCount24h)} successful matched transactions ({usd(overview.pocketNear.signals.repeatedSizeBurstVolumeUsd24h)}) shared an asset pair and USD amount rounded to cents at least three times within five minutes.</p>
        <p className="flywheel-note">{overview.pocketNear.signals.methodology} This is not a bot/wash classification; zero flags do not prove activity is organic, and flagged volume remains included in the total.</p>
        <p className="flywheel-note">The available Explorer fields do not establish trader identity, funding links, or net positions, so self-trades, round trips, and wallet clusters are not claimed.</p>
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
