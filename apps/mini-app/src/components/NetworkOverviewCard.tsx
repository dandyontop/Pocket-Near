import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { NetworkOverview } from "@pocket-near/shared";
import { api } from "../lib/api.js";
import "../networkOverview.css";

const usd=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(value);

export function NetworkOverviewCard(){
  const [overview,setOverview]=useState<NetworkOverview|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{
    setLoading(true);
    setError("");
    try{setOverview(await api.networkOverview());}
    catch(reason){setError(reason instanceof Error?reason.message:"Intents network metrics are unavailable.");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);

  return <article className="network-overview-card" aria-live="polite">
    <div className="network-overview-heading">
      <div><p className="eyebrow">NETWORK ACTIVITY</p><h2>Intents network (24h)</h2></div>
      <button className="icon-button light" type="button" aria-label="Refresh Intents network metrics" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/></button>
    </div>
    {loading&&!overview?<p className="network-overview-message">Loading Explorer data…</p>:error&&!overview?<div className="network-overview-error"><span>{error}</span><button className="secondary-button" type="button" onClick={()=>void load()} disabled={loading}>Retry</button></div>:overview&&<>
      <div className="network-overview-stats">
        <div><span>Volume</span><strong>{usd(overview.volumeUsd24h)}</strong></div>
        <div><span>Transactions</span><strong>{overview.txCount24h.toLocaleString()}</strong></div>
        <div><span>Success rate</span><strong>{(overview.successRate24h*100).toFixed(1)}%</strong></div>
      </div>
      <p className="network-overview-window">{new Date(overview.windowStart).toLocaleString()} – {new Date(overview.windowEnd).toLocaleString()}</p>
      <div className="network-overview-pairs">
        <strong>Top pairs by volume</strong>
        {overview.topPairs24h.length?overview.topPairs24h.slice(0,5).map(pair=><div className="network-overview-pair" key={pair.pair}><span title={pair.pair}>{pair.label??pair.pair}</span><b>{usd(pair.volumeUsd)}</b></div>):<span className="network-overview-message">No pair activity in this window.</span>}
      </div>
      {overview.partial&&<p className="network-overview-note">Sample may not cover full 24h.</p>}
      {error&&<p className="network-overview-note">Refresh failed: {error}</p>}
      <p className="network-overview-methodology">{overview.methodology}</p>
    </>}
    {loading&&overview&&<p className="network-overview-message">Refreshing…</p>}
  </article>;
}
