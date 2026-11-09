import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownUp, ArrowRight, ArrowUpRight, Bell, Bot, Check, ChevronDown, CircleHelp, Clock3, ExternalLink, Fingerprint, Gamepad2, Heart, LockKeyhole, Pause, Play, Plus, RefreshCw, Search, Shield, ShieldAlert, Sparkles, Star, Trash2, TrendingUp, Wallet, X } from "lucide-react";
import type { AgentPolicy, Asset, QuoteInput, QuoteView, PriceRow, EarnProtocol, ExploreApp, ExploreGame, MarketAgentCard, MarketAgentDetail, MemeBoard, MemeVote } from "@pocket-near/shared";
import { canonicalPolicy } from "@pocket-near/shared";
import { api } from "./lib/api.js";
import { CreatePasswordCard, UnlockModal } from "./components/SecurityDialogs.js";
import { HomeScreen, WatchScreen } from "./components/WorkspaceSections.js";
import { connectWallet, disconnectWallet, getConnector, signPolicy, type WalletAccount } from "./lib/wallet.js";

type Tab="Home"|"Watch"|"Swap"|"Discover"|"You";
const fmt=(amount:string,decimals:number)=>{try{const n=BigInt(amount),base=10n**BigInt(decimals);if(decimals===0)return n.toString();const fraction=(n%base).toString().padStart(decimals,"0").slice(0,4).replace(/0+$/g,"");return fraction?`${n/base}.${fraction}`:(n/base).toString();}catch{return "0";}};
const fmtExact=(amount:string,decimals:number)=>{try{const n=BigInt(amount),base=10n**BigInt(decimals);if(decimals===0)return n.toString();const fraction=(n%base).toString().padStart(decimals,"0").replace(/0+$/g,"");return fraction?`${n/base}.${fraction}`:(n/base).toString();}catch{return amount;}};
const toBase=(value:string,decimals:number)=>{const [whole="0",fraction=""]=value.trim().split(".");if(!/^\d+$/.test(whole)||fraction.length>decimals||!/^\d*$/.test(fraction))throw new Error(`Enter at most ${decimals} decimal places.`);return (BigInt(whole)*10n**BigInt(decimals)+BigInt((fraction+"0".repeat(decimals)).slice(0,decimals)||"0")).toString();};
const short=(s:string)=>s.length>24?`${s.slice(0,10)}…${s.slice(-8)}`:s;
const DEFAULT_WINDOW={days:[0,1,2,3,4,5,6],start:"00:00",end:"23:59",timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC"};
const usd=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumSignificantDigits:6}).format(n);
const compactUsd=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(n);

