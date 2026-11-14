import { useEffect, useState } from "react";
import { Activity, ArrowRight, ArrowUpRight, Bot, Check, Clock3, ExternalLink, Heart, Pause, Play, RefreshCw, Search, Shield, ShieldAlert, Trash2, TrendingUp, Wallet } from "lucide-react";
import type { AgentPolicy, Asset, EarnProtocol, IntentSwap, MarketSentiment, MemeBoard, MemeVote, NetworkOverview, PriceRow } from "@pocket-near/shared";
import { api } from "../lib/api.js";
import ThesisFeature from "./ThesisFeature.js";
import { getRheaMarketRiskFlags } from "../lib/rheaRisk.js";

type HomeScreenProps = {
  accountId: string | null;
  nativeBalance: string | null;
  balanceError: string;
  busy: boolean;
  swaps: IntentSwap[];
  assets: Asset[];
  agentOn: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onSwap: () => void;
  onActivity: () => void;
};

export function HomeScreen({accountId,nativeBalance,balanceError,busy,swaps,assets,agentOn,onConnect,onDisconnect,onSwap,onActivity}:HomeScreenProps){
  const [network,setNetwork]=useState<NetworkOverview|null>(null);
  const [networkError,setNetworkError]=useState("");
  const [networkLoading,setNetworkLoading]=useState(true);
  const refreshNetwork=async()=>{
    setNetworkLoading(true);
    setNetworkError("");
    try{setNetwork(await api.networkOverview());}
    catch(error){setNetworkError(error instanceof Error?error.message:"Network activity is temporarily unavailable.");}
    finally{setNetworkLoading(false);}
  };
  useEffect(()=>{void refreshNetwork();},[]);
  const recentSwaps=swaps.slice(0,3);
  return <>
    <section className="greeting"><div><p className="eyebrow">YOUR WALLET</p><h1>{accountId?"Welcome back.":"Start with your wallet."}</h1></div><div className="secure-pill"><span/> Non-custodial</div></section>
    <article className="home-portfolio">
      <div className="home-portfolio-head"><span>NEAR WALLET BALANCE</span><Wallet size={18}/></div>
      <strong>{accountId ? nativeBalance !== null ? `${nativeBalance} NEAR` : balanceError || "Loading NEAR balance…" : "Connect a wallet to see your balance"}</strong>
      {accountId&&<span className="home-account">{accountId}</span>}
      {accountId?<button className="subtle-button home-disconnect" disabled={busy} onClick={onDisconnect}>Disconnect wallet</button>:<button className="secondary-button" disabled={busy} onClick={onConnect}>Connect wallet <ArrowRight size={14}/></button>}
    </article>
    <button className="primary-button home-swap-action" onClick={onSwap}><Activity size={16}/>Swap</button>
    <section className="home-summary">
      <div className="section-heading compact"><div><p className="eyebrow">YOUR ACTIVITY</p><h2>Recent swaps</h2></div><button className="secondary-button" onClick={onActivity}>View activity <ArrowRight size={13}/></button></div>
      {recentSwaps.length?recentSwaps.map(swap=><button className="intent-swap-history-row" key={swap.id} onClick={onActivity}><span>{assets.find(asset=>asset.assetId===swap.quote.originAsset)?.symbol??swap.quote.originAsset} → {assets.find(asset=>asset.assetId===swap.quote.destinationAsset)?.symbol??swap.quote.destinationAsset}</span><strong>{swap.status.replaceAll("_"," ")}</strong></button>):<p className="meme-disclaimer">Your saved Intents swaps will appear here. Start with Swap when you're ready.</p>}
      <div className="home-agent-status"><Bot size={15}/><span>Agent monitoring</span><strong>{agentOn?"On · notifications only":"Off"}</strong></div>
    </section>
    <section className="home-summary home-network-summary">
      <div className="section-heading compact"><div><p className="eyebrow">NETWORK DATA · ALL INTEGRATORS</p><h2>NEAR Intents (24h)</h2></div><button className="icon-button light" aria-label="Refresh network activity" onClick={()=>void refreshNetwork()} disabled={networkLoading}><RefreshCw size={15}/></button></div>
      {network?<><div className="flywheel-primary-metrics"><div><span>Network-wide volume</span><strong>{compactUsd(network.volumeUsd24h)}</strong></div><div><span>Transactions</span><strong>{new Intl.NumberFormat("en-US").format(network.txCount24h)}</strong></div><div><span>Success rate</span><strong>{(network.successRate24h*100).toFixed(1)}%</strong></div></div><small>{network.partial?"Partial sample · may not cover full 24 hours":"Explorer network total · not Pocket Near volume"}</small><small>{Date.now()-Date.parse(network.updatedAt)>60*60*1000?"Last successful refresh":"Snapshot updated"}: {new Date(network.updatedAt).toLocaleString()}</small></>:networkError?<div className="execution-status error"><span>{networkError}</span><button className="secondary-button" onClick={()=>void refreshNetwork()} disabled={networkLoading}>Retry</button></div>:<div className="empty-activity"><span className="loader"/><span>Loading network summary…</span></div>}
    </section>
  </>;
}

type ActivityScreenProps={
  swaps:IntentSwap[];
  selected:IntentSwap|null;
  assets:Asset[];
  depositHash:string;
  statusError:string;
  busy:boolean;
  statusBusyId:string;
  onSelect:(swap:IntentSwap)=>void;
  onRefreshAll:()=>void;
  onRefresh:(id:string)=>void;
  onDepositHashChange:(value:string)=>void;
  onSendNear:()=>void;
  onSubmitDepositHash:()=>void;
};

const swapStatusLabel=(status:string)=>status==="SUCCESS"?"Complete":status==="REFUNDED"?"Refunded":status==="FAILED"?"Failed":status==="INCOMPLETE_DEPOSIT"?"Incomplete deposit":status.replaceAll("_"," ").toLowerCase().replace(/^\w/,value=>value.toUpperCase());

export function ActivityScreen({swaps,selected,assets,depositHash,statusError,busy,statusBusyId,onSelect,onRefreshAll,onRefresh,onDepositHashChange,onSendNear,onSubmitDepositHash}:ActivityScreenProps){
  const assetLabel=(assetId:string)=>assets.find(asset=>asset.assetId===assetId)?.symbol??assetId;
  const selectedStatus=selected?.status??"";
  const failed=selected&&["REFUNDED","FAILED","INCOMPLETE_DEPOSIT"].includes(selectedStatus);
  const depositDetected=selected&&(["KNOWN_DEPOSIT_TX","PROCESSING","SUCCESS","REFUNDED","INCOMPLETE_DEPOSIT"].includes(selectedStatus)||Boolean(selected.depositTxHash));
  const processingStarted=selected&&["PROCESSING","SUCCESS","REFUNDED"].includes(selectedStatus);
  return <section className="page-title activity-screen">
    <div className="watch-heading"><div><p className="eyebrow">YOUR SWAPS</p><h1>Activity</h1></div><button className="icon-button light" aria-label="Refresh saved swaps" onClick={onRefreshAll}><RefreshCw size={15}/></button></div>
    <p>Track saved NEAR Intents swaps, deposit steps, and provider status. Rhea pool swaps are submitted directly by your wallet and appear in your wallet activity.</p>
    {swaps.length===0?<div className="empty-activity"><Activity size={24}/><strong>No saved swaps yet</strong><span>When you prepare a live 1-Click deposit from Swap, it will appear here.</span></div>:<div className="activity-swap-list">{swaps.map(swap=><button className={`intent-swap-history-row ${selected?.id===swap.id?"active":""}`} key={swap.id} onClick={()=>onSelect(swap)}><span>{assetLabel(swap.quote.originAsset)} → {assetLabel(swap.quote.destinationAsset)}<small>{new Date(swap.createdAt).toLocaleString()}</small></span><strong>{swapStatusLabel(swap.status)}</strong></button>)}</div>}
    {statusError&&!selected&&<div className="execution-status error"><span>{statusError}</span><button className="secondary-button" onClick={onRefreshAll}>Retry</button></div>}
    {selected&&<section className="intent-swap-panel">
      <div className="section-heading compact"><div><p className="eyebrow">{assetLabel(selected.quote.originAsset)} → {assetLabel(selected.quote.destinationAsset)}</p><h2>{swapStatusLabel(selected.status)}</h2></div><button className="icon-button light" aria-label="Refresh swap status" onClick={()=>onRefresh(selected.id)} disabled={statusBusyId===selected.id}>{statusBusyId===selected.id?<span className="loader small"/>:<RefreshCw size={15}/>}</button></div>
      <div className="swap-timeline" aria-label={`Swap status: ${swapStatusLabel(selected.status)}`}>
        {["Quote created","Deposit detected","Processing","Complete"].map((label,index)=>{
          const complete=index===0||(index===1&&Boolean(depositDetected))||(index===2&&Boolean(processingStarted))||(index===3&&selected.status==="SUCCESS");
          const active=selected.status==="PENDING_DEPOSIT"?index===1:selected.status==="KNOWN_DEPOSIT_TX"?index===2:selected.status==="PROCESSING"?index===2:false;
          const failurePoint=Boolean(failed&&index===3);
          return <div className={`swap-timeline-step ${complete?"complete":""} ${active?"current":""} ${failurePoint?"failed":""}`} key={label}><span>{failurePoint?<ShieldAlert size={12}/>:complete?<Check size={12}/>:<span>{index+1}</span>}</span><small>{failurePoint?swapStatusLabel(selected.status):label}</small></div>;
        })}
      </div>
      {selected.status==="PENDING_DEPOSIT"&&<div className="activity-next-step">
        <strong>{selected.originChain==="near"?"Next: send the deposit from your NEAR wallet":"Next: deposit from your external wallet"}</strong>
        <p>Send exactly {fmtExact(selected.quote.amountIn,assets.find(asset=>asset.assetId===selected.quote.originAsset)?.decimals??0)} {assetLabel(selected.quote.originAsset)} to the address below{selected.quote.depositMemo?" and include the required memo":""}. Pocket Near cannot send assets on another chain.</p>
        {selected.originChain==="near"&&<button className="primary-button" onClick={onSendNear} disabled={busy||Boolean(selected.depositTxHash)}>{busy?<span className="loader small"/>:"Send from NEAR wallet"}</button>}
        {!selected.depositTxHash&&<><label className="field chain-address">Deposit transaction hash<input value={depositHash} onChange={event=>onDepositHashChange(event.target.value)} placeholder="Enter the hash after sending" autoComplete="off"/></label><button className="secondary-button" onClick={onSubmitDepositHash} disabled={busy||!depositHash.trim()}>Notify 1-Click about deposit</button></>}
      </div>}
      {["KNOWN_DEPOSIT_TX","PROCESSING"].includes(selected.status)&&<p className="activity-next-step">Deposit received. The provider is processing the swap; refresh status for the latest update.</p>}
      {selected.status==="SUCCESS"&&<p className="activity-next-step">The provider reports this swap as complete.</p>}
      {failed&&<p className="activity-next-step warning">{selected.status==="REFUNDED"?"The provider reports a refund. Check the transaction details before retrying.":selected.status==="INCOMPLETE_DEPOSIT"?"The provider marked this deposit incomplete. Review the deposit and memo details.":"The provider reports the swap failed. Review the details before retrying."}</p>}
      {(statusError||selected.status==="PENDING_DEPOSIT")&&statusError&&<div className="execution-status error"><strong>Status update failed</strong><span>{statusError}</span><button className="secondary-button" onClick={()=>onRefresh(selected.id)}>Retry status refresh</button></div>}
      <details className="swap-technical-details"><summary>Deposit and transaction details</summary><div className="intent-swap-facts"><span>Deposit amount</span><strong>{fmtExact(selected.quote.amountIn,assets.find(asset=>asset.assetId===selected.quote.originAsset)?.decimals??0)} {assetLabel(selected.quote.originAsset)}</strong><span>Estimated output</span><strong>{fmtExact(selected.quote.amountOut,assets.find(asset=>asset.assetId===selected.quote.destinationAsset)?.decimals??0)} {assetLabel(selected.quote.destinationAsset)}</strong><span>Deposit address</span><code>{selected.quote.depositAddress??"Not provided"}</code>{selected.quote.depositMemo&&<><span>Required memo</span><code>{selected.quote.depositMemo}</code></>}{selected.depositTxHash&&<><span>Transaction hash</span><code>{selected.depositTxHash}</code></>}</div>{selected.depositTxHash&&selected.originChain==="near"&&<a href={`https://nearblocks.io/txns/${encodeURIComponent(selected.depositTxHash)}`} target="_blank" rel="noreferrer">View NEAR transaction <ExternalLink size={13}/></a>}</details>
      <small>Quote created {new Date(selected.createdAt).toLocaleString()} · last updated {new Date(selected.updatedAt).toLocaleString()}</small>
    </section>}
  </section>;
}

type EarnScreenProps={
  protocols:EarnProtocol[];
  loading:boolean;
  error:string;
  onRefresh:()=>void;
  onDiscover:(type:"earn",id:string,url:string)=>void;
  accountId:string|null;
  nativeBalance:string|null;
  busy:boolean;
  onConnect:()=>void;
  onStake:(amount:string)=>void;
  pools:Array<{id:string;poolId:string;kind:string;symbols:string[];tvlUsd:number;feeBps:number|null;feeApr24hRunRatePct:number|null;volume24hUsd:number|null;poolType:string|null;updatedAt:string;url:string}>;
  poolSource:string;
  poolDisclaimer:string;
  yields:{rnearStakingApy:{valuePct:number|null;observedAt:string|null;basis:string};farmRewardsApr:{basis:string};lendingSupplyApy:{basis:string}}|null;
  onRefreshPools:()=>void;
};

export function EarnScreen({protocols,loading,error,onRefresh,onDiscover,accountId,nativeBalance,busy,onConnect,onStake,pools,poolSource,poolDisclaimer,yields,onRefreshPools}:EarnScreenProps){
  const [stakeAmount,setStakeAmount]=useState("");
  const [category,setCategory]=useState("");
  const stakeValid=/^(?:0|[1-9]\d*)(?:\.\d{1,24})?$/.test(stakeAmount)&&(()=>{const [whole="0",fraction=""]=stakeAmount.split(".");return BigInt(whole)*10n**24n+BigInt(fraction.padEnd(24,"0")||"0")>0n;})();
  const stakeExceedsBalance=stakeValid&&nativeBalance!==null&&Number(stakeAmount)>Number(nativeBalance);
  const categories=[...new Set(protocols.map(protocol=>protocol.category).filter(Boolean))];
  return <section className="page-title">
    <p className="eyebrow">EXPLORE · EARN</p><h1>Earn opportunities</h1><p>Review live listings and supported Rhea routes. Rates and returns can change; nothing here is a guarantee.</p>
    <section className="flywheel-card">
      <div className="section-heading compact"><div><p className="eyebrow">RHEA LIQUID STAKING</p><h2>Stake NEAR for rNEAR</h2></div></div>
      <p className="flywheel-note">Rhea’s live rNEAR contract stakes NEAR and returns rNEAR to your wallet. This is native liquid staking—not an rNEAR/USDC pool. The displayed pool market is rNEAR/wNEAR.</p>
      {accountId?<><label className="field">NEAR amount<input inputMode="decimal" value={stakeAmount} onChange={event=>setStakeAmount(event.target.value)} placeholder="Amount to stake" aria-label="NEAR amount to stake"/></label><p className="flywheel-note">{nativeBalance===null?"Your wallet balance is unavailable; staking is paused until it can be checked.":`Connected balance: ${nativeBalance} NEAR. Leave extra NEAR for transaction fees and any one-time token registration.`}</p>{stakeExceedsBalance&&<p className="flywheel-note">That amount is higher than the available NEAR balance.</p>}<button className="primary-button" onClick={()=>onStake(stakeAmount)} disabled={busy||!stakeValid||stakeExceedsBalance||nativeBalance===null}>{busy?<span className="loader small"/>:"Review stake in wallet"}</button></>:<button className="secondary-button" onClick={onConnect} disabled={busy}>Connect NEAR wallet to stake</button>}
      <p className="flywheel-note">Your wallet signs and submits the transaction. Rhea’s official SDK adds a one-time token-registration call when needed. rNEAR output follows Rhea’s live exchange rate; it is not guaranteed to be 1:1.</p>
      {yields&&<small>Rhea-reported staking APY: {yields.rnearStakingApy.valuePct===null?"unavailable":`${yields.rnearStakingApy.valuePct.toFixed(2)}%`} · observed {yields.rnearStakingApy.observedAt?new Date(yields.rnearStakingApy.observedAt).toLocaleString():"time unavailable"}. {yields.farmRewardsApr.basis} {yields.lendingSupplyApy.basis}</small>}
    </section>
    <div className="section-heading compact"><div><p className="eyebrow">NEAR + STABLECOIN POOLS</p><h2>Rhea pool opportunities</h2></div><button className="icon-button light" aria-label="Refresh Rhea pool opportunities" onClick={onRefreshPools}><RefreshCw size={15}/></button></div>
    {poolDisclaimer&&<p className="investment-disclaimer">{poolDisclaimer} Estimates exclude impermanent loss, depegs and price movement. Not financial advice. Data: {poolSource}.</p>}
    {pools.length===0?<div className="empty-activity"><TrendingUp size={22}/><strong>Pool data unavailable</strong><span>{poolSource||"Refresh to try again."}</span></div>:<div className="discover-list">{pools.slice(0,12).map(pool=><article className="discover-card" key={pool.id}><div className="discover-top"><div className="discover-icon"><TrendingUp size={17}/></div><span className="rank-badge">{pool.poolType??pool.kind}</span></div><h2>{pool.symbols.join(" / ")}</h2><p>Reported TVL {compactUsd(pool.tvlUsd)} · 24h volume {pool.volume24hUsd===null?"unavailable":compactUsd(pool.volume24hUsd)} · fee {pool.feeBps===null?"unavailable":`${(pool.feeBps/100).toFixed(2)}%`}.</p><div className="discover-meta"><span>{pool.feeApr24hRunRatePct===null?"Pool fee run-rate unavailable":`Backward-looking fee run-rate ${pool.feeApr24hRunRatePct.toFixed(2)}% annualized`}</span><span>Pool #{pool.poolId} · observed {new Date(pool.updatedAt).toLocaleString()}</span></div><a className="secondary-button" href={pool.url} target="_blank" rel="noreferrer">View pool <ArrowUpRight size={14}/></a></article>)}</div>}
    <div className="section-heading compact"><div><p className="eyebrow">PROTOCOL LISTINGS</p><h2>Earn</h2></div><button className="icon-button light" aria-label="Refresh earn listings" onClick={onRefresh} disabled={loading}><RefreshCw size={15}/></button></div>
    {loading&&<div className="empty-activity"><span className="loader"/><span>Loading earn listings…</span></div>}
    {error&&<div className="alert error"><span>{error}</span><button onClick={onRefresh}>Retry</button></div>}
    <div className="chip-row" aria-label="Earn categories"><button className={!category?"chip active":"chip"} onClick={()=>setCategory("")}>All</button>{categories.map(value=><button key={value} className={category===value?"chip active":"chip"} onClick={()=>setCategory(value)}>{value}</button>)}</div>
    {protocols.filter(protocol=>!category||protocol.category===category).length===0&&!loading?<div className="empty-activity"><strong>No listings in this category</strong><span>Try another category or refresh.</span></div>:<div className="discover-list">{protocols.filter(protocol=>!category||protocol.category===category).map(protocol=><article className="discover-card" key={protocol.id}><div className="discover-top"><span className="rank-badge">{protocol.category}</span>{protocol.tvl>0&&<span className="rank-badge">TVL {compactUsd(protocol.tvl)}</span>}</div><h2>{protocol.name}</h2><div className="discover-actions"><button className="secondary-button" onClick={()=>onDiscover("earn",protocol.id,protocol.url)}>Explore <ArrowUpRight size={14}/></button></div></article>)}</div>}
  </section>;
}

type MarketPlaceScreenProps = {
  accountId:string|null;
  nativeBalance:string|null;
  nearPrice:number|null;
  assets: Asset[];
  prices: PriceRow[];
  loading: boolean;
  onRefresh: () => void;
  onSwap: (from: string, to: string) => void;
  memeBoard: MemeBoard;
  memeBoardError: string;
  onVoteMeme:(assetId:string,vote:MemeVote)=>void;
  watchlist:string[];
  onToggleWatch:(symbol:string)=>void;
  onTradePrice:(row:PriceRow)=>void;
};

const usd=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumSignificantDigits:6}).format(value);
const compactUsd=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(value);
const fmtExact=(amount:string,decimals:number)=>{try{const value=BigInt(amount),base=10n**BigInt(decimals);if(decimals===0)return value.toString();const fraction=(value%base).toString().padStart(decimals,"0").replace(/0+$/g,"");return fraction?`${value/base}.${fraction}`:(value/base).toString();}catch{return amount;}};

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

export function MarketPlaceScreen({accountId,nativeBalance,nearPrice,assets,prices,loading,onRefresh,onSwap,memeBoard,memeBoardError,onVoteMeme,watchlist,onToggleWatch,onTradePrice}:MarketPlaceScreenProps){
  const [section,setSection]=useState<"prices"|"memes">("prices");
  const [priceSearch,setPriceSearch]=useState("");
  const [hideRiskFlagged,setHideRiskFlagged]=useState(false);
  const visibleRheaMarkets=memeBoard.assets.filter(asset=>!hideRiskFlagged||getRheaMarketRiskFlags(asset).length===0);
  return <section className="page-title">
    <div className="watch-heading"><div><p className="eyebrow">EXPLORE · MARKETS</p><h1>Markets</h1></div><button className="icon-button light" aria-label="Refresh market data" onClick={onRefresh} disabled={loading}><RefreshCw size={15}/></button></div>
    <p>Live token prices and observable Rhea market data.</p>
    <FearGreedMeter/>
    <ThesisFeature accountId={accountId} nativeBalance={nativeBalance} nearPrice={nearPrice}/>
    <div className="watch-secondary">
      <div className="watch-segments" role="tablist" aria-label="Watch data"><button role="tab" aria-selected={section==="prices"} className={section==="prices"?"active":""} onClick={()=>setSection("prices")}>Market prices</button><button role="tab" aria-selected={section==="memes"} className={section==="memes"?"active":""} onClick={()=>setSection("memes")}>Rhea NEAR markets</button></div>
      {section==="prices"&&<section className="watch-market-section">
        <div className="market-toolbar"><label className="field market-search"><Search size={15}/><input value={priceSearch} onChange={event=>setPriceSearch(event.target.value)} placeholder="Search assets" aria-label="Search prices"/></label><button className="icon-button light" aria-label="Refresh prices" onClick={onRefresh} disabled={loading}><RefreshCw size={15}/></button></div>
        {prices.length===0?<div className="empty-activity"><TrendingUp size={24}/><strong>Prices unavailable</strong><span>Market data could not be loaded. Pull to refresh.</span></div>:<div className="market-list">{prices.filter(price=>`${price.name} ${price.symbol}`.toLowerCase().includes(priceSearch.toLowerCase())).map(price=><article className="market-row" key={price.id}><div className="coin-mark">{price.symbol.slice(0,1)}</div><div className="market-name"><strong>{price.name}</strong><span>{price.symbol}{price.marketCap?` · MCap ${compactUsd(price.marketCap)}`:""}</span></div><div className="market-price"><strong>{usd(price.priceUsd)}</strong><span className={(price.change24hPct??0)>=0?"positive":"negative"}>{price.change24hPct===null?"—":`${price.change24hPct>=0?"+":""}${price.change24hPct.toFixed(2)}%`}</span></div><button className={`mini-icon ${watchlist.includes(price.symbol)?"watched":""}`} aria-label={`${watchlist.includes(price.symbol)?"Remove from":"Add to"} watchlist`} onClick={()=>onToggleWatch(price.symbol)}><Heart size={16} fill={watchlist.includes(price.symbol)?"currentColor":"none"}/></button><button className="mini-trade" onClick={()=>onTradePrice(price)}>Trade</button></article>)}</div>}
        <div className="section-heading compact"><div><p className="eyebrow">YOUR WATCHLIST</p><h2>Saved assets</h2></div></div>
        {watchlist.length===0?<div className="empty-activity"><Heart size={20}/><strong>No saved assets</strong><span>Tap the heart beside a price to add it here.</span></div>:<div className="market-list">{watchlist.map(symbol=>{const row=prices.find(price=>price.symbol===symbol);return row?<article className="market-row" key={symbol}><div className="coin-mark">{symbol.slice(0,1)}</div><div className="market-name"><strong>{row.name}</strong><span>{symbol}</span></div><div className="market-price"><strong>{usd(row.priceUsd)}</strong><span className={(row.change24hPct??0)>=0?"positive":"negative"}>{row.change24hPct===null?"—":`${row.change24hPct>=0?"+":""}${row.change24hPct.toFixed(2)}%`}</span></div><button className="mini-icon watched" aria-label={`Remove ${symbol} from watchlist`} onClick={()=>onToggleWatch(symbol)}><Heart size={16} fill="currentColor"/></button></article>:null;})}</div>}
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
