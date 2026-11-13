import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ExternalLink, RefreshCw, Wallet } from "lucide-react";
import type { EarnProtocol, ExploreApp, ExploreGame, PriceRow } from "@pocket-near/shared";
import { api } from "../lib/api.js";
import { NetworkOverviewCard } from "./NetworkOverviewCard.js";
import "../publicLanding.css";

type PublicData={prices:PriceRow[];earn:EarnProtocol[];apps:ExploreApp[];games:ExploreGame[]};
type PublicErrors={prices:string;earn:string;apps:string;games:string};

const usd=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumSignificantDigits:5}).format(value);
const compactUsd=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(value);

export function PublicLanding({busy,error,onConnect}:{busy:boolean;error:string;onConnect:()=>void}){
  const [data,setData]=useState<PublicData>({prices:[],earn:[],apps:[],games:[]});
  const [errors,setErrors]=useState<PublicErrors>({prices:"",earn:"",apps:"",games:""});
  const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{
    setLoading(true);
    const [prices,earn,apps,games]=await Promise.allSettled([api.prices(),api.earn(),api.apps(),api.games()]);
    setData({
      prices:prices.status==="fulfilled"?prices.value.rows:[],
      earn:earn.status==="fulfilled"?earn.value.protocols:[],
      apps:apps.status==="fulfilled"?apps.value.apps:[],
      games:games.status==="fulfilled"?games.value.games:[],
    });
    setErrors({
      prices:prices.status==="rejected"?message(prices.reason):"",
      earn:earn.status==="rejected"?message(earn.reason):"",
      apps:apps.status==="rejected"?message(apps.reason):"",
      games:games.status==="rejected"?message(games.reason):"",
    });
    setLoading(false);
  },[]);
  useEffect(()=>{void load();},[load]);

  return <div className="app-shell public-landing">
    <header className="topbar"><div className="brand"><div className="brandmark">pn</div><div><strong>Pocket Near</strong><span>Personal intent desk</span></div></div></header>
    <main className="content">
      <section className="public-welcome">
        <p className="eyebrow">POCKET NEAR · PUBLIC DATA</p>
        <h1>Explore NEAR, without signing in.</h1>
        <p>Browse live public market information. Connect a NEAR wallet to use personal features; your wallet always signs and submits transactions.</p>
        {error&&<p className="public-login-error" role="alert">{error}</p>}
        <button className="primary-button" type="button" onClick={onConnect} disabled={busy}>{busy?<span className="loader small"/>:<Wallet size={16}/>}Connect wallet to sign in <ArrowRight size={15}/></button>
      </section>
      <NetworkOverviewCard/>
      <div className="public-section-heading"><div><p className="eyebrow">PUBLIC SNAPSHOTS</p><h2>Markets and discovery</h2></div><button className="icon-button light" type="button" aria-label="Refresh public data" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/></button></div>
      {loading&&<p className="public-data-message">Loading public data…</p>}
      <section className="public-data-card">
        <h3>Prices</h3>
        {errors.prices?<p className="public-data-error">{errors.prices}</p>:data.prices.length?data.prices.slice(0,6).map(row=><div className="public-data-row" key={row.id}><span><strong>{row.symbol}</strong><small>{row.name}</small></span><b>{usd(row.priceUsd)}</b></div>):!loading&&<p className="public-data-message">No price data available.</p>}
      </section>
      <section className="public-data-card">
        <h3>Earn opportunities</h3>
        {errors.earn?<p className="public-data-error">{errors.earn}</p>:data.earn.length?data.earn.slice(0,4).map(protocol=><a className="public-data-row" href={protocol.url} target="_blank" rel="noopener noreferrer" key={protocol.id}><span><strong>{protocol.name}</strong><small>{protocol.category}</small></span><b>{compactUsd(protocol.tvl)} TVL <ExternalLink size={12}/></b></a>):!loading&&<p className="public-data-message">No opportunities available.</p>}
      </section>
      <section className="public-data-card">
        <h3>Explore apps and games</h3>
        {errors.apps&&<p className="public-data-error">Apps: {errors.apps}</p>}
        {errors.games&&<p className="public-data-error">Games: {errors.games}</p>}
        {data.apps.slice(0,4).map(item=><a className="public-data-row" href={item.url} target="_blank" rel="noopener noreferrer" key={`app-${item.id}`}><span><strong>{item.name}</strong><small>{item.category}</small></span><b>App <ExternalLink size={12}/></b></a>)}
        {data.games.slice(0,3).map(item=><a className="public-data-row" href={item.url} target="_blank" rel="noopener noreferrer" key={`game-${item.id}`}><span><strong>{item.name}</strong><small>{item.tags.slice(0,2).join(" · ")||"NEAR game"}</small></span><b>Game <ExternalLink size={12}/></b></a>)}
        {!loading&&!errors.apps&&!errors.games&&!data.apps.length&&!data.games.length&&<p className="public-data-message">No apps or games available.</p>}
      </section>
      <button className="secondary-button public-retry" type="button" onClick={()=>void load()} disabled={loading}>{loading?"Refreshing…":"Refresh public data"}</button>
    </main>
  </div>;
}

function message(reason:unknown):string{return reason instanceof Error?reason.message:"This public data source is temporarily unavailable.";}
