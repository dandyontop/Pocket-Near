import { useState } from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { api } from "../lib/api.js";
import type { ThesisReport } from "@pocket-near/shared";
import ThesisReportCard from "./ThesisReportCard.js";

type ThesisFeatureProps={accountId:string|null;nativeBalance:string|null;nearPrice:number|null};
const usd=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumSignificantDigits:6}).format(value);

export default function ThesisFeature({accountId,nativeBalance,nearPrice}:ThesisFeatureProps){
  const [thesis,setThesis]=useState<ThesisReport|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [riskAmount,setRiskAmount]=useState("");
  const portfolioUsd=accountId&&nativeBalance!==null&&nearPrice!==null?Number(nativeBalance)*nearPrice:null;
  const riskValue=Number(riskAmount);
  const riskValid=Number.isFinite(riskValue)&&riskValue>0&&portfolioUsd!==null&&riskValue<=portfolioUsd;
  const generate=async()=>{
    setLoading(true);setError("");
    try{setThesis(await api.thesis());}
    catch(e){setError(e instanceof Error?e.message:"Research thesis could not be generated.");}
    finally{setLoading(false);}
  };
  const marketAssets=[...(thesis?.facts.marketAssets??[])].sort((a,b)=>(b.marketCap??-1)-(a.marketCap??-1));
  const nearPools=[...(thesis?.facts.nearPools??[])].sort((a,b)=>(b.volume24hUsd??-1)-(a.volume24hUsd??-1));
  return <section className="thesis-feature">
    <div className="section-heading compact"><div><p className="eyebrow">NEAR RESEARCH</p><h2>Get NEAR Thesis</h2></div></div>
    <p className="meme-disclaimer">Use as research material, never as financial advice. AI can make mistakes. Always verify results and do your own research.</p>
    <div className="thesis-budget">
      <strong>Wallet-size context</strong>
      {portfolioUsd===null?<span>{accountId?"Your native NEAR balance or price is unavailable.":"Connect your NEAR wallet to compare a risk amount with your balance."}</span>:<span>Reported value: {usd(portfolioUsd)} in unlocked native NEAR. Other token balances are not currently included.</span>}
      <label className="field">Amount you are willing to risk (USD)<input inputMode="decimal" type="number" min="0" step="any" value={riskAmount} onChange={event=>setRiskAmount(event.target.value)} placeholder="Enter your own limit" disabled={portfolioUsd===null}/></label>
      {riskAmount&&portfolioUsd!==null&&!riskValid&&<small className="risk-warning">Enter an amount above zero and no greater than the reported native NEAR value.</small>}
      {riskValid&&<small>This is your own sizing limit, not a recommendation. It stays in this screen and is not sent to NEAR AI.</small>}
    </div>
    <button className="primary-button" onClick={()=>void generate()} disabled={loading}>{loading?<span className="loader small"/>:<Sparkles size={14}/>}Get NEAR Thesis</button>
    {error&&<div className="execution-status error" role="alert"><span>{error}</span><button className="secondary-button" onClick={()=>void generate()} disabled={loading}>Retry</button></div>}
    {thesis&&<>
      <ThesisReportCard thesis={thesis}/>
      <section className="thesis-candidates">
        <h3>Market observations, ranked by reported data</h3>
        <p>These are research candidates, not picks by expected return. Ranking uses market capitalization within the configured price feed and 24-hour volume for indexed pools.</p>
        <h4>Configured crypto price feed</h4>
        {marketAssets.length?<div className="thesis-candidate-list">{marketAssets.map((asset,index)=><article key={asset.id}>
          <div><strong>#{index+1} {asset.name} ({asset.symbol})</strong><small>Market cap {asset.marketCap===null?"unavailable":usd(asset.marketCap)} · {asset.change24hPct===null?"24h move unavailable":`${asset.change24hPct>=0?"+":""}${asset.change24hPct.toFixed(2)}% over 24h`}</small><small className="routebook-source">Source: {asset.source} · updated {new Date(asset.updatedAt).toLocaleString()}</small></div>
          <div><b>{usd(asset.priceUsd)}</b>{riskValid&&asset.priceUsd>0&&<small>Selected amount ≈ {(riskValue/asset.priceUsd).toLocaleString("en-US",{maximumFractionDigits:6})} {asset.symbol}; excludes costs and does not check for a live swap route.</small>}</div>
        </article>)}</div>:<p className="meme-disclaimer">No current token rows were returned.</p>}
        <p className="meme-disclaimer">Daily price changes do not identify a likely bottom. The configured feed is not the whole crypto market.</p>
        <h4>NEAR and stablecoin pools</h4>
        {nearPools.length?<div className="thesis-candidate-list">{nearPools.map((pool,index)=><article key={pool.poolId}>
          <div><strong>#{index+1} {pool.symbols.join(" / ")}</strong><small>TVL {usd(pool.tvlUsd)} · 24h volume {pool.volume24hUsd===null?"unavailable":usd(pool.volume24hUsd)} · type {pool.poolType??"unclassified"}</small><small className="routebook-source">Pool source updated {new Date(pool.updatedAt).toLocaleString()}</small></div>
          <div>{pool.feeApr24hRunRatePct===null?<small>Fee run-rate unavailable</small>:<small>Backward-looking fee run-rate {pool.feeApr24hRunRatePct.toFixed(2)}%</small>}<a href={pool.url} target="_blank" rel="noreferrer" aria-label={`Review ${pool.symbols.join(" / ")} pool`}><ArrowUpRight size={14}/> Review pool</a></div>
          {riskValid&&<small>Your selected amount is only a risk cap. The data source does not report this pool's minimum deposit, so affordability cannot be confirmed.</small>}
        </article>)}</div>:<p className="meme-disclaimer">No current NEAR/stablecoin pool rows were returned.</p>}
        {thesis.facts.gameDirectory.length>0&&<><h4>Curated NEAR game directory</h4><div className="thesis-candidate-list">{thesis.facts.gameDirectory.map(game=><article key={game.id}>
          <div><strong>{game.name}</strong><small>{game.blurb} · {game.tags.join(", ")}</small></div>
          <a href={game.url} target="_blank" rel="noreferrer">Explore <ArrowUpRight size={14}/></a>
          <small className="routebook-source">Entry cost and earnings were not supplied; low-budget access and play-to-earn returns are unverified.</small>
        </article>)}</div></>}
      </section>
    </>}
  </section>;
}