export default function App(){
  const [tab,setTab]=useState<Tab>("Home");
  const [account,setAccount]=useState<WalletAccount|null>(null);
  const [nativeBalance,setNativeBalance]=useState<string|null>(null);
  const [portfolioError,setPortfolioError]=useState("");
  const [assets,setAssets]=useState<Asset[]>([]);
  const [policy,setPolicy]=useState<AgentPolicy|null>(null);
  const [policyActive,setPolicyActive]=useState(false);
  const [passwordSet,setPasswordSet]=useState(false);
  const [assetsReady,setAssetsReady]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  const [agentOn,setAgentOn]=useState(false);
  const [autoOn,setAutoOn]=useState(false);
  const [masterLock,setMasterLock]=useState(false);
  const [autoExecLock,setAutoExecLock]=useState(false);
  const [quote,setQuote]=useState<QuoteView|null>(null);
  const [decision,setDecision]=useState<{allowed:boolean;reason?:string}|null>(null);
  const [events,setEvents]=useState<Array<{event_type:string;details:Record<string,unknown>;created_at:string}>>([]);
  const [fromId,setFromId]=useState("");
  const [toId,setToId]=useState("");
  const [recipient,setRecipient]=useState("");
  const [refundTo,setRefundTo]=useState("");
  const [amount,setAmount]=useState("0.1");
  const [maxTrade,setMaxTrade]=useState("0.25");
  const [daily,setDaily]=useState("1");
  const [weekly,setWeekly]=useState("3");
  const [maxSlippage,setMaxSlippage]=useState("100");
  const [destinationInput,setDestinationInput]=useState("");
  const [windowStart,setWindowStart]=useState("00:00");
  const [windowEnd,setWindowEnd]=useState("23:59");
  const [extraPair,setExtraPair]=useState<{from:string;to:string}|null>(null);
  const [autoRunning,setAutoRunning]=useState(false);
  const [showUnlock,setShowUnlock]=useState(false);
  const [unlockReason,setUnlockReason]=useState("");
  const [unlockAction,setUnlockAction]=useState<((password:string)=>Promise<void>)|null>(null);
  const [agentSection,setAgentSection]=useState<"my"|"market">("my");
  const [marketQuery,setMarketQuery]=useState("");
  const [marketCategory,setMarketCategory]=useState("");
  const [marketAgents,setMarketAgents]=useState<MarketAgentCard[]>([]);
  const [marketCursor,setMarketCursor]=useState<string|null>(null);
  const [marketLoading,setMarketLoading]=useState(false);
  const [marketError,setMarketError]=useState("");
  const [selectedMarket,setSelectedMarket]=useState<MarketAgentDetail|null>(null);
  const [prices,setPrices]=useState<PriceRow[]>([]);
  const [priceSource,setPriceSource]=useState("");
  const [watchlist,setWatchlist]=useState<string[]>([]);
  const [alerts,setAlerts]=useState<Array<{id:number;symbol:string;op:"gte"|"lte";thresholdUsd:number;active:boolean;createdAt:string}>>([]);
  const [priceSearch,setPriceSearch]=useState("");
  const [alertSymbol,setAlertSymbol]=useState("BTC");
  const [alertOp,setAlertOp]=useState<"gte"|"lte">("gte");
  const [alertValue,setAlertValue]=useState("");
  const [earn,setEarn]=useState<EarnProtocol[]>([]);
  const [earnSource,setEarnSource]=useState("");
  const [earnCategory,setEarnCategory]=useState("All");
  const [earnMinTvl,setEarnMinTvl]=useState("");
  const [earnSort,setEarnSort]=useState<"tvl"|"change1d"|"change7d">("tvl");
  const [apps,setApps]=useState<ExploreApp[]>([]);
  const [games,setGames]=useState<ExploreGame[]>([]);
  const [exploreCategory,setExploreCategory]=useState("All");
  const [exploreSort,setExploreSort]=useState<"tvl"|"featured"|"name">("tvl");
  const [exploreSearch,setExploreSearch]=useState("");
  const [selectedApp,setSelectedApp]=useState<ExploreApp|null>(null);
  const [memeBoard,setMemeBoard]=useState<MemeBoard>({status:"coming_soon",assets:[]});
  const [memeBoardError,setMemeBoardError]=useState("");
  const [watchLoading,setWatchLoading]=useState(false);
  const [executionStatus,setExecutionStatus]=useState<{kind:"signed"|"off"|"error";message:string}|null>(null);
  const from=useMemo(()=>assets.find(a=>a.assetId===fromId),[assets,fromId]);
  const to=useMemo(()=>assets.find(a=>a.assetId===toId),[assets,toId]);

  const loadDashboard=useCallback(async()=>{
    const me=await api.me();
    setPasswordSet(me.passwordSet);
    setAgentOn(me.agentEnabled);setAutoOn(me.autoEnabled);
    try{const status=await api.agentStatus();setAgentOn(status.agentEnabled);setAutoOn(status.mode==="auto_inside_policy");setMasterLock(status.masterLock);setAutoExecLock(status.autoExecLock);}catch{/* Older deployments continue to show auth/me status. */}
    if(me.accountId)setAccount({accountId:me.accountId});
    const [assetData,policyData,eventData,alertData]=await Promise.all([api.assets(),api.policy(),api.events(),api.alerts()]);
    const sorted=assetData.assets.sort((a,b)=>a.symbol.localeCompare(b.symbol));
    setAssets(sorted);setAssetsReady(true);setPolicy(policyData.policy?.body??null);setPolicyActive(policyData.policy?.active??false);setEvents(eventData.events);setAlerts(alertData.alerts);
    setDestinationInput(policyData.policy?.body.allowedDestinations.join(", ")??me.accountId??"");
    if(policyData.policy?.body){const saved=policyData.policy.body;const primary=saved.allowedPairs[0];const savedFrom=sorted.find(a=>a.assetId===primary?.from);if(primary){setFromId(primary.from);setToId(primary.to);}if(savedFrom){setMaxTrade(fmt(saved.maxTradeAmount,savedFrom.decimals));setDaily(fmt(saved.dailyLimit,savedFrom.decimals));setWeekly(fmt(saved.weeklyLimit,savedFrom.decimals));}setMaxSlippage(String(saved.maxSlippageBps));setExtraPair(saved.allowedPairs[1]??null);if(saved.timeWindows[0]){setWindowStart(saved.timeWindows[0].start);setWindowEnd(saved.timeWindows[0].end);}}
    if(sorted.length){setFromId(current=>current||sorted.find(a=>a.symbol.toLowerCase().includes("near"))?.assetId||sorted[0]!.assetId);setToId(current=>current||sorted.find(a=>a.symbol.toLowerCase().includes("usdc"))?.assetId||sorted[Math.min(1,sorted.length-1)]!.assetId);}
  },[]);

  useEffect(()=>{
    const webApp=window.Telegram?.WebApp;
    webApp?.ready();webApp?.expand();
    const initData=webApp?.initData;
    const start=async()=>{
      try{if(initData)await api.login(initData);else if(import.meta.env.DEV)await fetch(`${import.meta.env.VITE_API_URL??""}/api/auth/dev`,{method:"POST",credentials:"include"});else throw new Error("Open Pocket Near from Telegram to start a secure session.");await loadDashboard();}
      catch(e){setError(e instanceof Error?e.message:"Could not open Pocket Near.");}
      finally{setLoading(false);}
    };
    void start();
    const c=getConnector();
    const onSignOut=()=>{setAccount(null);setPolicy(null);setPolicyActive(false);setAgentOn(false);};
    c.on("wallet:signOut",onSignOut);
    return()=>{c.off("wallet:signOut",onSignOut);};
  },[loadDashboard]);

  useEffect(()=>{if(!notice)return;const id=window.setTimeout(()=>setNotice(""),4500);return()=>window.clearTimeout(id);},[notice]);

  const fetchQuote=useCallback(async(userInitiated=true):Promise<QuoteView|null>=>{
    if(!account||!from||!to){setError("Connect a wallet and select both assets before requesting a quote.");return null;}
    setError("");
    setQuote(null);
    setDecision(null);
    setExecutionStatus(null);
    setBusy(true);
    try{
      const isNear=(asset:Asset)=>asset.blockchain.toLowerCase()==="near";
      const target=recipient||(isNear(to)?account.accountId:"");
      const refund=refundTo||(isNear(from)?account.accountId:"");
      if(!target||!refund)throw new Error("Enter the destination and refund addresses for the selected chains before requesting a quote.");
      const baseAmount=toBase(amount,from.decimals);
      if(BigInt(baseAmount)<=0n)throw new Error("Enter an amount greater than zero.");
      const slippage=Number(maxSlippage);
      if(!Number.isInteger(slippage)||slippage<1||slippage>500)throw new Error("Slippage tolerance must be between 1 and 500 basis points.");
      const input:QuoteInput={originAsset:from.assetId,destinationAsset:to.assetId,amount:baseAmount,sender:account.accountId,refundTo:refund,recipient:target,slippageToleranceBps:slippage};
      const data=await api.quote(input);setQuote(data.quote);
      if(policy){const result=await api.evaluate(data.quote.id,false,userInitiated);setDecision(result.decision);if(!result.decision.allowed){await api.events().then(v=>setEvents(v.events));}}
      return data.quote;
    }catch(e){setError(e instanceof Error?e.message:"Could not load a live quote.");return null;}finally{setBusy(false);}
  },[account,from,to,amount,maxSlippage,policy,recipient,refundTo]);

  const connect=async()=>{setBusy(true);setError("");try{const a=await connectWallet();const challenge=await api.walletChallenge(a.accountId);const signed=await signPolicy(challenge.message,challenge.recipient,challenge.nonce);await api.walletVerify({...signed,payload:{message:challenge.message,recipient:challenge.recipient,nonce:challenge.nonce}});setAccount(a);setNotice(`Connected ${a.accountId}`);await loadDashboard();}catch(e){setError(e instanceof Error?e.message:"Wallet connection failed.");}finally{setBusy(false);}};

  const savePassword=async(value:string)=>{await api.savePassword(value);setPasswordSet(true);setNotice("Unlock password saved.");try{const me=await api.me();setPasswordSet(me.passwordSet);}catch{/* Password was saved successfully; the next dashboard refresh rechecks auth state. */}};
  const requestUnlock=(reason:string,action:(password:string)=>Promise<void>)=>{setUnlockReason(reason);setUnlockAction(()=>action);};

  const savePolicy=async(unlockPassword:string)=>{
    if(!account||!from||!to)throw new Error("Connect a wallet and select the policy pair first.");
    if(!passwordSet)throw new Error("Create an unlock password before signing a policy.");
    await api.verifyUnlock(unlockPassword);
    const isNear=(asset:Asset)=>asset.blockchain.toLowerCase()==="near";
    const allowedDestinations=destinationInput.split(",").map(v=>v.trim()).filter(Boolean);
    if(!allowedDestinations.length)throw new Error("Enter at least one allowed destination address.");
    const allowedPairs=[{from:from.assetId,to:to.assetId},...(extraPair?[extraPair]:[])];
    const next:AgentPolicy={version:1,accountId:account.accountId,allowedPairs,maxTradeAmount:toBase(maxTrade,from.decimals),dailyLimit:toBase(daily,from.decimals),weeklyLimit:toBase(weekly,from.decimals),allowedDestinations,timeWindows:[{...DEFAULT_WINDOW,start:windowStart,end:windowEnd}],maxSlippageBps:Number(maxSlippage),freeze:false,updatedAt:new Date().toISOString()};
    const challenge=await api.challenge(account.accountId);
    const message=`Pocket Near policy authorization\nAccount: ${account.accountId}\nNonce: ${challenge.nonce}\nPolicy: ${canonicalPolicy(next)}`;
    const signed=await signPolicy(message,challenge.recipient,challenge.nonce);
    await api.savePolicy(next,{...signed,payload:{message,recipient:challenge.recipient,nonce:challenge.nonce}},unlockPassword);
    setPolicy(next);setNotice("Policy saved and signed by your wallet.");
    setPolicyActive(true);
  };

  const toggleFreeze=async(unlockPassword:string)=>{
    if(!policy)return;
    setBusy(true);setError("");
    try{
      await api.verifyUnlock(unlockPassword);
      const next={...policy,freeze:!policy.freeze,updatedAt:new Date().toISOString()};
      const challenge=await api.challenge(policy.accountId);
      const message=`Pocket Near policy authorization\nAccount: ${policy.accountId}\nNonce: ${challenge.nonce}\nPolicy: ${canonicalPolicy(next)}`;
      const signed=await signPolicy(message,challenge.recipient,challenge.nonce);
      await api.savePolicy(next,{...signed,payload:{message,recipient:challenge.recipient,nonce:challenge.nonce}},unlockPassword);
      setPolicy(next);setAgentOn(!next.freeze);setNotice(next.freeze?"Emergency freeze is active.":"Policy updated; agent may run again.");
      setPolicyActive(!next.freeze);
    }catch(e){setError(e instanceof Error?e.message:"Policy update failed.");}finally{setBusy(false);}
  };

  const runAgent=async()=>{setError("");setBusy(true);try{const fresh=await fetchQuote();if(fresh){const result=await api.evaluate(fresh.id,true);setDecision(result.decision);setShowUnlock(true);}}catch(e){setError(e instanceof Error?e.message:"Could not evaluate this request.");}finally{setBusy(false);}};
  const confirmAction=async(unlockPassword:string)=>{
    if(!quote)return;
    setExecutionStatus(null);
    try{
      const result=await api.execute(quote.id,unlockPassword);
      const message=result.signed&&result.requiresWalletSignature
        ?"TEE signed this preview. It was not submitted and no funds moved; settlement is not available in this deployment."
        :"The preview is not submitted. Wallet authorization and a supported submit path are still required.";
      setExecutionStatus({kind:"signed",message});
      setNotice(message);
      await refreshEvents();
    }catch(error){
      const message=error instanceof Error?error.message:"Execution could not be prepared.";
      setExecutionStatus({kind:message.includes("TEE signer is disabled")?"off":"error",message});
      throw error;
    }
  };
  const refreshEvents=async()=>{try{setEvents((await api.events()).events);}catch(e){setError(e instanceof Error?e.message:"Could not refresh activity.");}};
  const safeToggleAgent=async()=>{if(!policy||!policyActive){setError("Sign an active policy before activating the agent.");setTab("You");return;}if(policy.freeze){setError("Emergency freeze is active. Sign an updated policy to resume.");return;}try{const next=!agentOn;await api.agentSettings({agentEnabled:next});setAgentOn(next);setNotice(next?"Agent monitoring. Matches are notified on Telegram.":"Agent paused.");}catch(e){setError(e instanceof Error?e.message:"Could not update agent state.");}};
  const toggleAuto=async(unlockPassword:string)=>{const next=!autoOn;const settings=await api.agentSettings({mode:next?"auto_inside_policy":"notify_only",...(next?{agentEnabled:true}:{}),...(next?{password:unlockPassword}:{})});setAgentOn(settings.agentEnabled);setAutoOn(settings.mode==="auto_inside_policy");setNotice(next?"Auto mode enabled inside the signed policy.":"Auto mode disabled.");};
  const toggleMasterLock=async(unlockPassword?:string)=>{const next=!masterLock;const settings=await api.agentSettings({masterLock:next,...(unlockPassword?{password:unlockPassword}:{})});setMasterLock(settings.masterLock);setNotice(next?"Agent locked.":"Agent unlocked.");};

  const loadPrices=async()=>{setWatchLoading(true);try{const [market,watch,alertData]=await Promise.all([api.prices(),api.watchlist(),api.alerts()]);setPrices(market.rows);setPriceSource(market.source);setWatchlist(watch.symbols);setAlerts(alertData.alerts);}catch(e){setError(e instanceof Error?e.message:"Market data could not be loaded.");}finally{setWatchLoading(false);}};
  const loadDiscover=async()=>{try{const [earnData,appData,gameData]=await Promise.all([api.earn(),api.apps(),api.games()]);setEarn(earnData.protocols);setEarnSource(earnData.source);setApps(appData.apps);setGames(gameData.games);}catch(e){setError(e instanceof Error?e.message:"Discover data could not be loaded.");}try{setMemeBoard(await api.memeBoard());setMemeBoardError("");}catch(e){const message=e instanceof Error?e.message:"Meme asset data could not be loaded.";setMemeBoardError(message);setError(message);}};
  const loadMarket=async(reset=true)=>{setMarketLoading(true);setMarketError("");try{const result=await api.marketAgents(marketQuery,marketCategory,reset?null:marketCursor);setMarketAgents(current=>reset?result.agents:[...current,...result.agents]);setMarketCursor(result.nextCursor);}catch(e){setMarketError(e instanceof Error?e.message:"NEAR Agent Market is temporarily unavailable.");}finally{setMarketLoading(false);}};
  useEffect(()=>{if(tab==="Discover"){void loadDiscover();void loadPrices();}if(tab==="You"){void refreshEvents();if(agentSection==="market")void loadMarket();}},[tab,agentSection]);
  useEffect(()=>{if(tab!=="Watch")return;let active=true;const refresh=()=>{if(active)void loadPrices();};refresh();const id=window.setInterval(refresh,30_000);return()=>{active=false;window.clearInterval(id);};},[tab]);
  useEffect(()=>{if(!account){setNativeBalance(null);setPortfolioError("");return;}let active=true;void api.portfolio().then(data=>{if(!active)return;const near=data.balances.find(b=>b.symbol==="NEAR");setNativeBalance(near?fmt(near.amount,near.decimals):null);setPortfolioError(data.failures.join(" "));}).catch(e=>{if(active)setPortfolioError(e instanceof Error?e.message:"NEAR balance is unavailable.");});return()=>{active=false;};},[account?.accountId]);
  const toggleWatch=async(symbol:string)=>{const next=watchlist.includes(symbol)?watchlist.filter(s=>s!==symbol):[...watchlist,symbol];setWatchlist(next);try{const saved=await api.saveWatchlist(next);setWatchlist(saved.symbols);}catch(e){setWatchlist(watchlist);setError(e instanceof Error?e.message:"Watchlist update failed.");}};
  const createPriceAlert=async()=>{try{await api.createAlert({symbol:alertSymbol,op:alertOp,thresholdUsd:Number(alertValue)});setAlertValue("");setAlerts((await api.alerts()).alerts);setNotice(`${alertSymbol} price alert created.`);}catch(e){setError(e instanceof Error?e.message:"Could not create alert.");}};
  const removePriceAlert=async(id:number)=>{try{await api.deleteAlert(id);setAlerts(current=>current.filter(a=>a.id!==id));}catch(e){setError(e instanceof Error?e.message:"Could not delete alert.");}};
  const setPriceAlertActive=async(id:number,active:boolean)=>{try{const result=await api.setAlertActive(id,active);setAlerts(current=>current.map(a=>a.id===id?result.alert:a));}catch(e){setError(e instanceof Error?e.message:"Could not update alert.");}};
  const tradePrice=(row:PriceRow)=>{const asset=assets.find(a=>a.symbol.toUpperCase()===row.symbol);if(!asset){setError(`No Intents route is currently mapped to ${row.symbol}.`);return;}const near=assets.find(a=>a.blockchain.toLowerCase()==="near");if(!near){setError("A NEAR Intents route is not currently available.");return;}setFromId(asset.assetId);setToId(near.assetId);setTab("Swap");setNotice(`${row.symbol} selected. Enter an amount to request a live quote.`);};
  const openExternal=(url:string)=>{const webApp=window.Telegram?.WebApp;if(webApp?.openLink)webApp.openLink(url);else window.open(url,"_blank","noopener,noreferrer");};
  const openDiscover=async(type:"app"|"game"|"earn",id:string,url:string)=>{try{await api.discover(type,id);}catch{/* Discovery remains usable if optional analytics is unavailable. */}openExternal(url);};
  const swapPair=(origin:string,destination:string)=>{setFromId(origin);setToId(destination);setQuote(null);setDecision(null);setExecutionStatus(null);setTab("Swap");};
  const voteMeme=async(assetId:string,vote:MemeVote)=>{try{await api.voteMeme(assetId,vote);setMemeBoard(await api.memeBoard());setMemeBoardError("");}catch(e){setError(e instanceof Error?e.message:"Your meme vote could not be saved.");}};
  const sharePreview=()=>{if(!quote)return;const fromSymbol=from?.symbol??"asset",toSymbol=to?.symbol??"asset";const status=executionStatus?.kind==="signed"?"TEE-signed preview":"Quote preview";const text=`${status}: ${fmt(quote.amountIn,from?.decimals??0)} ${fromSymbol} → ${fmt(quote.amountOut,to?.decimals??0)} ${toSymbol}. Not submitted; no fill claimed. ${account?short(account.accountId):""} · via Pocket Near`;openExternal(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`);};
  const visibleEarn=[...earn.filter(p=>(earnCategory==="All"||p.category===earnCategory)&&p.tvl>=Number(earnMinTvl||0))].sort((a,b)=>earnSort==="tvl"?b.tvl-a.tvl:(b[earnSort]??-Infinity)-(a[earnSort]??-Infinity));
  const visibleApps=[...apps.filter(a=>(exploreCategory==="All"||a.category===exploreCategory)&&`${a.name} ${a.blurb}`.toLowerCase().includes(exploreSearch.toLowerCase()))].sort((a,b)=>exploreSort==="name"?a.name.localeCompare(b.name):exploreSort==="featured"?Number(b.featured)-Number(a.featured)||((b.tvl??0)-(a.tvl??0)):((b.tvl??0)-(a.tvl??0))||Number(b.featured)-Number(a.featured));

  if(loading)return <main className="splash"><div className="brandmark">pn</div><span className="loader"/><p>Opening your pocket…</p></main>;
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brandmark">pn</div><div><strong>Pocket Near</strong><span>Personal intent desk</span></div></div><div className="topbar-actions">{account&&<span className="wallet-chip"><Wallet size={12}/>{short(account.accountId)}</span>}<button className="icon-button" aria-label="Price alerts" onClick={()=>setTab("Discover")}><Bell size={18}/>{alerts.length>0&&<i/>}</button></div></header>
    <main className="content">
      {error&&<div className="alert error"><ShieldAlert size={17}/><span>{error}</span><button onClick={()=>setError("")} aria-label="Dismiss"><X size={15}/></button></div>}
      {notice&&<div className="alert success"><Check size={17}/><span>{notice}</span><button onClick={()=>setNotice("")} aria-label="Dismiss"><X size={15}/></button></div>}
      {tab==="Home"&&<HomeScreen accountId={account?.accountId??null} nativeBalance={nativeBalance} balanceError={portfolioError} policy={policy} policyActive={policyActive} agentOn={agentOn} autoOn={autoOn} onConnect={()=>void connect()} onNavigate={setTab}/>}
      {tab==="Watch"&&<WatchScreen assets={assets} policy={policy} policyActive={policyActive} agentOn={agentOn} prices={prices} loading={watchLoading} onRefresh={()=>void loadPrices()} onSwap={swapPair} onCreatePolicy={()=>setTab("You")}/>}
      {tab==="Discover"&&<>
        <section className="page-title"><p className="eyebrow">DISCOVER</p><h1>Explore the ecosystem.</h1><p>Market context, apps, memes and opportunities. No trade runs unless you request it in Swap.</p></section>
        <section className="discover-feature"><div className="section-heading compact"><div><p className="eyebrow">INTENTS ASSETS</p><h2>Meme board</h2></div><Sparkles size={17}/></div>
          {memeBoard.status==="coming_soon"||memeBoard.assets.length===0?<article className="coming-soon-card">{memeBoardError?"Meme assets unavailable":"Meme markets are coming soon"}<span>{memeBoardError||"No supported meme assets are currently available through the Intents token catalog. No placeholder tokens or votes are shown."}</span></article>:<div className="meme-list">{memeBoard.assets.map(asset=><article className="meme-row" key={asset.assetId}><div className="market-name"><strong>{asset.name||asset.symbol}</strong><span>{asset.symbol} · {asset.blockchain}</span></div><div className="meme-votes"><button className={asset.userVote==="bull"?"active":""} onClick={()=>void voteMeme(asset.assetId,"bull")} aria-label={`Vote bullish for ${asset.symbol}`}>Bull {asset.bullVotes}</button><button className={asset.userVote==="bear"?"active":""} onClick={()=>void voteMeme(asset.assetId,"bear")} aria-label={`Vote bearish for ${asset.symbol}`}>Bear {asset.bearVotes}</button></div><button className="mini-trade" onClick={()=>{const near=assets.find(candidate=>candidate.blockchain.toLowerCase()==="near");if(near)swapPair(asset.assetId,near.assetId);else setError("A NEAR Intents route is not currently available.");}}>Swap</button></article>)}</div>}
          <p className="meme-disclaimer">Community votes are social only and never affect policies, agent decisions or execution.</p>
        </section>
        <section className="discover-feature"><div className="section-heading compact"><div><p className="eyebrow">AGENT MARKET</p><h2>Discover NEAR agents</h2></div></div><p>Browse live listings inside You, or open the official marketplace in Telegram.</p><button className="secondary-button" onClick={()=>setTab("You")}>Browse agent listings <ArrowRight size={14}/></button><button className="secondary-button" onClick={()=>openExternal("https://market.near.ai")}>Open market.near.ai <ArrowUpRight size={14}/></button></section>
        <article className="coming-soon-card discover-quest"><strong>Quests are coming soon</strong><span>Quest logic, rewards and completion are not available.</span></article>
      </>}
      {tab==="Swap"&&<>
        <section className="greeting"><div><p className="eyebrow">YOUR ACCOUNT</p><h1>Good to see you.</h1></div><div className="secure-pill"><span/> Non-custodial</div></section>
        <section className="wallet-card">
          <div className="wallet-card-top"><div className="wallet-icon"><Wallet size={19}/></div><div className="wallet-meta"><span>Connected wallet</span><strong>{account?short(account.accountId):"Not connected"}</strong></div>{account?<button className="subtle-button" onClick={async()=>{await disconnectWallet();setAccount(null);}}>Disconnect</button>:<button className="connect-button" disabled={busy} onClick={()=>void connect()}>{busy?"Connecting…":"Connect wallet"}<ArrowRight size={15}/></button>}</div>
          <div className="wallet-card-bottom"><div><span className="tiny-label">INTENTS PORTFOLIO</span><p>{!account?"Connect your wallet to get started":nativeBalance!==null?`${nativeBalance} NEAR · NEAR RPC`:portfolioError||"Loading NEAR account balance…"}</p></div><span className="live-indicator"><i/> {account?"CONNECTED":"WAITING"}</span></div>
        </section>

        <div className="section-heading"><div><p className="eyebrow">LIVE SOLVER NETWORK</p><h2>Quote monitor</h2></div><button className="icon-button light" aria-label="Refresh quote" onClick={()=>void fetchQuote()} disabled={!account||busy}><RefreshCw size={16}/></button></div>
        <section className="quote-card">
          <div className="pair-line"><div className="asset-select"><select value={fromId} onChange={e=>setFromId(e.target.value)} aria-label="Origin asset">{assets.map(a=><option key={a.assetId} value={a.assetId}>{a.symbol} · {a.blockchain}</option>)}</select><ChevronDown size={14}/></div><button className="swap-directions" aria-label="Reverse pair" onClick={()=>{setFromId(toId);setToId(fromId);}}><ArrowDownUp size={16}/></button><div className="asset-select"><select value={toId} onChange={e=>setToId(e.target.value)} aria-label="Destination asset">{assets.map(a=><option key={a.assetId} value={a.assetId}>{a.symbol} · {a.blockchain}</option>)}</select><ChevronDown size={14}/></div></div>
          {to&&to.blockchain.toLowerCase()!=="near"&&<label className="field chain-address">Destination address · {to.blockchain}<input value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder={`Your ${to.blockchain} address`} autoComplete="off"/></label>}
          {from&&from.blockchain.toLowerCase()!=="near"&&<label className="field chain-address">Refund address · {from.blockchain}<input value={refundTo} onChange={e=>setRefundTo(e.target.value)} placeholder={`Your ${from.blockchain} address`} autoComplete="off"/></label>}
          <label className="amount-label">Amount<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} aria-label="Amount"/><span>{from?.symbol??""}</span></label>
          <button className="primary-button" onClick={()=>void fetchQuote()} disabled={!account||busy||!assetsReady}>{busy?<span className="loader small"/>:<Sparkles size={16}/>}Get live quote</button>
          {quote&&<div className="quote-result"><div className="result-head"><div><span className="eyebrow">ESTIMATED OUTPUT</span><strong>{quote.amountOutFormatted??fmt(quote.amountOut,to?.decimals??0)} <small>{to?.symbol}</small></strong></div><span className={`quote-state ${quote.stale?"stale":""}`}><i/>{quote.stale?"Stale · cache":`Live · ${quote.provider}`}</span></div><div className="quote-details"><div><span>Route</span><b>{quote.route.length?quote.route.map(routePart=>assets.find(asset=>asset.assetId===routePart)?.symbol??routePart).join(" → "):"Not provided by 1-Click"}</b></div><div><span>Fees</span><b>{quote.fees.length?quote.fees.map(f=>{const feeAsset=assets.find(asset=>asset.assetId===f.asset);return `${fmtExact(f.amount,feeAsset?.decimals??0)} ${feeAsset?.symbol??f.asset} ${f.kind}`;}).join(", "):"Fee detail not provided by 1-Click"}</b></div>{quote.minAmountOut&&<div><span>Minimum output</span><b>{fmt(quote.minAmountOut,to?.decimals??0)} {to?.symbol}</b></div>}<div><span>Slippage</span><b>{(quote.slippageBps/100).toFixed(2)}%</b></div><div><span>Expires</span><b><Clock3 size={12}/>{new Date(quote.expiresAt).toLocaleTimeString()}</b></div><div><span>Quote source</span><b>{quote.stale?"Stale cache":quote.provider}</b></div></div><div className={`policy-status ${decision?.allowed?"ok":"blocked"}`}><Shield size={15}/><span>{decision?.allowed?"Inside policy · wallet confirmation still required":decision?.reason??"Policy match pending"}</span></div><button className="preview-button" onClick={()=>void runAgent()} disabled={busy||!policy}>Review policy preview <ArrowRight size={14}/></button></div>}
          {quote&&<button className="secondary-button share-preview" onClick={sharePreview}><ArrowUpRight size={14}/>Share quote preview</button>}
          {executionStatus&&<div className={`execution-status ${executionStatus.kind}`} role="status"><strong>{executionStatus.kind==="signed"?"TEE preview signed":executionStatus.kind==="off"?"TEE off · fail-closed":"Execution error"}</strong><span>{executionStatus.message}</span></div>}
          {!quote&&<div className="quote-empty"><Activity size={18}/><span>{account?"Request a quote to see current solver pricing":"Connect a wallet to request a quote"}</span></div>}
        </section>

        <section className={`agent-card ${agentOn?"active":""}`}><div className="agent-head"><div className="agent-orb"><Bot size={20}/></div><div className="agent-title"><span>POLICY AGENT</span><strong>{agentOn?"Watching for matches":"Agent is paused"}</strong></div><button className={`toggle ${agentOn?"on":""}`} onClick={()=>void safeToggleAgent()} aria-label={agentOn?"Pause agent":"Start agent"}><i/></button></div><p className="agent-copy">The backend checks only the pairs in your active signed policy while you are away. Matches are notifications; every on-chain action still needs your wallet signature.</p><div className="agent-footer"><span><i className={agentOn?"green":"gray"}/>{agentOn?"MONITORING":"IDLE"}</span><button onClick={()=>setTab("You")}>Review policy <ArrowRight size={14}/></button></div><div className="agent-footer"><span>Auto mode: {autoOn?"on":"off"}</span><button onClick={()=>autoOn?void toggleAuto(""):requestUnlock("Unlock to enable auto mode",toggleAuto)}>{autoOn?"Turn off":"Turn on auto"}</button></div></section>
        <div className="section-heading compact"><div><p className="eyebrow">ACCOUNT SAFETY</p><h2>Your controls</h2></div></div>
        <section className="control-row"><div className="control-icon"><Fingerprint size={18}/></div><div><strong>Signed policy</strong><span>{policy?`${policy.allowedPairs.length} pair · ${(policy.maxSlippageBps/100).toFixed(2)}% slippage max`:"Set the agent's guardrails"}</span></div><button onClick={()=>setTab("You")}><ArrowRight size={16}/></button></section>
        <section className="control-row"><div className="control-icon warning"><ShieldAlert size={18}/></div><div><strong>Emergency freeze</strong><span>{policy?.freeze?"Agent is frozen":"Immediately pause all agent activity"}</span></div><button onClick={()=>requestUnlock(policy?.freeze?"Unlock to resume the agent":"Unlock to activate emergency freeze",toggleFreeze)} disabled={!policy}><Pause size={15}/></button></section>
      </>}
      {tab==="You"&&<>
        <section className="profile-card"><p className="eyebrow">WALLET PROFILE</p><h2>Pocket name</h2><strong>{account?.accountId??"No wallet connected"}</strong><span>Your NEAR account ID is your identity in Pocket Near. No social username is used.</span>{account&&<button className="subtle-button" onClick={async()=>{await disconnectWallet();setAccount(null);setPolicy(null);}}>Disconnect wallet</button>}</section>
        <article className="coming-soon-card profile-quests"><strong>Quests are coming soon</strong><span>No rewards or completion tracking are active.</span></article>
        <div className="agent-segments" role="tablist" aria-label="Agents"><button role="tab" aria-selected={agentSection==="my"} className={agentSection==="my"?"active":""} onClick={()=>setAgentSection("my")}>My Agent</button><button role="tab" aria-selected={agentSection==="market"} className={agentSection==="market"?"active":""} onClick={()=>setAgentSection("market")}>Marketplace</button></div>
        {agentSection==="my"&&<>
        <section className="page-title"><p className="eyebrow">AGENT SETTINGS</p><h1>Set your guardrails.</h1><p>Every amount and destination is checked before the agent evaluates a quote.</p></section>
        {!account&&<div className="alert info"><Wallet size={17}/>Connect your wallet before creating a signed policy.</div>}
        {!passwordSet&&<CreatePasswordCard onCreate={savePassword}/>}
        <section className="form-card"><div className="form-title"><Shield size={17}/><div><strong>Allowed pair</strong><span>The agent can evaluate this pair only.</span></div></div><div className="form-grid"><label className="field">From<select value={fromId} onChange={e=>setFromId(e.target.value)}>{assets.map(a=><option key={a.assetId} value={a.assetId}>{a.symbol} · {a.blockchain}</option>)}</select></label><label className="field">To<select value={toId} onChange={e=>setToId(e.target.value)}>{assets.map(a=><option key={a.assetId} value={a.assetId}>{a.symbol} · {a.blockchain}</option>)}</select></label></div>{extraPair?<div className="form-grid"><label className="field">Additional pair from<select value={extraPair.from} onChange={e=>setExtraPair({...extraPair,from:e.target.value})}>{assets.map(a=><option key={a.assetId} value={a.assetId}>{a.symbol} · {a.blockchain}</option>)}</select></label><label className="field">Additional pair to<select value={extraPair.to} onChange={e=>setExtraPair({...extraPair,to:e.target.value})}>{assets.map(a=><option key={a.assetId} value={a.assetId}>{a.symbol} · {a.blockchain}</option>)}</select></label><button className="freeze-button" onClick={()=>setExtraPair(null)}>Remove pair</button></div>:<button className="secondary-button" onClick={()=>setExtraPair({from:fromId,to:toId})}><Plus size={14}/>Add allowed pair</button>}<div className="form-grid"><label className="field">Maximum per trade ({from?.symbol})<input inputMode="decimal" value={maxTrade} onChange={e=>setMaxTrade(e.target.value)}/></label><label className="field">Daily limit ({from?.symbol})<input inputMode="decimal" value={daily} onChange={e=>setDaily(e.target.value)}/></label></div><div className="form-grid"><label className="field">Weekly limit ({from?.symbol})<input inputMode="decimal" value={weekly} onChange={e=>setWeekly(e.target.value)}/></label><label className="field">Maximum slippage<input inputMode="numeric" value={maxSlippage} onChange={e=>setMaxSlippage(e.target.value)}/><small>basis points (100 = 1%)</small></label></div><div className="destination"><div className="destination-icon"><Wallet size={15}/></div><div><span>Allowed destination</span><strong>{account?short(account.accountId):"Connect your wallet"}</strong></div><Check size={15}/></div><label className="field">Allowed destination addresses<input value={destinationInput} onChange={e=>setDestinationInput(e.target.value)} placeholder="Comma-separated wallet addresses"/><small>Only these recipients pass the policy check.</small></label><div className="window-note"><Clock3 size={15}/><span>Active every day · 00:00–23:59 ({DEFAULT_WINDOW.timezone})</span></div><div className="form-grid"><label className="field">Window starts<input type="time" value={windowStart} onChange={e=>setWindowStart(e.target.value)}/></label><label className="field">Window ends<input type="time" value={windowEnd} onChange={e=>setWindowEnd(e.target.value)}/></label></div><div className="action-pair"><button className="secondary-button" disabled={busy||!account||!passwordSet} onClick={()=>requestUnlock("Unlock to authorize this policy change",savePolicy)}><Fingerprint size={16}/>Sign and save policy</button><button className="freeze-button" disabled={busy||!policy} onClick={()=>requestUnlock(policy?.freeze?"Unlock to resume the agent":"Unlock to update the signed policy and activate emergency freeze",toggleFreeze)}>{policy?.freeze?<Play size={15}/>:<Pause size={15}/>} {policy?.freeze?"Resume":"Freeze"}</button></div></section>
        {policy&&<section className="signed-note"><Check size={15}/><span>Current policy is signed on {new Date(policy.updatedAt).toLocaleString()} for <b>{short(policy.accountId)}</b>.</span></section>}
        <div className="security-note"><CircleHelp size={17}/><p>Policy limits are enforced by Pocket Near's backend before an action is prepared. The NEAR Intents Verifier authorizes every registered key to act on the account; this app does not keep a delegated key or claim on-chain policy enforcement.</p></div>
        <div className="section-heading compact"><div><p className="eyebrow">MY AGENT</p><h2>Agent status</h2></div><button className="icon-button light" aria-label="Refresh events" onClick={()=>void refreshEvents()}><RefreshCw size={15}/></button></div>
        <section className="agent-card"><div className="agent-head"><div className="agent-orb"><Bot size={19}/></div><div className="agent-title"><span>MY TRADING AGENT</span><strong>{masterLock?"Locked":policy?.freeze?"Frozen":autoOn?"Auto inside policy":agentOn?"Notify only":"Off"}</strong></div></div><p className="agent-copy">Monitoring: {agentOn?"on":"off"} · Auto execution lock: {autoExecLock?"on":"off"} · Policy: {policy?.freeze?"frozen":"active"}</p><div className="agent-footer"><button onClick={()=>void safeToggleAgent()}>{agentOn?"Pause monitoring":"Start monitoring"}</button><button onClick={()=>autoOn?void api.agentSettings({mode:"notify_only"}).then(()=>setAutoOn(false)):requestUnlock("Unlock to enable auto mode",toggleAuto)}>{autoOn?"Use notify only":"Enable auto mode"}</button></div><div className="agent-footer"><button onClick={()=>masterLock?requestUnlock("Unlock the master lock to resume agent monitoring",p=>toggleMasterLock(p)):void toggleMasterLock()}>{masterLock?"Unlock agent":"Lock agent now"}</button><button onClick={()=>autoExecLock?requestUnlock("Unlock to clear the auto execution lock",async p=>{const r=await api.agentSettings({autoExecLock:false,password:p});setAutoExecLock(r.autoExecLock);}):void api.agentSettings({autoExecLock:true}).then(r=>setAutoExecLock(r.autoExecLock))}>{autoExecLock?"Clear auto lock":"Lock auto mode"}</button></div><div className="agent-footer"><button onClick={()=>{setTab("Swap");document.querySelector(".quote-card")?.scrollIntoView({behavior:"smooth"});}}>Open Swap quote <ArrowRight size={14}/></button><button onClick={()=>{const json=JSON.stringify(policy??{version:1,allowedPairs:[],maxTradeAmount:"0",dailyLimit:"0",weeklyLimit:"0",allowedDestinations:[],timeWindows:[],maxSlippageBps:100,freeze:false},null,2);const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([json],{type:"application/json"}));link.download="pocket-near-policy-template.json";link.click();URL.revokeObjectURL(link.href);}}>Export template <ExternalLink size={13}/></button></div></section>
        <div className="section-heading compact"><div><p className="eyebrow">RECENT EVENTS</p><h2>Activity</h2></div></div><button className="secondary-button refresh-events" onClick={()=>void refreshEvents()}><RefreshCw size={15}/>Refresh activity</button>{events.length===0?<div className="empty-activity"><Activity size={24}/><strong>Nothing here yet</strong><span>Quote checks and agent events will appear here.</span></div>:<div className="event-list">{events.map((event,i)=><article className="event" key={`${event.created_at}-${i}`}><div className={`event-icon ${event.event_type}`}><Activity size={15}/></div><div><strong>{event.event_type.replaceAll("_"," ")}</strong><span>{String(event.details.reason??event.details.quoteId??"Policy event recorded")}</span></div><time>{new Date(event.created_at).toLocaleTimeString()}</time></article>)}</div>}
        </>}
        {agentSection==="market"&&<section className="page-title"><p className="eyebrow">NEAR AI AGENT MARKET</p><h1>Marketplace</h1><p>Listings from NEAR Agent Market. Hiring and payment stay on Market.</p><label className="field market-search"><Search size={15}/><input value={marketQuery} onChange={e=>setMarketQuery(e.target.value)} placeholder="Search agents" aria-label="Search agents" onKeyDown={e=>{if(e.key==="Enter")void loadMarket(true);}}/></label><div className="chip-row"><button className={marketCategory===""?"chip active":"chip"} onClick={()=>{setMarketCategory("");void loadMarket(true);}}>All</button>{[...new Set(marketAgents.map(agent=>agent.category).filter((value):value is string=>Boolean(value)))].map(category=><button key={category} className={marketCategory===category?"chip active":"chip"} onClick={()=>{setMarketCategory(category);setMarketLoading(true);setMarketError("");void api.marketAgents(marketQuery,category,null).then(result=>{setMarketAgents(result.agents);setMarketCursor(result.nextCursor);}).catch(e=>setMarketError(e instanceof Error?e.message:"NEAR Agent Market is temporarily unavailable.")).finally(()=>setMarketLoading(false));}}>{category}</button>)}</div><button className="secondary-button" onClick={()=>void loadMarket(true)} disabled={marketLoading}><Search size={15}/>Search</button>{marketError&&<div className="alert error"><span>{marketError}</span><button onClick={()=>void loadMarket(true)}>Retry</button></div>}{marketAgents.length===0&&!marketLoading&&!marketError?<div className="empty-activity"><Bot size={24}/><strong>No listings found</strong><span>Try another search or browse the Agent Market directly.</span><button className="secondary-button" onClick={()=>void openDiscover("app","agent-market","https://market.near.ai")}>Open NEAR Agent Market <ArrowUpRight size={14}/></button></div>:<div className="discover-list">{marketAgents.map(agent=><article className="discover-card" key={agent.id}><div className="discover-top"><div className="discover-icon"><Bot size={17}/></div><span className="rank-badge">{agent.category??"Agent"}</span></div><h2>{agent.name}</h2><p>{agent.tagline}</p><p>{agent.priceLabel}</p><div className="tag-list">{agent.tags.join(" · ")}</div><button className="secondary-button" onClick={async()=>{try{setSelectedMarket((await api.marketAgent(agent.id)).agent);}catch(e){setMarketError(e instanceof Error?e.message:"Could not load listing details.");}}}>Details <ArrowRight size={14}/></button></article>)}</div>}{marketLoading&&<div className="empty-activity"><span className="loader"/><strong>Loading listings…</strong></div>}{marketCursor&&<button className="secondary-button" disabled={marketLoading} onClick={()=>void loadMarket(false)}>Load more</button>}<p className="market-attribution">Listings from NEAR Agent Market</p><a className="secondary-button" href="https://docs.market.near.ai/list-your-agent" target="_blank" rel="noreferrer">List your agent <ArrowUpRight size={14}/></a></section>}
      </>}
      {tab==="Discover"&&<section className="page-title"><p className="eyebrow">MARKET WATCH</p><h1>Prices</h1><p>Live USD prices from {priceSource||"the market feed"}. Price alerts are sent by the bot when its worker is running.</p><div className="market-toolbar"><label className="field market-search"><Search size={15}/><input value={priceSearch} onChange={e=>setPriceSearch(e.target.value)} placeholder="Search assets" aria-label="Search prices"/></label><button className="icon-button light" aria-label="Refresh prices" onClick={()=>void loadPrices()}><RefreshCw size={15}/></button></div>{prices.length===0?<div className="empty-activity"><TrendingUp size={24}/><strong>Prices unavailable</strong><span>Market data could not be loaded. Pull to refresh.</span></div>:<div className="market-list">{prices.filter(p=>`${p.name} ${p.symbol}`.toLowerCase().includes(priceSearch.toLowerCase())).map(p=><article className="market-row" key={p.id}><div className="coin-mark">{p.symbol.slice(0,1)}</div><div className="market-name"><strong>{p.name}</strong><span>{p.symbol}{p.marketCap?` · MCap ${compactUsd(p.marketCap)}`:""}</span></div><div className="market-price"><strong>{usd(p.priceUsd)}</strong><span className={(p.change24hPct??0)>=0?"positive":"negative"}>{p.change24hPct===null?"—":`${p.change24hPct>=0?"+":""}${p.change24hPct.toFixed(2)}%`}</span></div><button className={`mini-icon ${watchlist.includes(p.symbol)?"watched":""}`} aria-label={`${watchlist.includes(p.symbol)?"Remove from":"Add to"} watchlist`} onClick={()=>void toggleWatch(p.symbol)}><Heart size={16} fill={watchlist.includes(p.symbol)?"currentColor":"none"}/></button><button className="mini-trade" onClick={()=>tradePrice(p)} aria-label={`Trade ${p.symbol}`}>Trade</button></article>)}</div>}<div className="section-heading compact"><div><p className="eyebrow">YOUR WATCHLIST</p><h2>Saved assets</h2></div></div>{watchlist.length===0?<div className="empty-activity"><Heart size={20}/><strong>No saved assets</strong><span>Tap the heart beside a price to add it here.</span></div>:<div className="market-list">{watchlist.map(symbol=>{const row=prices.find(p=>p.symbol===symbol);return row?<article className="market-row" key={symbol}><div className="coin-mark">{symbol.slice(0,1)}</div><div className="market-name"><strong>{row.name}</strong><span>{symbol}</span></div><div className="market-price"><strong>{usd(row.priceUsd)}</strong><span className={(row.change24hPct??0)>=0?"positive":"negative"}>{row.change24hPct===null?"—":`${row.change24hPct>=0?"+":""}${row.change24hPct.toFixed(2)}%`}</span></div><button className="mini-icon watched" aria-label={`Remove ${symbol} from watchlist`} onClick={()=>void toggleWatch(symbol)}><Heart size={16} fill="currentColor"/></button></article>:null;})}</div>}<div className="section-heading compact"><div><p className="eyebrow">PRICE ALERTS</p><h2>Create alert</h2></div></div><section className="form-card"><div className="form-grid"><label className="field">Asset<select value={alertSymbol} onChange={e=>setAlertSymbol(e.target.value)}>{prices.map(p=><option key={p.id} value={p.symbol}>{p.symbol}</option>)}</select></label><label className="field">Condition<select value={alertOp} onChange={e=>setAlertOp(e.target.value as "gte"|"lte")}><option value="gte">At or above</option><option value="lte">At or below</option></select></label></div><label className="field">Target USD<input inputMode="decimal" type="number" min="0" step="any" value={alertValue} onChange={e=>setAlertValue(e.target.value)} placeholder="e.g. 100000"/></label><button className="primary-button" disabled={!alertSymbol||!Number(alertValue)} onClick={()=>void createPriceAlert()}>Create alert</button></section>{alerts.length>0&&<><div className="section-heading compact"><div><p className="eyebrow">YOUR RULES</p><h2>Active alerts</h2></div></div><div className="market-list">{alerts.map(a=><article className="market-row alert-row" key={a.id}><div className="market-name"><strong>{a.symbol} {a.op==="gte"?"≥":"≤"} {usd(a.thresholdUsd)}</strong><span>{a.active?"Alert is active":"Paused"}</span></div><button className="mini-icon" aria-label={a.active?"Pause alert":"Activate alert"} onClick={()=>void setPriceAlertActive(a.id,!a.active)}>{a.active?<Pause size={15}/>:<Play size={15}/>}</button><button className="mini-icon" aria-label="Delete alert" onClick={()=>void removePriceAlert(a.id)}><Trash2 size={15}/></button></article>)}</div></>}</section>}
      {tab==="Discover"&&<section className="page-title"><p className="eyebrow">NEAR ECOSYSTEM</p><h1>Earn</h1><p>Explore NEAR DeFi protocols by reported TVL. Information is descriptive, not financial advice. Source: {earnSource||"loading"}.</p><div className="form-grid"><label className="field">Minimum TVL (USD)<input type="number" min="0" value={earnMinTvl} onChange={e=>setEarnMinTvl(e.target.value)} placeholder="Any"/></label><label className="field">Sort<select value={earnSort} onChange={e=>setEarnSort(e.target.value as "tvl"|"change1d"|"change7d")}><option value="tvl">TVL</option><option value="change1d">24h change</option><option value="change7d">7d change</option></select></label></div><div className="chip-row"><button className={earnCategory==="All"?"chip active":"chip"} onClick={()=>setEarnCategory("All")}>All</button>{[...new Set(earn.map(p=>p.category))].map(c=><button className={earnCategory===c?"chip active":"chip"} key={c} onClick={()=>setEarnCategory(c)}>{c}</button>)}</div>{earn.length===0?<div className="empty-activity"><Activity size={23}/><strong>No protocol data</strong><span>Try again when the data source is available.</span></div>:<div className="discover-list">{visibleEarn.map(p=><article className="discover-card" key={p.id}><div className="discover-top"><div className="discover-icon"><TrendingUp size={17}/></div><span className="rank-badge">{p.category}</span></div><h2>{p.name}</h2><p>Reported TVL {p.tvl?compactUsd(p.tvl):"unavailable"}. Changes {p.change1d===null?"unavailable":`${p.change1d.toFixed(2)}% (1d)`}{p.change7d===null?"":` · ${p.change7d.toFixed(2)}% (7d)`}.</p><div className="discover-actions"><button className="secondary-button" onClick={()=>void openDiscover("earn",p.id,p.url)}>Open protocol <ArrowUpRight size={14}/></button></div></article>)}</div>}</section>}
      {tab==="Discover"&&<section className="page-title"><p className="eyebrow">DISCOVER NEAR</p><h1>Explore</h1><p>Apps ranked by available TVL, with curated ecosystem and games links.</p><label className="field market-search"><Search size={15}/><input value={exploreSearch} onChange={e=>setExploreSearch(e.target.value)} placeholder="Search apps" aria-label="Search apps"/></label><label className="field">Sort apps<select value={exploreSort} onChange={e=>setExploreSort(e.target.value as "tvl"|"featured"|"name")}><option value="tvl">TVL ranking</option><option value="featured">Featured</option><option value="name">Name</option></select></label><div className="chip-row">{["All","DeFi","AI","Social","Tools","Bridges","Wallets","Other"].map(c=><button className={exploreCategory===c?"chip active":"chip"} key={c} onClick={()=>setExploreCategory(c)}>{c}</button>)}</div><div className="discover-list">{visibleApps.map(a=><article className="discover-card app-card" key={a.id} onClick={()=>setSelectedApp(a)}><div className="discover-top"><div className="discover-icon"><Star size={17}/></div>{a.featured&&<span className="rank-badge featured"><Star size={11}/>Featured</span>}</div><h2>{a.name}</h2><p>{a.blurb}</p><div className="discover-meta"><span>{a.category}</span><span>{a.tvl?`TVL ${compactUsd(a.tvl)}`:"Curated listing"}</span></div><button className="secondary-button" onClick={e=>{e.stopPropagation();void openDiscover("app",a.id,a.url);}}>Open <ArrowUpRight size={14}/></button></article>)}</div><div className="section-heading compact"><div><p className="eyebrow">OUTBOUND LINKS ONLY</p><h2>Play on NEAR</h2></div></div><div className="discover-list">{games.map(g=><article className="discover-card" key={g.id}><div className="discover-icon"><Gamepad2 size={17}/></div><h2>{g.name}</h2><p>{g.blurb}</p><div className="discover-actions"><span className="tag-list">{g.tags.join(" · ")}</span><button className="secondary-button" onClick={()=>void openDiscover("game",g.id,g.url)}>Open game site <ArrowUpRight size={14}/></button></div></article>)}</div></section>}
    </main>
    <nav className="tabbar">{(["Home","Watch","Swap","Discover","You"] as const).map(name=><button key={name} className={tab===name?"selected":""} onClick={()=>setTab(name)}>{name==="Home"?<Wallet size={18}/>:name==="Watch"?<TrendingUp size={18}/>:name==="Swap"?<ArrowDownUp size={18}/>:name==="Discover"?<Search size={18}/>:<Bot size={18}/>}<span>{name}</span></button>)}</nav>
    {showUnlock&&<div className="modal-backdrop" onClick={()=>setShowUnlock(false)}><section className="confirm-sheet" onClick={e=>e.stopPropagation()}><button className="close-modal" onClick={()=>setShowUnlock(false)}><X size={18}/></button><div className="modal-icon"><Shield size={20}/></div><p className="eyebrow">POLICY PREVIEW</p><h2>{decision?.allowed?"Quote is within your limits":"Quote is blocked"}</h2><p>{decision?.allowed?"This live quote fits the active signed policy. Your wallet must still confirm any on-chain action.":decision?.reason}</p><div className="modal-amount">{quote?fmt(quote.amountIn,from?.decimals??0):amount} <small>{from?.symbol}</small><ArrowRight size={15}/>{quote?fmt(quote.amountOut,to?.decimals??0):"—"} <small>{to?.symbol}</small></div><button className="primary-button" disabled={!decision?.allowed||busy} onClick={()=>{setShowUnlock(false);requestUnlock("Unlock to prepare this action. Your wallet must still authorize any on-chain transaction.",confirmAction);}}><LockKeyhole size={16}/>Unlock to request TEE signing</button><span className="wallet-disclaimer">No authorization key is stored by Pocket Near.</span></section></div>}
    {unlockAction&&<UnlockModal reason={unlockReason} onConfirm={async value=>{await unlockAction(value);setUnlockAction(null);}} onCancel={()=>setUnlockAction(null)}/>}
    {selectedMarket&&<div className="modal-backdrop" onClick={()=>setSelectedMarket(null)}><section className="confirm-sheet" role="dialog" aria-modal="true" onClick={e=>e.stopPropagation()}><button className="close-modal" aria-label="Close listing details" onClick={()=>setSelectedMarket(null)}><X size={18}/></button><p className="eyebrow">{selectedMarket.category??"NEAR AI AGENT MARKET"}</p><h2>{selectedMarket.name}</h2><p>{selectedMarket.description||selectedMarket.tagline}</p><div className="signed-note">{selectedMarket.priceLabel}{selectedMarket.builderName?` · Built by ${selectedMarket.builderName}`:""}</div>{selectedMarket.tags.length>0&&<p className="tag-list">{selectedMarket.tags.join(" · ")}</p>}<button className="primary-button" onClick={()=>void openDiscover("app",`market-${selectedMarket.id}`,selectedMarket.hireUrl)}>Hire on NEAR Agent Market <ArrowUpRight size={14}/></button></section></div>}
    {selectedApp&&<div className="modal-backdrop" onClick={()=>setSelectedApp(null)}><section className="confirm-sheet" onClick={e=>e.stopPropagation()}><button className="close-modal" aria-label="Close details" onClick={()=>setSelectedApp(null)}><X size={18}/></button><p className="eyebrow">{selectedApp.category}</p><h2>{selectedApp.name}</h2><p>{selectedApp.blurb}</p>{selectedApp.tvl&&<div className="signed-note">TVL ranking: {compactUsd(selectedApp.tvl)}</div>}<button className="primary-button" onClick={()=>void openDiscover("app",selectedApp.id,selectedApp.url)}>Open app <ArrowUpRight size={14}/></button></section></div>}
  </div>;
}
