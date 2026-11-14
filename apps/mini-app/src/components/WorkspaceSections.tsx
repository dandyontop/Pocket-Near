import { useEffect, useState } from "react";
import { Activity, ArrowRight, ArrowUpRight, Bot, Check, Clock3, ExternalLink, Heart, Pause, Play, RefreshCw, Search, Shield, ShieldAlert, Trash2, TrendingUp, Wallet } from "lucide-react";
import type { AgentPolicy, Asset, EarnProtocol, IntentSwap, WalletSwap, MarketSentiment, MemeBoard, MemeVote, NetworkOverview, PriceRow } from "@pocket-near/shared";
import { api } from "../lib/api.js";
import ThesisFeature from "./ThesisFeature.js";
import { getRheaMarketRiskFlags } from "../lib/rheaRisk.js";

type HomeScreenProps = {
  accountId: string | null;
  nativeBalance: string | null;
  balanceError: string;
  busy: boolean;
  agentOn: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onSwap: () => void;
};

export function HomeScreen({accountId,nativeBalance,balanceError,busy,agentOn,onConnect,onDisconnect,onSwap}:HomeScreenProps){
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
  walletSwaps:WalletSwap[];
  walletSwapStatusBusyId:string;
  selected:IntentSwap|null;
  assets:Asset[];
  previewOutput:string|null;
  repriceAccepted:boolean;
  statusError:string;
  busy:boolean;
  statusBusyId:string;
  onSelect:(swap:IntentSwap)=>void;
  onRefreshAll:()=>void;
  onRefresh:(id:string)=>void;
  onRefreshWalletSwap:(id:string)=>void;
  onSendNear:()=>void;
  onAcceptReprice:()=>void;
  onGoToSwap:()=>void;
};

const UNSENT_SWAP_TIMEOUT_MS=10*60_000;
const FAILED_SWAP_STATUSES=new Set(["EXPIRED","REFUNDED","FAILED","INCOMPLETE_DEPOSIT"]);
const swapStatusLabel=(status:string)=>status==="SUCCESS"?"Complete":FAILED_SWAP_STATUSES.has(status)?"Failed":"In progress";
const swapActivityLabel=(swap:IntentSwap)=>swap.status==="PENDING_DEPOSIT"&&!swap.depositTxHash&&(Date.now()-Date.parse(swap.createdAt)>=UNSENT_SWAP_TIMEOUT_MS||Date.parse(swap.quote.expiresAt)<=Date.now())?"Failed":swapStatusLabel(swap.status);

