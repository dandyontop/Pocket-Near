import { useEffect, useState } from "react";
import { ArrowRight, Bot, Heart, Pause, Play, RefreshCw, Search, Shield, Trash2, TrendingUp, Wallet } from "lucide-react";
import type { AgentPolicy, Asset, MarketSentiment, MemeBoard, MemeVote, PriceRow } from "@pocket-near/shared";
import { api } from "../lib/api.js";
import ThesisFeature from "./ThesisFeature.js";
import { getRheaMarketRiskFlags } from "../lib/rheaRisk.js";

type HomeShortcutsProps = {
  accountId: string | null;
  nativeBalance: string | null;
  balanceError: string;
  policy: AgentPolicy | null;
  policyActive: boolean;
  agentOn: boolean;
  busy:boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onNavigate: (tab: "MarketPlace" | "Swap" | "You") => void;
};

export function HomeShortcuts({accountId,nativeBalance,balanceError,policy,policyActive,agentOn,busy,onConnect,onDisconnect,onNavigate}:HomeShortcutsProps){
  return <>
    <article className="home-portfolio">
      <div className="home-portfolio-head"><span>PORTFOLIO PEEK</span><Wallet size={18}/></div>
      <strong>{accountId ? nativeBalance !== null ? `${nativeBalance} NEAR` : balanceError || "Loading NEAR balance…" : "Connect a NEAR wallet"}</strong>
      {accountId&&<span className="home-account">{accountId}</span>}
      {accountId?<button className="subtle-button home-disconnect" disabled={busy} onClick={onDisconnect}>Disconnect wallet</button>:<button className="secondary-button" disabled={busy} onClick={onConnect}>Connect wallet <ArrowRight size={14}/></button>}
    </article>
    <div className="home-quick-grid">
      <button className="home-quick-card" onClick={()=>onNavigate("You")}><span className="discover-icon"><Bot size={17}/></span><strong>My Agent</strong><small>{policy?.freeze?"Frozen":agentOn?"Notify only":"Off"}</small></button>
      <button className="home-quick-card" onClick={()=>onNavigate("MarketPlace")}><span className="discover-icon"><Shield size={17}/></span><strong>Policy pairs</strong><small>{policy&&policyActive?`${policy.allowedPairs.length} signed pair${policy.allowedPairs.length===1?"":"s"}`:"No active signed policy"}</small></button>
    </div>
    <button className="primary-button" onClick={()=>onNavigate(policy?"MarketPlace":"You")}>{policy?"Review your watch pairs":"Create and sign a policy"} <ArrowRight size={15}/></button>
  </>;
}

type MarketPlaceScreenProps = {
  accountId:string|null;
  nativeBalance:string|null;
  nearPrice:number|null;
  assets: Asset[];
  policy: AgentPolicy | null;
  policyActive: boolean;
  agentOn: boolean;
  prices: PriceRow[];
  loading: boolean;
  onRefresh: () => void;
  onSwap: (from: string, to: string) => void;
  onCreatePolicy: () => void;
  memeBoard: MemeBoard;
  memeBoardError: string;
  onVoteMeme: (assetId:string,vote:MemeVote)=>void;
  watchlist:string[];
  onToggleWatch:(symbol:string)=>void;
  onTradePrice:(row:PriceRow)=>void;
  alerts:Array<{id:number;symbol:string;op:"gte"|"lte";thresholdUsd:number;active:boolean;createdAt:string}>;
  alertSymbol:string;
  setAlertSymbol:(value:string)=>void;
  alertOp:"gte"|"lte";
  setAlertOp:(value:"gte"|"lte")=>void;
  alertValue:string;
  setAlertValue:(value:string)=>void;
  onCreateAlert:()=>void;
  onRemoveAlert:(id:number)=>void;
  onSetAlertActive:(id:number,active:boolean)=>void;
};

const usd=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumSignificantDigits:6}).format(value);
const compactUsd=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(value);

