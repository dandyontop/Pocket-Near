import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, RefreshCw, Search, Sparkles, TrendingUp } from "lucide-react";
import { api } from "../lib/api.js";
import "../tokenized-stocks.css";

type Stock={assetId:string;ticker:string;name:string;symbol:string;blockchain:string;decimals:number;priceUsd:number|null};

export function TokenizedStocksScreen({onBack,onOpenTrade}:{onBack:()=>void;onOpenTrade:(url:string)=>void}){
  const [stocks,setStocks]=useState<Stock[]>([]);
  const [query,setQuery]=useState("");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const load=async()=>{setLoading(true);setError("");try{const result=await api.tokenizedStocks();setStocks(result.stocks);}catch(e){setError(e instanceof Error?e.message:"The supported stock catalog is unavailable right now.");}finally{setLoading(false);}};
  useEffect(()=>{void load();},[]);
  const filtered=useMemo(()=>stocks.filter(stock=>`${stock.name} ${stock.ticker} ${stock.symbol}`.toLowerCase().includes(query.toLowerCase())),[stocks,query]);
  const openNear=()=>onOpenTrade("https://near.com");
  return <section className="tokenized-stocks-screen">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Explore</button>
    <section className="stocks-hero">
      <div className="stocks-hero-glow" aria-hidden="true"/><p className="eyebrow"><Sparkles size={12}/> NEAR INTENTS · TOKENIZED ASSETS</p>
      <h1>Own the moment.<br/><em>Trade the market.</em></h1>
      <p>Explore supported tokenized U.S. stocks and ETFs, with NEAR as your starting point.</p>
      <button className="stocks-hero-button" onClick={openNear}>Explore trading on NEAR.com <ArrowUpRight size={15}/></button>
      <small>Prices are shown only when provided by the supported asset catalog. Availability can change.</small>
    </section>
    <div className="section-heading compact stocks-heading"><div><p className="eyebrow">LIVE SUPPORTED CATALOG</p><h2>Stocks &amp; ETFs</h2></div><button className="icon-button light" aria-label="Refresh tokenized stocks" onClick={()=>void load()} disabled={loading}>{loading?<span className="loader small"/>:<RefreshCw size={15}/>}</button></div>
    <label className="field stocks-search"><Search size={15}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search company or ticker" aria-label="Search tokenized stocks"/></label>
    {error&&<div className="alert error"><span>{error}</span><button onClick={()=>void load()}>Retry</button></div>}
    {loading?<div className="empty-activity"><span className="loader"/><strong>Checking supported assets…</strong></div>:error?null:filtered.length===0?<div className="empty-activity"><TrendingUp size={22}/><strong>{stocks.length?"No matching stocks":"No supported stock assets found"}</strong><span>{stocks.length?"Try a different name or ticker.":"The supported token catalog currently has no stock assets available for this integration."}</span></div>:<div className="stocks-list">{filtered.map(stock=><article className="stock-row" key={stock.assetId}>
      <div className="stock-logo">{stock.ticker.slice(0,1)}</div><div className="stock-company"><strong>{stock.name}</strong><span>{stock.ticker} <i>·</i> Tokenized {stock.symbol.endsWith("ON")?"stock":"asset"}</span></div><div className="stock-price"><strong>{stock.priceUsd===null?"Price in trade flow":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(stock.priceUsd)}</strong><span>{stock.blockchain}</span></div><button className="stock-trade-button" onClick={openNear}>Open to trade <ArrowUpRight size={13}/></button>
    </article>)}</div>}
    <div className="stocks-footnote">Tokenized assets are issued by third parties. Trading availability may depend on region and eligibility. These assets are not the same as holding shares in a brokerage account.</div>
  </section>;
}