export function ActivityScreen({swaps,walletSwaps,walletSwapStatusBusyId,selected,assets,previewOutput,repriceAccepted,statusError,busy,statusBusyId,onSelect,onRefreshAll,onRefresh,onRefreshWalletSwap,onSendNear,onAcceptReprice,onGoToSwap}:ActivityScreenProps){
  const assetLabel=(assetId:string)=>assets.find(asset=>asset.assetId===assetId)?.symbol??assetId;
  const selectedStatus=selected?.status??"";
  const depositQuoteExpired=Boolean(selected&&selected.status==="PENDING_DEPOSIT"&&!selected.depositTxHash&&(Date.parse(selected.quote.expiresAt)<=Date.now()||Date.now()-Date.parse(selected.createdAt)>=UNSENT_SWAP_TIMEOUT_MS));
  const failed=Boolean(selected&&(FAILED_SWAP_STATUSES.has(selectedStatus)||depositQuoteExpired));
  return <section className="page-title activity-screen">
    <div className="watch-heading"><div><p className="eyebrow">YOUR SWAPS</p><h1>Activity</h1></div><button className="icon-button light" aria-label="Refresh saved swaps" onClick={onRefreshAll}><RefreshCw size={15}/></button></div>
    <p>Track NEAR Intents deposits and Rhea swaps submitted through Pocket Near. Wallet transactions require confirmation from NEAR before they are marked complete.</p>
    {walletSwaps.length>0&&<><div className="section-heading compact"><div><p className="eyebrow">WALLET-CONFIRMED</p><h2>Rhea swaps</h2></div></div><div className="activity-swap-list">{walletSwaps.map(swap=><article className="intent-swap-history-row" key={swap.id}><span>{assetLabel(swap.originAsset)} → {assetLabel(swap.destinationAsset)}<small>{fmtExact(swap.amountIn,assets.find(asset=>asset.assetId===swap.originAsset)?.decimals??0)} → {fmtExact(swap.amountOut,assets.find(asset=>asset.assetId===swap.destinationAsset)?.decimals??0)} · {new Date(swap.createdAt).toLocaleString()}</small><small><a href={`https://nearblocks.io/txns/${encodeURIComponent(swap.txHash)}`} target="_blank" rel="noreferrer">View NEAR transaction <ExternalLink size={12}/></a></small></span><strong>{swap.status==="SUCCESS"?"Complete":swap.status==="FAILED"?"Failed":"Submitted"}</strong>{swap.status==="PENDING"&&<button className="mini-icon" aria-label="Refresh wallet swap status" onClick={()=>onRefreshWalletSwap(swap.id)} disabled={walletSwapStatusBusyId===swap.id}>{walletSwapStatusBusyId===swap.id?<span className="loader small"/>:<RefreshCw size={14}/>}</button>}</article>)}</div></>}
    {swaps.length===0&&walletSwaps.length===0?<div className="empty-activity"><Activity size={24}/><strong>No saved swaps yet</strong><span>Wallet-submitted Rhea swaps and NEAR Intents deposits will appear here.</span></div>:swaps.length>0&&<div className="activity-swap-list">{swaps.map(swap=><button className={`intent-swap-history-row ${selected?.id===swap.id?"active":""}`} key={swap.id} onClick={()=>onSelect(swap)}><span>{assetLabel(swap.quote.originAsset)} → {assetLabel(swap.quote.destinationAsset)}<small>{new Date(swap.createdAt).toLocaleString()}</small></span><strong>{swapActivityLabel(swap)}</strong></button>)}</div>}
    {statusError&&!selected&&<div className="execution-status error"><span>{statusError}</span><button className="secondary-button" onClick={onRefreshAll}>Retry</button></div>}
    {selected&&<section className="intent-swap-panel">
      <div className="section-heading compact"><div><p className="eyebrow">{assetLabel(selected.quote.originAsset)} → {assetLabel(selected.quote.destinationAsset)}</p><h2>{failed?"Failed":swapStatusLabel(selected.status)}</h2></div>{!failed&&<button className="icon-button light" aria-label="Refresh swap status" onClick={()=>onRefresh(selected.id)} disabled={statusBusyId===selected.id}>{statusBusyId===selected.id?<span className="loader small"/>:<RefreshCw size={15}/>}</button>}</div>
      {failed?<div className="execution-status error" role="status"><strong>Failed</strong></div>:<>
      {previewOutput&&<div className="execution-status off"><strong>Price changed before deposit</strong><span>Original estimate: {fmtExact(previewOutput,assets.find(asset=>asset.assetId===selected.quote.destinationAsset)?.decimals??0)} {assetLabel(selected.quote.destinationAsset)}. Current executable estimate: {fmtExact(selected.quote.amountOut,assets.find(asset=>asset.assetId===selected.quote.destinationAsset)?.decimals??0)} {assetLabel(selected.quote.destinationAsset)}.</span><label className="investment-choice"><input type="checkbox" checked={repriceAccepted} onChange={onAcceptReprice}/><span><strong>I reviewed the updated output and want to continue.</strong></span></label></div>}
      {selected.status==="PENDING_DEPOSIT"&&<div className="activity-next-step">
        <strong>{selected.originChain==="near"?"Next: send the deposit from your NEAR wallet":"Next: deposit from your external wallet"}</strong>
        <p>Send exactly {fmtExact(selected.quote.amountIn,assets.find(asset=>asset.assetId===selected.quote.originAsset)?.decimals??0)} {assetLabel(selected.quote.originAsset)} to the address below{selected.quote.depositMemo?" and include the required memo":""}. Pocket Near cannot send assets on another chain.</p>{selected.originTokenContract&&<small>If this token requires recipient storage registration, your wallet will show a separate one-time fee before the transfer. The transfer is sent only after registration is confirmed.</small>}
        {selected.originChain==="near"&&<button className="primary-button" onClick={onSendNear} disabled={busy||Boolean(selected.depositTxHash)||Boolean(previewOutput&&!repriceAccepted)}>{busy?<span className="loader small"/>:"Send from NEAR wallet"}</button>}
        {selected.originChain!=="near"&&!selected.depositTxHash&&<p className="meme-disclaimer">Send from a wallet on {selected.originChain} to this exact 1-Click address and include the memo. Pocket Near cannot identify a transaction sent elsewhere; status updates when 1-Click detects this deposit. Use Refresh status if it does not update.</p>}
      </div>}
      {["KNOWN_DEPOSIT_TX","PROCESSING"].includes(selected.status)&&<p className="activity-next-step">Your swap is still in progress. Pocket Near will refresh the provider status automatically.</p>}
      {selected.status==="SUCCESS"&&<p className="activity-next-step">The provider reports this swap as complete.</p>}
      {(statusError||selected.status==="PENDING_DEPOSIT")&&statusError&&<div className="execution-status error"><strong>Status update failed</strong><span>{statusError}</span><button className="secondary-button" onClick={()=>onRefresh(selected.id)}>Retry status refresh</button></div>}
      {(!previewOutput||repriceAccepted)&&<details className="swap-technical-details"><summary>Deposit and transaction details</summary><div className="intent-swap-facts"><span>Deposit amount</span><strong>{fmtExact(selected.quote.amountIn,assets.find(asset=>asset.assetId===selected.quote.originAsset)?.decimals??0)} {assetLabel(selected.quote.originAsset)}</strong><span>Estimated output</span><strong>{fmtExact(selected.quote.amountOut,assets.find(asset=>asset.assetId===selected.quote.destinationAsset)?.decimals??0)} {assetLabel(selected.quote.destinationAsset)}</strong><span>Deposit address</span><code>{selected.quote.depositAddress??"Not provided"}</code>{selected.quote.depositMemo&&<><span>Required memo</span><code>{selected.quote.depositMemo}</code></>}{selected.depositTxHash&&<><span>Transaction hash</span><code>{selected.depositTxHash}</code></>}</div>{selected.depositTxHash&&selected.originChain==="near"&&<a href={`https://nearblocks.io/txns/${encodeURIComponent(selected.depositTxHash)}`} target="_blank" rel="noreferrer">View NEAR transaction <ExternalLink size={13}/></a>}</details>}
      </>}
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
  positions:Array<{id:string;tokenId:string;symbol:string;amount:string;decimals:number;valueUsd:number|null;kind:"deposit"|"rnear_staked"|"rnear_balance"|"rnear_pending";nearEquivalent:string|null;canWithdraw:boolean|null;estimatedUnlockAtMs:number|null}>;
  positionsLoading:boolean;
  positionsError:string;
  positionsCoverage:string;
  rnearStatus:{apyPct:number|null;ftPrice:number|null;stakedNear:string;pendingNear:string;canWithdraw:boolean|null;estimatedUnlockAtMs:number|null;source:string;observedAt:string}|null;
  onRefreshPositions:()=>void;
};

const fmtPosition=(raw:string,decimals:number)=>{try{const value=BigInt(raw),base=10n**BigInt(decimals),scale=1000n;let rounded=(value*scale+base/2n)/base;const whole=rounded/scale,fraction=(rounded%scale).toString().padStart(3,"0").replace(/0+$/g,"");return fraction?`${whole}.${fraction}`:whole.toString();}catch{return raw;}};
const fmtPositionDecimal=(value:string)=>{const number=Number(value);return Number.isFinite(number)?new Intl.NumberFormat("en-US",{maximumFractionDigits:3}).format(number):value;};

export function EarnScreen({protocols,loading,error,onRefresh,onDiscover,accountId,nativeBalance,busy,onConnect,onStake,positions,positionsLoading,positionsError,positionsCoverage,rnearStatus,onRefreshPositions}:EarnScreenProps){
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
      {rnearStatus&&<small>Rhea-reported staking APY: {rnearStatus.apyPct===null?"unavailable":`${rnearStatus.apyPct.toFixed(2)}%`} · observed {new Date(rnearStatus.observedAt).toLocaleString()}.</small>}
    </section>
    <section className="flywheel-card detected-positions-card">
      <div className="section-heading compact"><div><p className="eyebrow">RHEA POSITIONS</p><h2>Detected positions</h2></div><button className="icon-button light" aria-label="Refresh detected positions" onClick={onRefreshPositions} disabled={positionsLoading}><RefreshCw size={15}/></button></div>
      {positionsLoading?<div className="empty-activity"><span className="loader"/><strong>Checking Rhea positions…</strong></div>:positionsError?<div className="alert error"><span>{positionsError}</span><button onClick={onRefreshPositions}>Retry</button></div>:<>
        <div className="position-summary-grid"><article><span>NEAR staked</span><strong>{rnearStatus?fmtPositionDecimal(rnearStatus.stakedNear):"—"} <small>NEAR</small></strong></article><article><span>rNEAR in wallet</span><strong>{fmtPosition(positions.find(position=>position.kind==="rnear_balance")?.amount??"0",positions.find(position=>position.kind==="rnear_balance")?.decimals??24)} <small>rNEAR</small></strong></article></div>
        {positions.length===0?<div className="empty-activity"><Wallet size={22}/><strong>No supported Rhea positions detected</strong><span>{positionsCoverage||"Connect a wallet to inspect supported Rhea positions."}</span></div>:<div className="market-list">{positions.map(position=><article className="market-row" key={position.id}><div className="coin-mark">{position.symbol.slice(0,1)}</div><div className="market-name"><strong>{fmtPosition(position.amount,position.decimals)} {position.symbol}</strong><span>{position.kind==="rnear_staked"?"NEAR staked via Rhea":position.kind==="rnear_balance"?"rNEAR available in wallet":position.kind==="rnear_pending"?`Pending unstake${position.canWithdraw===true?" · ready to withdraw":position.canWithdraw===false?" · still unlocking":""}`:position.tokenId}</span></div><div className="market-price"><strong>{position.valueUsd===null?position.nearEquivalent?`${fmtPositionDecimal(position.nearEquivalent)} NEAR`:"—":usd(position.valueUsd)}</strong><span>{position.kind==="rnear_staked"?"Staked":position.kind==="rnear_balance"?"rNEAR balance":position.kind==="rnear_pending"?"Unstaking":"Rhea deposit"}</span></div></article>)}</div>}
        {positionsCoverage&&<p className="meme-disclaimer">{positionsCoverage}</p>}
      </>}
    </section>
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
  sentimentRefreshVersion:number;
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

function FearGreedMeter({refreshVersion}:{refreshVersion:number}){
  const [sentiment,setSentiment]=useState<MarketSentiment|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const refresh=async()=>{
    setLoading(true);setError("");
    try{setSentiment(await api.marketSentiment(true));}
    catch(e){setError(e instanceof Error?e.message:"The sentiment index is unavailable.");}
    finally{setLoading(false);}
  };
  useEffect(()=>{void refresh();},[refreshVersion]);
  return <article className="sentiment-card">
    <div className="section-heading compact"><div><p className="eyebrow">MARKET SENTIMENT</p><h2>Fear &amp; Greed</h2></div><button className="icon-button light" aria-label="Refresh market sentiment" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={15}/></button></div>
    {sentiment?<><div className="sentiment-value"><strong>{sentiment.value}</strong><span>/ 100</span></div><div className="sentiment-track" role="meter" aria-label="Fear and Greed index score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={sentiment.value}><span style={{width:`${sentiment.value}%`}}/></div><small>Daily index observation: {new Date(sentiment.observedAt).toLocaleString()}</small><small>Last checked: {new Date(sentiment.updatedAt).toLocaleString()}</small><small>Source: Alternative.me · broad crypto-market index, not NEAR-specific; the score usually changes once per day.</small>{error&&<div className="execution-status error"><span>Could not refresh; showing the previous reading. {error}</span><button className="secondary-button" onClick={()=>void refresh()} disabled={loading}>Retry</button></div>}</>:error?<div className="execution-status error"><span>{error}</span><button className="secondary-button" onClick={()=>void refresh()} disabled={loading}>Retry</button></div>:<div className="empty-activity"><span className="loader"/><span>Loading latest index…</span></div>}
  </article>;
}

export function MarketPlaceScreen({accountId,nativeBalance,nearPrice,assets,prices,loading,sentimentRefreshVersion,onRefresh,onSwap,memeBoard,memeBoardError,onVoteMeme,watchlist,onToggleWatch,onTradePrice}:MarketPlaceScreenProps){
  const [section,setSection]=useState<"prices"|"memes">("prices");
  const [priceSearch,setPriceSearch]=useState("");
  const visibleRheaMarkets=memeBoard.assets.filter(asset=>asset.verified===true&&asset.frozen===false&&!new Set(["NEAR","WNEAR","USDC","USDT","USN","DAI","REF"]).has(asset.symbol.toUpperCase()));
  return <section className="page-title">
    <div className="watch-heading"><div><p className="eyebrow">EXPLORE · MARKETS</p><h1>Markets</h1></div><button className="icon-button light" aria-label="Refresh market data" onClick={onRefresh} disabled={loading}><RefreshCw size={15}/></button></div>
    <p>Live token prices and observable Rhea market data.</p>
    <FearGreedMeter refreshVersion={sentimentRefreshVersion}/>
    <ThesisFeature accountId={accountId} nativeBalance={nativeBalance} nearPrice={nearPrice}/>
    <div className="watch-secondary">
      <div className="watch-segments" role="tablist" aria-label="Watch data"><button role="tab" aria-selected={section==="prices"} className={section==="prices"?"active":""} onClick={()=>setSection("prices")}>Market prices</button><button role="tab" aria-selected={section==="memes"} className={section==="memes"?"active":""} onClick={()=>setSection("memes")}>Memecoins</button></div>
      {section==="prices"&&<section className="watch-market-section">
        <div className="market-toolbar"><label className="field market-search"><Search size={15}/><input value={priceSearch} onChange={event=>setPriceSearch(event.target.value)} placeholder="Search assets" aria-label="Search prices"/></label><button className="icon-button light" aria-label="Refresh prices" onClick={onRefresh} disabled={loading}><RefreshCw size={15}/></button></div>
        {prices.length===0?<div className="empty-activity"><TrendingUp size={24}/><strong>Prices unavailable</strong><span>Market data could not be loaded. Pull to refresh.</span></div>:<div className="market-list">{prices.filter(price=>`${price.name} ${price.symbol}`.toLowerCase().includes(priceSearch.toLowerCase())).map(price=><article className="market-row" key={price.id}><div className="coin-mark">{price.symbol.slice(0,1)}</div><div className="market-name"><strong>{price.name}</strong><span>{price.symbol}{price.marketCap?` · MCap ${compactUsd(price.marketCap)}`:""}</span></div><div className="market-price"><strong>{usd(price.priceUsd)}</strong><span className={(price.change24hPct??0)>=0?"positive":"negative"}>{price.change24hPct===null?"—":`${price.change24hPct>=0?"+":""}${price.change24hPct.toFixed(2)}%`}</span></div><button className={`mini-icon ${watchlist.includes(price.symbol)?"watched":""}`} aria-label={`${watchlist.includes(price.symbol)?"Remove from":"Add to"} watchlist`} onClick={()=>onToggleWatch(price.symbol)}><Heart size={16} fill={watchlist.includes(price.symbol)?"currentColor":"none"}/></button><button className="mini-trade" onClick={()=>onTradePrice(price)}>Trade</button></article>)}</div>}
        <div className="section-heading compact"><div><p className="eyebrow">YOUR WATCHLIST</p><h2>Saved assets</h2></div></div>
        {watchlist.length===0?<div className="empty-activity"><Heart size={20}/><strong>No saved assets</strong><span>Tap the heart beside a price to add it here.</span></div>:<div className="market-list">{watchlist.map(symbol=>{const row=prices.find(price=>price.symbol===symbol);return row?<article className="market-row" key={symbol}><div className="coin-mark">{symbol.slice(0,1)}</div><div className="market-name"><strong>{row.name}</strong><span>{symbol}</span></div><div className="market-price"><strong>{usd(row.priceUsd)}</strong><span className={(row.change24hPct??0)>=0?"positive":"negative"}>{row.change24hPct===null?"—":`${row.change24hPct>=0?"+":""}${row.change24hPct.toFixed(2)}%`}</span></div><button className="mini-icon watched" aria-label={`Remove ${symbol} from watchlist`} onClick={()=>onToggleWatch(symbol)}><Heart size={16} fill="currentColor"/></button></article>:null;})}</div>}
      </section>}
      {section==="memes"&&<section className="watch-market-section">
        <div className="section-heading compact"><div><p className="eyebrow">RHEA · VERIFIED NEAR TOKENS</p><h2>Rhea memecoins</h2></div></div>
        {memeBoard.status==="coming_soon"||memeBoard.assets.length===0?<article className="coming-soon-card">{memeBoardError?"Rhea markets unavailable":"No verified Rhea memecoins"}<span>{memeBoardError||"Only GeckoTerminal verified, unfrozen tokens are listed. Data refreshes every three minutes."}</span></article>:visibleRheaMarkets.length===0?<div className="empty-activity"><strong>No verified memecoins are currently available.</strong><span>Only verified, unfrozen Rhea tokens appear here.</span></div>:<div className="meme-list">{visibleRheaMarkets.map(asset=>{
          const flags=getRheaMarketRiskFlags(asset);
          return <article className="meme-row" key={asset.assetId}><div className="market-name"><strong>{asset.name||asset.symbol} <small>{asset.symbol} · GT Verified</small></strong><span>{asset.priceUsd===null||asset.priceUsd===undefined?"Price unavailable":usd(asset.priceUsd)} · 24h {asset.priceChange24hPct===null||asset.priceChange24hPct===undefined?"—":`${asset.priceChange24hPct>=0?"+":""}${asset.priceChange24hPct.toFixed(2)}%`} · Liquidity {asset.liquidityUsd===null||asset.liquidityUsd===undefined?"—":compactUsd(asset.liquidityUsd)} · 24h volume {asset.volume24hUsd===null||asset.volume24hUsd===undefined?"—":compactUsd(asset.volume24hUsd)}<span className="market-risk-flags">{flags.length?`Risk signals: ${flags.join(" ")}`:"Verification is metadata review, not a safety endorsement."}</span></span></div><button className="mini-trade" onClick={()=>{const near=assets.find(candidate=>candidate.assetId==="near:wrap.near");if(near)onSwap(asset.assetId,near.assetId);}} disabled={!assets.some(candidate=>candidate.assetId==="near:wrap.near")}>Trade</button></article>;
        })}</div>}
        <p className="meme-disclaimer">GeckoTerminal verification confirms metadata review only and is not an endorsement or safety guarantee. Rhea's freeze status is checked before a token is listed. Trade availability still depends on a live route and wallet support.</p>
      </section>}
    </div>
  </section>;
}