function FearGreedMeter(){
  const [sentiment,setSentiment]=useState<MarketSentiment|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const refresh=async()=>{
    setLoading(true);setError("");
    try{setSentiment(await api.marketSentiment());}
    catch(e){setError(e instanceof Error?e.message:"The sentiment index is unavailable.");}
    finally{setLoading(false);}
  };
  useEffect(()=>{void refresh();},[]);
  return <article className="sentiment-card">
    <div className="section-heading compact"><div><p className="eyebrow">MARKET SENTIMENT</p><h2>Fear &amp; Greed</h2></div><button className="icon-button light" aria-label="Refresh market sentiment" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={15}/></button></div>
    {sentiment?<><div className="sentiment-value"><strong>{sentiment.value}</strong><span>/ 100</span></div><div className="sentiment-track" role="meter" aria-label="Fear and Greed index score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={sentiment.value}><span style={{width:`${sentiment.value}%`}}/></div><small>Index observation: {new Date(sentiment.observedAt).toLocaleString()}</small><small>Last checked: {new Date(sentiment.updatedAt).toLocaleString()}</small><small>Source: Alternative.me · broad crypto-market index, not a NEAR-specific reading.</small>{error&&<div className="execution-status error"><span>Could not refresh; showing the previous reading. {error}</span><button className="secondary-button" onClick={()=>void refresh()} disabled={loading}>Retry</button></div>}</>:error?<div className="execution-status error"><span>{error}</span><button className="secondary-button" onClick={()=>void refresh()} disabled={loading}>Retry</button></div>:<div className="empty-activity"><span className="loader"/><span>Loading latest index…</span></div>}
  </article>;
}

export function MarketPlaceScreen({accountId,nativeBalance,nearPrice,assets,policy,policyActive,agentOn,prices,loading,onRefresh,onSwap,onCreatePolicy,memeBoard,memeBoardError,onVoteMeme,watchlist,onToggleWatch,onTradePrice,alerts,alertSymbol,setAlertSymbol,alertOp,setAlertOp,alertValue,setAlertValue,onCreateAlert,onRemoveAlert,onSetAlertActive}:MarketPlaceScreenProps){
  const [section,setSection]=useState<"prices"|"memes">("prices");
  const [priceSearch,setPriceSearch]=useState("");
  const [hideRiskFlagged,setHideRiskFlagged]=useState(false);
  const assetById=new Map(assets.map(asset=>[asset.assetId,asset]));
  const visibleRheaMarkets=memeBoard.assets.filter(asset=>!hideRiskFlagged||getRheaMarketRiskFlags(asset).length===0);
  const activePairs=policy&&policyActive&&!policy.freeze?policy.allowedPairs:[];
  const findPrice=(asset:Asset|undefined)=>{
    if(!asset)return undefined;
    const symbol=asset.symbol.toUpperCase();
    const direct=prices.find(price=>price.symbol.toUpperCase()===symbol);
    if(direct)return direct;
    return symbol==="WNEAR"?prices.find(price=>price.symbol.toUpperCase()==="NEAR"):undefined;
  };
  return <section className="page-title">
    <div className="watch-heading"><div><p className="eyebrow">NEAR MARKETPLACE</p><h1>MarketPlace</h1></div><button className="icon-button light" aria-label="Refresh marketplace data" onClick={onRefresh} disabled={loading}><RefreshCw size={15}/></button></div>
    <p>Live prices, policy pairs, Rhea markets and sourced market research.</p>
    <FearGreedMeter/>
    <ThesisFeature accountId={accountId} nativeBalance={nativeBalance} nearPrice={nearPrice}/>
    <div className={`policy-status ${!policy||!policyActive||policy.freeze?"blocked":"ok"}`}>{!policy?"No policy":policy.freeze?"Frozen":!policyActive?"No active policy":"Policy active"}{policy&&` · ${agentOn?"Agent monitoring":"Agent paused"}`}</div>
    {!policy?<article className="coming-soon-card"><strong>Create a signed policy to start watching</strong><span>Watch lists only pairs you explicitly authorize in your policy.</span><button className="secondary-button" onClick={onCreatePolicy}>Set up policy <ArrowRight size={14}/></button></article>:policy.freeze?<article className="coming-soon-card"><strong>Your policy is frozen</strong><span>Unfreeze it in You before resuming pair monitoring.</span><button className="secondary-button" onClick={onCreatePolicy}>Review policy <ArrowRight size={14}/></button></article>:!policyActive?<article className="coming-soon-card"><strong>No active signed policy</strong><span>Sign an active policy in You to resume policy-pair monitoring.</span><button className="secondary-button" onClick={onCreatePolicy}>Review policy <ArrowRight size={14}/></button></article>:activePairs.length===0?<article className="coming-soon-card"><strong>No policy pairs</strong><span>Add and sign an allowed pair to see its price context.</span><button className="secondary-button" onClick={onCreatePolicy}>Add a pair <ArrowRight size={14}/></button></article>:<div className="watch-pair-list">{activePairs.map((pair,index)=>{
      const from=assetById.get(pair.from),to=assetById.get(pair.to);
      const fromPrice=findPrice(from),toPrice=findPrice(to);
      return <article className="watch-pair-card" key={`${pair.from}:${pair.to}:${index}`}>
        <div className="watch-pair-title"><div><strong>{from?.symbol??pair.from} <span>→</span> {to?.symbol??pair.to}</strong><small>{from?.blockchain??"Asset"} → {to?.blockchain??"Asset"}</small></div><span className="chip active">Policy OK</span></div>
        <div className="watch-prices">
          <div><small>{from?.symbol??"Origin"}{from?.symbol.toUpperCase()==="WNEAR"&&fromPrice?.symbol.toUpperCase()==="NEAR"?" · NEAR reference":""}</small><strong>{fromPrice?usd(fromPrice.priceUsd):"Price unavailable"}</strong></div>
          <div><small>{to?.symbol??"Destination"}{to?.symbol.toUpperCase()==="WNEAR"&&toPrice?.symbol.toUpperCase()==="NEAR"?" · NEAR reference":""}</small><strong>{toPrice?usd(toPrice.priceUsd):"Price unavailable"}</strong></div>
        </div>
        <button className="secondary-button" onClick={()=>onSwap(pair.from,pair.to)}>Swap this pair <ArrowRight size={14}/></button>
      </article>;
    })}</div>}
    <div className="watch-secondary">
      <div className="watch-segments" role="tablist" aria-label="Watch data"><button role="tab" aria-selected={section==="prices"} className={section==="prices"?"active":""} onClick={()=>setSection("prices")}>Market prices</button><button role="tab" aria-selected={section==="memes"} className={section==="memes"?"active":""} onClick={()=>setSection("memes")}>Rhea NEAR markets</button></div>
      {section==="prices"&&<section className="watch-market-section">
        <div className="market-toolbar"><label className="field market-search"><Search size={15}/><input value={priceSearch} onChange={event=>setPriceSearch(event.target.value)} placeholder="Search assets" aria-label="Search prices"/></label><button className="icon-button light" aria-label="Refresh prices" onClick={onRefresh} disabled={loading}><RefreshCw size={15}/></button></div>
        {prices.length===0?<div className="empty-activity"><TrendingUp size={24}/><strong>Prices unavailable</strong><span>Market data could not be loaded. Pull to refresh.</span></div>:<div className="market-list">{prices.filter(price=>`${price.name} ${price.symbol}`.toLowerCase().includes(priceSearch.toLowerCase())).map(price=><article className="market-row" key={price.id}><div className="coin-mark">{price.symbol.slice(0,1)}</div><div className="market-name"><strong>{price.name}</strong><span>{price.symbol}{price.marketCap?` · MCap ${compactUsd(price.marketCap)}`:""}</span></div><div className="market-price"><strong>{usd(price.priceUsd)}</strong><span className={(price.change24hPct??0)>=0?"positive":"negative"}>{price.change24hPct===null?"—":`${price.change24hPct>=0?"+":""}${price.change24hPct.toFixed(2)}%`}</span></div><button className={`mini-icon ${watchlist.includes(price.symbol)?"watched":""}`} aria-label={`${watchlist.includes(price.symbol)?"Remove from":"Add to"} watchlist`} onClick={()=>onToggleWatch(price.symbol)}><Heart size={16} fill={watchlist.includes(price.symbol)?"currentColor":"none"}/></button><button className="mini-trade" onClick={()=>onTradePrice(price)}>Trade</button></article>)}</div>}
        <div className="section-heading compact"><div><p className="eyebrow">YOUR WATCHLIST</p><h2>Saved assets</h2></div></div>
        {watchlist.length===0?<div className="empty-activity"><Heart size={20}/><strong>No saved assets</strong><span>Tap the heart beside a price to add it here.</span></div>:<div className="market-list">{watchlist.map(symbol=>{const row=prices.find(price=>price.symbol===symbol);return row?<article className="market-row" key={symbol}><div className="coin-mark">{symbol.slice(0,1)}</div><div className="market-name"><strong>{row.name}</strong><span>{symbol}</span></div><div className="market-price"><strong>{usd(row.priceUsd)}</strong><span className={(row.change24hPct??0)>=0?"positive":"negative"}>{row.change24hPct===null?"—":`${row.change24hPct>=0?"+":""}${row.change24hPct.toFixed(2)}%`}</span></div><button className="mini-icon watched" aria-label={`Remove ${symbol} from watchlist`} onClick={()=>onToggleWatch(symbol)}><Heart size={16} fill="currentColor"/></button></article>:null;})}</div>}
        <div className="section-heading compact"><div><p className="eyebrow">PRICE ALERTS</p><h2>Create alert</h2></div></div><section className="form-card"><div className="form-grid"><label className="field">Asset<select value={alertSymbol} onChange={event=>setAlertSymbol(event.target.value)}>{prices.map(price=><option key={price.id} value={price.symbol}>{price.symbol}</option>)}</select></label><label className="field">Condition<select value={alertOp} onChange={event=>setAlertOp(event.target.value as "gte"|"lte")}><option value="gte">At or above</option><option value="lte">At or below</option></select></label></div><label className="field">Target USD<input inputMode="decimal" type="number" min="0" step="any" value={alertValue} onChange={event=>setAlertValue(event.target.value)} placeholder="e.g. 100000"/></label><button className="primary-button" disabled={!alertSymbol||!Number(alertValue)} onClick={onCreateAlert}>Create alert</button></section>
        {alerts.length>0&&<><div className="section-heading compact"><div><p className="eyebrow">YOUR RULES</p><h2>Active alerts</h2></div></div><div className="market-list">{alerts.map(alert=><article className="market-row alert-row" key={alert.id}><div className="market-name"><strong>{alert.symbol} {alert.op==="gte"?"≥":"≤"} {usd(alert.thresholdUsd)}</strong><span>{alert.active?"Alert is active":"Paused"}</span></div><button className="mini-icon" aria-label={alert.active?"Pause alert":"Activate alert"} onClick={()=>onSetAlertActive(alert.id,!alert.active)}>{alert.active?<Pause size={15}/>:<Play size={15}/>}</button><button className="mini-icon" aria-label="Delete alert" onClick={()=>onRemoveAlert(alert.id)}><Trash2 size={15}/></button></article>)}</div></>}
      </section>}
      {section==="memes"&&<section className="watch-market-section">
        <div className="section-heading compact"><div><p className="eyebrow">RHEA DEX · NEAR</p><h2>NEAR token markets</h2></div></div>
        <label className="risk-filter"><input type="checkbox" checked={hideRiskFlagged} onChange={event=>setHideRiskFlagged(event.target.checked)}/>Hide markets with reported risk signals</label>
        {memeBoard.status==="coming_soon"||memeBoard.assets.length===0?<article className="coming-soon-card">{memeBoardError?"Rhea markets unavailable":"No indexed Rhea markets"}<span>{memeBoardError||"No active pools were returned by the market data source. No placeholder markets or votes are shown."}</span></article>:visibleRheaMarkets.length===0?<div className="empty-activity"><strong>No markets match this filter.</strong><span>Every indexed market currently has at least one reported signal. Turn off the filter to review them.</span></div>:<div className="meme-list">{visibleRheaMarkets.map(asset=>{
          const flags=getRheaMarketRiskFlags(asset);
          return <article className="meme-row" key={asset.assetId}><div className="market-name"><strong>{asset.name||asset.symbol}</strong><span>Contract {asset.assetId.replace(/^near:/,"")} · {asset.symbol} · {asset.poolName||asset.blockchain} · TVL {asset.liquidityUsd===null||asset.liquidityUsd===undefined?"—":compactUsd(asset.liquidityUsd)} · 24h volume {asset.volume24hUsd===null||asset.volume24hUsd===undefined?"—":compactUsd(asset.volume24hUsd)} · trades {asset.trades24h??"—"} · price {asset.priceUsd===null||asset.priceUsd===undefined?"—":usd(asset.priceUsd)} · 24h {asset.priceChange24hPct===null||asset.priceChange24hPct===undefined?"—":`${asset.priceChange24hPct>=0?"+":""}${asset.priceChange24hPct.toFixed(2)}%`} · {asset.poolType||"Rhea pool"} · fee {asset.poolFeePct===null||asset.poolFeePct===undefined?"—":`${asset.poolFeePct.toFixed(2)}%`} · {asset.frozen===true?"FROZEN":asset.frozen===false?"not frozen":"freeze status unavailable"}<span className="market-risk-flags">{flags.length?`Risk signals: ${flags.join(" ")}`:"No signal from the displayed checks; this is not an endorsement."}</span></span></div><div className="meme-votes"><button className={asset.userVote==="bull"?"active":""} onClick={()=>onVoteMeme(asset.assetId,"bull")} aria-label={`Vote bullish for ${asset.symbol}`}>Bull {asset.bullVotes}</button><button className={asset.userVote==="bear"?"active":""} onClick={()=>onVoteMeme(asset.assetId,"bear")} aria-label={`Vote bearish for ${asset.symbol}`}>Bear {asset.bearVotes}</button></div><a className="mini-trade" href={asset.poolUrl} target="_blank" rel="noreferrer">Pool</a><button className="mini-trade" onClick={()=>{const near=assets.find(candidate=>candidate.blockchain.toLowerCase()==="near"&&candidate.symbol.toUpperCase().includes("NEAR"));if(near)onSwap(asset.assetId,near.assetId);}}>Check route</button></article>;
        })}</div>}
        <p className="meme-disclaimer">Signals use Rhea's freeze list and reported liquidity, volume, trade count and 24-hour price change (thresholds: $10,000 liquidity, $100 volume, 3 trades, 20% move). They do not identify wash trading, bots or scams. Filtering only hides rows; it does not change policy or wallet actions.</p>
        <p className="meme-disclaimer">Community votes are social only and never affect policies, agent decisions or execution.</p>
      </section>}
    </div>
  </section>;
}
