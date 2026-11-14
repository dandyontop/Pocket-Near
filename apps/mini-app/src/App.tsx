import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownUp, ArrowRight, ArrowUpRight, Bell, Bot, Check, ChevronDown, CircleHelp, Clock3, ExternalLink, Fingerprint, Gamepad2, Heart, House, LockKeyhole, Pause, Play, Plus, RefreshCw, Search, Shield, ShieldAlert, Sparkles, Star, Trash2, TrendingUp, UserRound, Wallet, X } from "lucide-react";
import type { AgentPolicy, Asset, IntentSwap, QuoteInput, QuoteView, PriceRow, EarnProtocol, ExploreApp, ExploreGame, MemeBoard, MemeVote } from "@pocket-near/shared";
import { canonicalPolicy } from "@pocket-near/shared";
import { api, ApiRequestError } from "./lib/api.js";
import { CreatePasswordCard, UnlockModal } from "./components/SecurityDialogs.js";
import { PublicLanding } from "./components/PublicLanding.js";
import { connectWallet, disconnectWallet, executeIntentDeposit, executeRheaSwap, executeRNearStake, getConnector, registerRheaRoute, restoreWallet, signPolicy, type WalletAccount } from "./lib/wallet.js";
import { getRheaMarketRiskFlags } from "./lib/rheaRisk.js";

const HomeScreen=lazy(()=>import("./components/WorkspaceSections.js").then(module=>({default:module.HomeScreen})));
const ActivityScreen=lazy(()=>import("./components/WorkspaceSections.js").then(module=>({default:module.ActivityScreen})));
const EarnScreen=lazy(()=>import("./components/WorkspaceSections.js").then(module=>({default:module.EarnScreen})));
const MarketPlaceScreen=lazy(()=>import("./components/WorkspaceSections.js").then(module=>({default:module.MarketPlaceScreen})));
const FlywheelScreen=lazy(()=>import("./components/FlywheelScreen.js").then(module=>({default:module.FlywheelScreen})));
const DiscoverSections=lazy(()=>import("./components/DiscoverSections.js").then(module=>({default:module.DiscoverSections})));
const PolicyEditor=lazy(()=>import("./components/PolicyEditor.js").then(module=>({default:module.PolicyEditor})));

type Tab="Home"|"Swap"|"Activity"|"Explore"|"Profile";
type InvestmentPreferences={alertsEnabled:boolean;symbols:string[];positionMonitoring:boolean;reportFrequency:number;lastSuggestionAt:string|null;nextPositionReportAt:string|null};
type TrackedPosition={id:string;tokenId:string;symbol:string;amount:string;decimals:number;valueUsd:number|null;kind:"deposit"|"rnear_staked"|"rnear_balance"|"rnear_pending";nearEquivalent:string|null;canWithdraw:boolean|null;estimatedUnlockAtMs:number|null};
type RNearStatus={apyPct:number|null;ftPrice:number|null;stakedNear:string;pendingNear:string;canWithdraw:boolean|null;estimatedUnlockAtMs:number|null;source:string;observedAt:string};
type InvestmentOpportunity={id:string;poolId:string;kind:string;tokens:string[];symbols:string[];tvlUsd:number;feeBps:number|null;feeApr24hRunRatePct:number|null;volume24hUsd:number|null;poolType:string|null;updatedAt:string;url:string};
type YieldMetric={valuePct:number|null;source:string|null;observedAt:string|null;basis:string};
type YieldOverview={poolFeeApr:Array<YieldMetric&{poolId:string;symbols:string[]}>;rnearStakingApy:YieldMetric;farmRewardsApr:YieldMetric;lendingSupplyApy:YieldMetric};
const disconnectedWalletKey="pocket-near:disconnected-wallet";
const fmt=(amount:string,decimals:number)=>{try{const n=BigInt(amount),base=10n**BigInt(decimals);if(decimals===0)return n.toString();const fraction=(n%base).toString().padStart(decimals,"0").slice(0,4).replace(/0+$/g,"");return fraction?`${n/base}.${fraction}`:(n/base).toString();}catch{return "0";}};
const fmtExact=(amount:string,decimals:number)=>{try{const n=BigInt(amount),base=10n**BigInt(decimals);if(decimals===0)return n.toString();const fraction=(n%base).toString().padStart(decimals,"0").replace(/0+$/g,"");return fraction?`${n/base}.${fraction}`:(n/base).toString();}catch{return amount;}};
const toBase=(value:string,decimals:number)=>{const [whole="0",fraction=""]=value.trim().split(".");if(!/^\d+$/.test(whole)||fraction.length>decimals||!/^\d*$/.test(fraction))throw new Error(`Enter at most ${decimals} decimal places.`);return (BigInt(whole)*10n**BigInt(decimals)+BigInt((fraction+"0".repeat(decimals)).slice(0,decimals)||"0")).toString();};
const short=(s:string)=>s.length>24?`${s.slice(0,10)}…${s.slice(-8)}`:s;
const DEFAULT_WINDOW={days:[0,1,2,3,4,5,6],start:"00:00",end:"23:59",timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC"};
const ASSET_DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const assetOptionLabel=(asset:Asset)=>`${asset.symbol} · ${asset.blockchain}${asset.assetId.startsWith("near:")?" · Rhea pool":" · Intents"}`;
const usd=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumSignificantDigits:6}).format(n);
const compactUsd=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(n);
const nearTransactionHash=(value:unknown):string|undefined=>{
  if(!value||typeof value!=="object")return undefined;
  const root=value as Record<string,unknown>;
  const transaction=root.transaction&&typeof root.transaction==="object"?root.transaction as Record<string,unknown>:{};
  const hash=transaction.hash??root.transactionHash??root.transaction_hash;
  return typeof hash==="string"&&hash?hash:undefined;
};

export default function App(){
  const [tab,setTab]=useState<Tab>("Home");
  const [exploreSection,setExploreSection]=useState<"Markets"|"Earn"|"Apps & games"|"Agents">("Markets");
  const [networkDetailsOpen,setNetworkDetailsOpen]=useState(false);
  const [swapStep,setSwapStep]=useState<"edit"|"review">("edit");
  const [account,setAccount]=useState<WalletAccount|null>(null);
  const [profileAccountId,setProfileAccountId]=useState<string|null>(null);
  const [nativeBalance,setNativeBalance]=useState<string|null>(null);
  const [portfolioError,setPortfolioError]=useState("");
  const [assets,setAssets]=useState<Asset[]>([]);
  const [policy,setPolicy]=useState<AgentPolicy|null>(null);
  const [policyActive,setPolicyActive]=useState(false);
  const [passwordSet,setPasswordSet]=useState(false);
  const [assetsReady,setAssetsReady]=useState(false);
  const [loading,setLoading]=useState(true);
  const [walletSignInRequired,setWalletSignInRequired]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  const [agentOn,setAgentOn]=useState(false);
  const [masterLock,setMasterLock]=useState(false);
  const [quote,setQuote]=useState<QuoteView|null>(null);
  const [decision,setDecision]=useState<{allowed:boolean;reason?:string}|null>(null);
  const [intentSwaps,setIntentSwaps]=useState<IntentSwap[]>([]);
  const [activeIntentSwap,setActiveIntentSwap]=useState<IntentSwap|null>(null);
  const [depositHash,setDepositHash]=useState("");
  const [swapStatusError,setSwapStatusError]=useState("");
  const [swapStatusBusyId,setSwapStatusBusyId]=useState("");
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
  const [policyPairs,setPolicyPairs]=useState<AgentPolicy["allowedPairs"]>([]);
  const [autoRunning,setAutoRunning]=useState(false);
  const [unlockReason,setUnlockReason]=useState("");
  const [unlockAction,setUnlockAction]=useState<((password:string)=>Promise<void>)|null>(null);
  const [prices,setPrices]=useState<PriceRow[]>([]);
  const [priceSource,setPriceSource]=useState("");
  const [watchlist,setWatchlist]=useState<string[]>([]);
  const [alerts,setAlerts]=useState<Array<{id:number;symbol:string;op:"gte"|"lte";thresholdUsd:number;active:boolean;createdAt:string}>>([]);
  const [investmentPrefs,setInvestmentPrefs]=useState<InvestmentPreferences>({alertsEnabled:false,symbols:["NEAR","USDC","USDT"],positionMonitoring:false,reportFrequency:1,lastSuggestionAt:null,nextPositionReportAt:null});
  const [savingInvestmentPrefs,setSavingInvestmentPrefs]=useState(false);
  const [positions,setPositions]=useState<TrackedPosition[]>([]);
  const [positionsCoverage,setPositionsCoverage]=useState("");
  const [rnearStatus,setRnearStatus]=useState<RNearStatus|null>(null);
  const [positionsLoading,setPositionsLoading]=useState(false);
  const [positionsError,setPositionsError]=useState("");
  const [investmentOpportunities,setInvestmentOpportunities]=useState<InvestmentOpportunity[]>([]);
  const [investmentOpportunitySource,setInvestmentOpportunitySource]=useState("");
  const [investmentOpportunityDisclaimer,setInvestmentOpportunityDisclaimer]=useState("");
  const [yieldOverview,setYieldOverview]=useState<YieldOverview|null>(null);
  const [priceSearch,setPriceSearch]=useState("");
  const [alertSymbol,setAlertSymbol]=useState("BTC");
  const [alertOp,setAlertOp]=useState<"gte"|"lte">("gte");
  const [alertValue,setAlertValue]=useState("");
  const [earn,setEarn]=useState<EarnProtocol[]>([]);
  const [earnSource,setEarnSource]=useState("");
  const [discoverLoading,setDiscoverLoading]=useState(false);
  const [discoverError,setDiscoverError]=useState("");
  const [apps,setApps]=useState<ExploreApp[]>([]);
  const [games,setGames]=useState<ExploreGame[]>([]);
  const [selectedApp,setSelectedApp]=useState<ExploreApp|null>(null);
  const [memeBoard,setMemeBoard]=useState<MemeBoard>({status:"coming_soon",assets:[]});
  const [memeBoardError,setMemeBoardError]=useState("");
  const [rheaRiskAcknowledged,setRheaRiskAcknowledged]=useState(false);
  const [now,setNow]=useState(()=>Date.now());
  const [watchLoading,setWatchLoading]=useState(false);
  const [executionStatus,setExecutionStatus]=useState<{kind:"submitted"|"error";message:string;txHash?:string}|null>(null);
  const from=useMemo(()=>assets.find(a=>a.assetId===fromId),[assets,fromId]);
  const to=useMemo(()=>assets.find(a=>a.assetId===toId),[assets,toId]);
  const rheaRiskAssets=quote?.provider==="rhea"?[quote.originAsset,quote.destinationAsset].map(assetId=>memeBoard.assets.find(asset=>asset.assetId===assetId)??null):[];
  const rheaRiskMessages=rheaRiskAssets.flatMap((asset,index)=>asset?getRheaMarketRiskFlags(asset).map(flag=>`${asset.symbol}: ${flag}`):[`No current market-risk data for ${index===0?from?.symbol??"origin token":to?.symbol??"destination token"}.`]);
  const rheaRiskNeedsAcknowledgement=quote?.provider==="rhea"&&rheaRiskMessages.length>0;
  const quoteExpired=quote?Date.parse(quote.expiresAt)<=now:false;
  const clearActiveQuote=()=>{setQuote(null);setDecision(null);setExecutionStatus(null);setRheaRiskAcknowledged(false);setSwapStep("edit");};

  const loadDashboard=useCallback(async()=>{
    const me=await api.me();
    setPasswordSet(me.passwordSet);
    setAgentOn(me.agentEnabled);
    try{const status=await api.agentStatus();setAgentOn(status.agentEnabled);setMasterLock(status.masterLock);}catch{/* Older deployments continue to show auth/me status. */}
    setProfileAccountId(me.accountId);
    if(me.accountId){
      let disconnectedAccount="";
      try{disconnectedAccount=window.localStorage.getItem(disconnectedWalletKey)??"";}catch{}
      if(disconnectedAccount===me.accountId)setAccount(null);
      else{
        if(disconnectedAccount)try{window.localStorage.removeItem(disconnectedWalletKey);}catch{}
        try{
          const restored=await restoreWallet();
          setAccount(restored?.accountId===me.accountId?restored:null);
        }catch(error){
          setAccount(null);
          setError(error instanceof Error?`Wallet reconnection could not be checked: ${error.message}`:"Wallet reconnection could not be checked.");
        }
      }
    }else setAccount(null);
    const [assetData,policyData,eventData,alertData,investmentData]=await Promise.all([api.assets(),api.policy(),api.events(),api.alerts(),api.investmentPreferences()]);
    const sorted=assetData.assets.sort((a,b)=>a.symbol.localeCompare(b.symbol));
    setAssets(sorted);setAssetsReady(true);setPolicy(policyData.policy?.body??null);setPolicyActive(policyData.policy?.active??false);setEvents(eventData.events);setAlerts(alertData.alerts);setInvestmentPrefs(investmentData.preferences);
    setDestinationInput(policyData.policy?.body.allowedDestinations.join(", ")??me.accountId??"");
    if(policyData.policy?.body){const saved=policyData.policy.body;const primary=saved.allowedPairs[0];const savedFrom=sorted.find(a=>a.assetId===primary?.from);setPolicyPairs(saved.allowedPairs);if(primary){setFromId(primary.from);setToId(primary.to);}if(savedFrom){setMaxTrade(fmt(saved.maxTradeAmount,savedFrom.decimals));setDaily(fmt(saved.dailyLimit,savedFrom.decimals));setWeekly(fmt(saved.weeklyLimit,savedFrom.decimals));}setMaxSlippage(String(saved.maxSlippageBps));if(saved.timeWindows[0]){setWindowStart(saved.timeWindows[0].start);setWindowEnd(saved.timeWindows[0].end);}}
    if(sorted.length){const defaultFrom=sorted.find(a=>a.symbol.toLowerCase().includes("near"))?.assetId||sorted[0]!.assetId;const defaultTo=sorted.find(a=>a.symbol.toLowerCase().includes("usdc"))?.assetId||sorted[Math.min(1,sorted.length-1)]!.assetId;setFromId(current=>current||defaultFrom);setToId(current=>current||defaultTo);if(!policyData.policy?.body)setPolicyPairs([{from:defaultFrom,to:defaultTo}]);}
  },[]);

  useEffect(()=>{
    const webApp=window.Telegram?.WebApp;
    webApp?.ready();webApp?.expand();
    const params=new URLSearchParams(window.location.search);
    const hashParams=new URLSearchParams(window.location.hash.replace(/^#/,""));
    const initData=webApp?.initData||params.get("tgWebAppData")||hashParams.get("tgWebAppData")||"";
    const start=async()=>{
      const browserSession=!initData&&!import.meta.env.DEV;
      try{
        if(initData)await api.login(initData);
        else if(import.meta.env.DEV){
          const response=await fetch(`${import.meta.env.VITE_API_URL??""}/api/auth/dev`,{method:"POST",credentials:"include"});
          if(!response.ok)throw new Error("Development sign-in is unavailable.");
        }
        await loadDashboard();
      }catch(e){
        if(browserSession&&e instanceof ApiRequestError&&e.status===401)setWalletSignInRequired(true);
        else setError(e instanceof Error?e.message:"Could not open Pocket Near.");
      }
      finally{setLoading(false);}
    };
    void start();
    const c=getConnector();
    const onSignOut=()=>{setAccount(null);setQuote(null);setDecision(null);setIntentSwaps([]);setActiveIntentSwap(null);setDepositHash("");};
    c.on("wallet:signOut",onSignOut);
    return()=>{c.off("wallet:signOut",onSignOut);};
  },[loadDashboard]);

  useEffect(()=>{if(!notice)return;const id=window.setTimeout(()=>setNotice(""),4500);return()=>window.clearTimeout(id);},[notice]);
  useEffect(()=>{if(!quote)return;const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer);},[quote?.expiresAt]);
  const fetchQuote=useCallback(async(userInitiated=true):Promise<QuoteView|null>=>{
    if(!account||!from||!to){setError("Connect a wallet and select both assets before requesting a quote.");return null;}
    setError("");
    setQuote(null);
    setDecision(null);
    setExecutionStatus(null);
    setBusy(true);
    try{
      const isNear=(asset:Asset)=>asset.blockchain.toLowerCase()==="near";
      const hasRheaOnlyAsset=from.assetId.startsWith("near:")||to.assetId.startsWith("near:");
      if(hasRheaOnlyAsset&&!(from.assetId.startsWith("near:")&&to.assetId.startsWith("near:")))throw new Error("Rhea-only NEAR pool assets can only be used together in a NEAR-to-NEAR swap. Choose two Rhea pool assets or two assets from the Intents catalog.");
      const target=recipient||(isNear(to)?account.accountId:"");
      const refund=refundTo||(isNear(from)?account.accountId:"");
      if(!target||!refund)throw new Error("Enter the destination and refund addresses for the selected chains before requesting a quote.");
      const baseAmount=toBase(amount,from.decimals);
      if(BigInt(baseAmount)<=0n)throw new Error("Enter an amount greater than zero.");
      const slippage=Number(maxSlippage);
      if(!Number.isInteger(slippage)||slippage<1||slippage>500)throw new Error("Slippage tolerance must be between 1 and 500 basis points.");
      const input:QuoteInput={originAsset:from.assetId,destinationAsset:to.assetId,amount:baseAmount,sender:account.accountId,refundTo:refund,recipient:target,slippageToleranceBps:slippage};
      const data=from.assetId.startsWith("near:")&&to.assetId.startsWith("near:")?await api.rheaQuote({originAsset:input.originAsset,destinationAsset:input.destinationAsset,amount:input.amount,sender:input.sender,slippageToleranceBps:input.slippageToleranceBps}):await api.quote(input);setQuote(data.quote);setRheaRiskAcknowledged(false);setSwapStep("review");
      if(policy&&data.quote.provider!=="rhea"){const result=await api.evaluate(data.quote.id,false,userInitiated);setDecision(result.decision);if(!result.decision.allowed){await api.events().then(v=>setEvents(v.events));}}
      return data.quote;
    }catch(e){setError(e instanceof Error?e.message:"Could not load a live quote.");return null;}finally{setBusy(false);}
  },[account,from,to,amount,maxSlippage,policy,recipient,refundTo]);

  const connect=async()=>{setBusy(true);setError("");try{const a=await connectWallet();const challenge=await api.walletChallenge(a.accountId);const signed=await signPolicy(challenge.message,challenge.recipient,challenge.nonce);await api.walletVerify({...signed,payload:{message:challenge.message,recipient:challenge.recipient,nonce:challenge.nonce}});try{window.localStorage.removeItem(disconnectedWalletKey);}catch{}setAccount(a);setProfileAccountId(a.accountId);await loadDashboard();setWalletSignInRequired(false);setNotice(`Connected ${a.accountId}`);}catch(e){setError(e instanceof Error?e.message:"Wallet connection failed.");}finally{setBusy(false);}};
  const disconnect=async()=>{
    if(!account)return;
    const accountId=account.accountId;
    let storageFailed=false;
    try{window.localStorage.setItem(disconnectedWalletKey,accountId);}catch{storageFailed=true;}
    setBusy(true);setError("");
    let timeoutId=0;
    try{
      await Promise.race([disconnectWallet(),new Promise<never>((_,reject)=>{timeoutId=window.setTimeout(()=>reject(new Error("The wallet provider did not confirm sign-out in time.")),8000);})]);
      setNotice("Wallet disconnected from Pocket Near. Your signed profile and policy are unchanged.");
    }catch(error){setError(`Disconnected from Pocket Near, but the wallet provider did not confirm sign-out: ${error instanceof Error?error.message:"unknown provider error"}`);}
    finally{
      if(timeoutId)window.clearTimeout(timeoutId);
      setAccount(null);setQuote(null);setDecision(null);setExecutionStatus(null);setIntentSwaps([]);setActiveIntentSwap(null);setDepositHash("");setBusy(false);
    }
    if(storageFailed)setError("Wallet was disconnected for this session, but this browser could not save that preference. It may reconnect when Pocket Near is reopened.");
  };

  const savePassword=async(value:string)=>{await api.savePassword(value);setPasswordSet(true);setNotice("Unlock password saved.");try{const me=await api.me();setPasswordSet(me.passwordSet);}catch{/* Password was saved successfully; the next dashboard refresh rechecks auth state. */}};
  const requestUnlock=(reason:string,action:(password:string)=>Promise<void>)=>{setUnlockReason(reason);setUnlockAction(()=>action);};

  const savePolicy=async(unlockPassword:string)=>{
    if(!account||!policyPairs.length)throw new Error("Connect a wallet and add at least one policy pair first.");
    if(!passwordSet)throw new Error("Create an unlock password before signing a policy.");
    await api.verifyUnlock(unlockPassword);
    if(policyPairs.length>30)throw new Error("A policy can include at most 30 pairs.");
    const pairKeys=new Set<string>();
    for(const pair of policyPairs){
      if(!assets.some(asset=>asset.assetId===pair.from)||!assets.some(asset=>asset.assetId===pair.to))throw new Error("Choose policy assets from the Intents asset list.");
      if(pair.from===pair.to)throw new Error("Each policy pair must use two different assets.");
      const key=`${pair.from}:${pair.to}`;
      if(pairKeys.has(key))throw new Error("Remove duplicate policy pairs before signing.");
      pairKeys.add(key);
    }
    const limitAsset=assets.find(asset=>asset.assetId===policyPairs[0]?.from);
    if(!limitAsset)throw new Error("Select an origin asset for the first policy pair.");
    const allowedDestinations=destinationInput.split(",").map(v=>v.trim()).filter(Boolean);
    if(!allowedDestinations.length)throw new Error("Enter at least one allowed destination address.");
    const slippageBps=Number(maxSlippage);
    if(!Number.isInteger(slippageBps)||slippageBps<1||slippageBps>500)throw new Error("Maximum slippage must be between 1 and 500 basis points.");
    const allowedPairs=policyPairs.map(pair=>({...pair}));
    if(allowedPairs.some(pair=>pair.from.startsWith("near:")!==pair.to.startsWith("near:")))throw new Error("Rhea-only NEAR pool assets can only be paired with another Rhea pool asset in a signed policy.");
    const savedWindows=policy?.timeWindows??[DEFAULT_WINDOW];
    const next:AgentPolicy={version:1,accountId:account.accountId,allowedPairs,maxTradeAmount:toBase(maxTrade,limitAsset.decimals),dailyLimit:toBase(daily,limitAsset.decimals),weeklyLimit:toBase(weekly,limitAsset.decimals),allowedDestinations,timeWindows:[{...savedWindows[0]!,start:windowStart,end:windowEnd},...savedWindows.slice(1)],maxSlippageBps:slippageBps,freeze:false,updatedAt:new Date().toISOString()};
    const challenge=await api.challenge(account.accountId);
    const message=`Pocket Near policy authorization\nAccount: ${account.accountId}\nNonce: ${challenge.nonce}\nPolicy: ${canonicalPolicy(next)}`;
    const signed=await signPolicy(message,challenge.recipient,challenge.nonce);
    await api.savePolicy(next,{...signed,payload:{message,recipient:challenge.recipient,nonce:challenge.nonce}},unlockPassword);
    setPolicy(next);clearActiveQuote();setNotice("Policy saved and signed by your wallet. Request a fresh quote under the updated policy.");
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
      setPolicy(next);clearActiveQuote();setAgentOn(!next.freeze);setNotice(next.freeze?"Emergency freeze is active.":"Policy updated; request a fresh quote under the updated policy.");
      setPolicyActive(!next.freeze);
    }catch(e){setError(e instanceof Error?e.message:"Policy update failed.");}finally{setBusy(false);}
  };

  const runAgent=async()=>{if(!quote)return;setError("");setBusy(true);try{const result=await api.evaluate(quote.id,true);setDecision(result.decision);if(result.decision.allowed)setNotice("Policy check passed. Review the deposit details before continuing.");}catch(e){setError(e instanceof Error?e.message:"Could not evaluate this request.");}finally{setBusy(false);}};
  const submitRheaSwap=async()=>{
    if(!account||!quote||quote.provider!=="rhea")return;
    if(rheaRiskNeedsAcknowledgement&&!rheaRiskAcknowledged){setError("Review and acknowledge the current Rhea market-risk signals before continuing.");return;}
    const raw=quote.raw;const tokenIn=String(raw.inputToken??"");const amountIn=String(raw.amount_in??"");
    setBusy(true);setError("");setExecutionStatus(null);
    try{
      const result=await executeRheaSwap({accountId:account.accountId,tokenIn,amount:amountIn,msg:String(raw.msg??""),signature:String(raw.signature??"")});
      const value=result&&typeof result==="object"?result as Record<string,unknown>:{};
      const tx=value.transaction&&typeof value.transaction==="object"?value.transaction as Record<string,unknown>:{};
      const hash=String(value.transactionHash??value.transaction_hash??value.hash??tx.hash??"")||undefined;
      const status=value.status&&typeof value.status==="object"?value.status as Record<string,unknown>:{};
      if("Failure" in status)throw new Error("The NEAR transaction was included but failed. Check the transaction details in your wallet before trying again.");
      setExecutionStatus({kind:"submitted",message:hash?"Rhea swap transaction was submitted by your wallet. Waiting for chain confirmation is handled by the wallet explorer link.":"Your wallet returned from the signing request. Verify transaction status in your wallet before treating the swap as complete.",...(hash?{txHash:hash}:{})});
      if(hash)setNotice(`Swap submitted · ${hash.slice(0,12)}…`);
      await refreshPositions();
    }catch(e){const message=e instanceof Error?e.message:"Wallet did not submit the swap.";setExecutionStatus({kind:"error",message});setError(message);}finally{setBusy(false);}
  };
  const submitRNearStake=async(amount:string)=>{
    if(!account){setError("Connect your NEAR wallet before staking.");return;}
    setBusy(true);setError("");
    try{
      const result=await executeRNearStake({accountId:account.accountId,nearAmount:amount});
      const hash=nearTransactionHash(result);
      const value=result&&typeof result==="object"?result as Record<string,unknown>:{};
      const status=value.status&&typeof value.status==="object"?value.status as Record<string,unknown>:{};
      if("Failure" in status)throw new Error("The wallet transaction failed. Check its details before trying again.");
      setNotice(hash?`Rhea stake submitted · ${hash.slice(0,12)}…`:"Your wallet returned from the staking request. Check the transaction status before treating it as complete.");
      await refreshPositions();
      window.setTimeout(()=>void refreshPositions(),5_000);
    }catch(e){setError(e instanceof Error?e.message:"The NEAR stake was not submitted.");}
    finally{setBusy(false);}
  };
  const registerRheaQuote=async()=>{
    if(!account||!quote||quote.provider!=="rhea")return;
    const registration=quote.raw.registration as {missing?:string[];missingStorage?:Array<{token:string;accountId:string}>}|undefined;
    setBusy(true);setError("");
    try{await registerRheaRoute({accountId:account.accountId,missingTokens:registration?.missing??[],missingStorage:registration?.missingStorage??[]});setNotice("Route registrations confirmed. Fetching a fresh Rhea quote…");}
    catch(e){const message=e instanceof Error?e.message:"Rhea token registration did not complete.";setError(message);return;}
    finally{setBusy(false);}
    await fetchQuote();
  };
  const refreshEvents=async()=>{try{setEvents((await api.events()).events);}catch(e){setError(e instanceof Error?e.message:"Could not refresh activity.");}};
  const refreshPositions=async()=>{setPositionsLoading(true);setPositionsError("");try{const result=await api.positions();setPositions(result.positions);setPositionsCoverage(result.coverage);setRnearStatus(result.rnear??null);}catch(e){setPositionsError(e instanceof Error?e.message:"Could not load NEAR positions.");}finally{setPositionsLoading(false);}};
  const rememberIntentSwap=(swap:IntentSwap)=>{setActiveIntentSwap(swap);setIntentSwaps(current=>[swap,...current.filter(item=>item.id!==swap.id)]);};
  const selectIntentSwap=(swap:IntentSwap)=>{setActiveIntentSwap(swap);setDepositHash(swap.depositTxHash??"");setSwapStatusError("");};
  const refreshIntentSwaps=async()=>{setSwapStatusError("");try{const result=await api.intentSwaps();setIntentSwaps(result.swaps);setActiveIntentSwap(current=>current?result.swaps.find(item=>item.id===current.id)??current:current);}catch(e){setSwapStatusError(e instanceof Error?e.message:"Could not load your saved Intents swaps.");}};
  const startIntentSwap=async()=>{
    if(!quote||quote.provider!=="one-click")return;
    setBusy(true);setError("");setSwapStatusError("");
    try{
      const result=await api.startIntentSwap(quote.id);
      rememberIntentSwap(result.swap);
      setDepositHash(result.swap.depositTxHash??"");
      setNotice(result.reused?"Opened your existing deposit instructions.":"Live deposit quote prepared. Review the amount and address before funding it.");
      setTab("Activity");
    }catch(e){setError(e instanceof Error?e.message:"Could not prepare an executable Intents quote.");}
    finally{setBusy(false);}
  };
  const refreshIntentSwap=async(id:string)=>{
    setSwapStatusBusyId(id);setSwapStatusError("");
    try{rememberIntentSwap((await api.refreshIntentSwap(id)).swap);}
    catch(e){setSwapStatusError(e instanceof Error?e.message:"Could not refresh the Intents swap status.");}
    finally{setSwapStatusBusyId("");}
  };
  const submitIntentDepositHash=async()=>{
    if(!activeIntentSwap||!depositHash.trim())return;
    setBusy(true);setSwapStatusError("");
    try{
      const swap=(await api.submitIntentDeposit(activeIntentSwap.id,depositHash.trim())).swap;
      rememberIntentSwap(swap);setDepositHash(swap.depositTxHash??depositHash.trim());
      setNotice("Deposit transaction sent to 1-Click for verification. The swap is not complete until Explorer reports success.");
    }catch(e){setSwapStatusError(e instanceof Error?e.message:"Could not notify 1-Click about this deposit.");}
    finally{setBusy(false);}
  };
  const sendNearIntentDeposit=async()=>{
    if(!account||!activeIntentSwap)return;
    setBusy(true);setError("");setSwapStatusError("");setExecutionStatus(null);
    try{
      const result=await executeIntentDeposit({accountId:account.accountId,originChain:activeIntentSwap.originChain,tokenContract:activeIntentSwap.originTokenContract,amount:activeIntentSwap.quote.amountIn,depositAddress:activeIntentSwap.quote.depositAddress??"",...(activeIntentSwap.quote.depositMemo?{memo:activeIntentSwap.quote.depositMemo}:{})});
      if(result&&typeof result==="object"){
        const status=(result as Record<string,unknown>).status;
        if(status&&typeof status==="object"&&"Failure" in status)throw new Error("The NEAR deposit transaction failed. Check the transaction in your wallet before retrying.");
      }
      const hash=nearTransactionHash(result);
      if(!hash){
        setExecutionStatus({kind:"submitted",message:"The wallet returned without a transaction hash. Verify the transaction in your wallet, then enter its hash below before notifying 1-Click."});
        return;
      }
      setDepositHash(hash);
      setExecutionStatus({kind:"submitted",message:"Your wallet submitted the NEAR deposit. Sending its hash to 1-Click for verification.",txHash:hash});
      try{
        const swap=(await api.submitIntentDeposit(activeIntentSwap.id,hash)).swap;
        rememberIntentSwap(swap);
        setNotice("Wallet-signed deposit submitted to 1-Click. Waiting for the verified swap status.");
      }catch(e){
        setSwapStatusError(`The wallet submitted this deposit, but 1-Click could not be notified: ${e instanceof Error?e.message:"unknown error"}. Retry with the same transaction hash.`);
      }
    }catch(e){const message=e instanceof Error?e.message:"The NEAR deposit was not submitted.";setExecutionStatus({kind:"error",message});setError(message);}
    finally{setBusy(false);}
  };
  const refreshInvestmentOpportunities=async()=>{try{const result=await api.investmentOpportunities();setInvestmentOpportunities(result.pools);setInvestmentOpportunitySource(result.source);setInvestmentOpportunityDisclaimer(result.disclaimer);setYieldOverview(result.yields);}catch(e){setInvestmentOpportunitySource(e instanceof Error?e.message:"Opportunity data is temporarily unavailable.");}};
  const saveInvestmentPrefs=async()=>{setSavingInvestmentPrefs(true);try{const result=await api.saveInvestmentPreferences({alertsEnabled:investmentPrefs.alertsEnabled,symbols:investmentPrefs.symbols,positionMonitoring:investmentPrefs.positionMonitoring,reportFrequency:investmentPrefs.reportFrequency});setInvestmentPrefs(result.preferences);setNotice("Investment alerts and position reporting settings saved.");}catch(e){setError(e instanceof Error?e.message:"Could not save investment settings.");}finally{setSavingInvestmentPrefs(false);}};
  const safeToggleAgent=async()=>{if(!policy||!policyActive){setError("Sign an active policy before activating the agent.");setTab("Profile");return;}if(policy.freeze){setError("Emergency freeze is active. Sign an updated policy to resume.");return;}try{const next=!agentOn;await api.agentSettings({agentEnabled:next});setAgentOn(next);setNotice(next?"Agent monitoring. Matches are notified on Telegram.":"Agent paused.");}catch(e){setError(e instanceof Error?e.message:"Could not update agent state.");}};
  const toggleMasterLock=async(unlockPassword?:string)=>{const next=!masterLock;const settings=await api.agentSettings({masterLock:next,...(unlockPassword?{password:unlockPassword}:{})});setMasterLock(settings.masterLock);setNotice(next?"Agent locked.":"Agent unlocked.");};

  const loadPrices=async()=>{setWatchLoading(true);try{const [market,watch,alertData]=await Promise.all([api.prices(),api.watchlist(),api.alerts()]);setPrices(market.rows);setPriceSource(market.source);setWatchlist(watch.symbols);setAlerts(alertData.alerts);}catch(e){setError(e instanceof Error?e.message:"Market data could not be loaded.");}finally{setWatchLoading(false);}};
  const loadDiscover=async()=>{setDiscoverLoading(true);setDiscoverError("");try{const [earnData,appData,gameData]=await Promise.all([api.earn(),api.apps(),api.games()]);setEarn(earnData.protocols);setEarnSource(earnData.source);setApps(appData.apps);setGames(gameData.games);}catch(e){const message=e instanceof Error?e.message:"Explore data could not be loaded.";setDiscoverError(message);setError(message);}finally{setDiscoverLoading(false);}};
  const loadMemeBoard=async()=>{try{setMemeBoard(await api.memeBoard());setMemeBoardError("");}catch(e){const message=e instanceof Error?e.message:"Meme asset data could not be loaded.";setMemeBoardError(message);setError(message);}};
  useEffect(()=>{if(!account){setIntentSwaps([]);setActiveIntentSwap(null);setDepositHash("");return;}let active=true;void api.intentSwaps().then(result=>{if(!active)return;setIntentSwaps(result.swaps);setActiveIntentSwap(current=>current?result.swaps.find(item=>item.id===current.id)??current:result.swaps[0]??null);setDepositHash(current=>current||result.swaps[0]?.depositTxHash||"");}).catch(e=>{if(active)setSwapStatusError(e instanceof Error?e.message:"Could not load your saved Intents swaps.");});return()=>{active=false;};},[account?.accountId]);
  useEffect(()=>{
    if(!account||!activeIntentSwap?.depositTxHash||["SUCCESS","FAILED","REFUNDED","INCOMPLETE_DEPOSIT"].includes(activeIntentSwap.status))return;
    let active=true;
    const poll=async()=>{try{const swap=(await api.refreshIntentSwap(activeIntentSwap.id)).swap;if(active)rememberIntentSwap(swap);}catch(e){if(active)setSwapStatusError(e instanceof Error?e.message:"Could not refresh the Intents swap status.");}};
    const timer=window.setInterval(()=>void poll(),10_000);
    return()=>{active=false;window.clearInterval(timer);};
  },[account?.accountId,activeIntentSwap?.id,activeIntentSwap?.depositTxHash,activeIntentSwap?.status]);
  useEffect(()=>{if(tab==="Explore"&&(exploreSection==="Earn"||exploreSection==="Apps & games"))void loadDiscover();if(tab==="Explore"&&exploreSection==="Earn")void refreshPositions();if(tab==="Profile")void refreshEvents();},[tab,exploreSection]);
  useEffect(()=>{if(tab==="Swap"){void loadMemeBoard();return;}if(tab!=="Explore"||exploreSection!=="Markets")return;let active=true;const refresh=()=>{if(active){void loadPrices();void loadMemeBoard();}};refresh();const id=window.setInterval(refresh,30_000);return()=>{active=false;window.clearInterval(id);};},[tab,exploreSection]);
  useEffect(()=>{if(!account){setNativeBalance(null);setPortfolioError("");return;}let active=true;void api.portfolio().then(data=>{if(!active)return;const near=data.balances.find(b=>b.symbol==="NEAR");setNativeBalance(near?fmt(near.amount,near.decimals):null);setPortfolioError(data.failures.join(" "));}).catch(e=>{if(active)setPortfolioError(e instanceof Error?e.message:"NEAR balance is unavailable.");});return()=>{active=false;};},[account?.accountId]);
  const toggleWatch=async(symbol:string)=>{const next=watchlist.includes(symbol)?watchlist.filter(s=>s!==symbol):[...watchlist,symbol];setWatchlist(next);try{const saved=await api.saveWatchlist(next);setWatchlist(saved.symbols);}catch(e){setWatchlist(watchlist);setError(e instanceof Error?e.message:"Watchlist update failed.");}};
  const createPriceAlert=async()=>{try{await api.createAlert({symbol:alertSymbol,op:alertOp,thresholdUsd:Number(alertValue)});setAlertValue("");setAlerts((await api.alerts()).alerts);setNotice(`${alertSymbol} price alert created.`);}catch(e){setError(e instanceof Error?e.message:"Could not create alert.");}};
  const removePriceAlert=async(id:number)=>{try{await api.deleteAlert(id);setAlerts(current=>current.filter(a=>a.id!==id));}catch(e){setError(e instanceof Error?e.message:"Could not delete alert.");}};
  const setPriceAlertActive=async(id:number,active:boolean)=>{try{const result=await api.setAlertActive(id,active);setAlerts(current=>current.map(a=>a.id===id?result.alert:a));}catch(e){setError(e instanceof Error?e.message:"Could not update alert.");}};
  const tradePrice=(row:PriceRow)=>{const asset=assets.find(a=>a.symbol.toUpperCase()===row.symbol);if(!asset){setError(`No Intents route is currently mapped to ${row.symbol}.`);return;}const near=assets.find(a=>a.blockchain.toLowerCase()==="near");if(!near){setError("A NEAR Intents route is not currently available.");return;}setFromId(asset.assetId);setToId(near.assetId);clearActiveQuote();setTab("Swap");setNotice(`${row.symbol} selected. Enter an amount to request a live quote.`);};
  const openExternal=(url:string)=>{const webApp=window.Telegram?.WebApp;if(/^https:\/\/t\.me\//i.test(url)&&webApp?.openTelegramLink)webApp.openTelegramLink(url);else if(webApp?.openLink)webApp.openLink(url);else window.open(url,"_blank","noopener,noreferrer");};
  const openDiscover=async(type:"app"|"game"|"earn",id:string,url:string)=>{try{await api.discover(type,id);}catch{/* Discovery remains usable if optional analytics is unavailable. */}openExternal(url);};
  const swapPair=(origin:string,destination:string)=>{setFromId(origin);setToId(destination);clearActiveQuote();setTab("Swap");};
  const voteMeme=async(assetId:string,vote:MemeVote)=>{try{await api.voteMeme(assetId,vote);setMemeBoard(await api.memeBoard());setMemeBoardError("");}catch(e){setError(e instanceof Error?e.message:"Your meme vote could not be saved.");}};
  const sharePreview=()=>{if(!quote)return;const fromSymbol=from?.symbol??"asset",toSymbol=to?.symbol??"asset";const text=`Quote preview: ${fmt(quote.amountIn,from?.decimals??0)} ${fromSymbol} → ${fmt(quote.amountOut,to?.decimals??0)} ${toSymbol}. Not submitted; no fill claimed. ${account?short(account.accountId):""} · via Pocket Near`;openExternal(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`);};

  if(loading)return <main className="splash"><div className="brandmark">pn</div><span className="loader"/><p>Opening your pocket…</p></main>;
  if(walletSignInRequired)return <PublicLanding busy={busy} error={error} onConnect={()=>void connect()}/>;
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brandmark">pn</div><div><strong>Pocket Near</strong><span>Wallet &amp; ecosystem</span></div></div><div className="topbar-actions">{account&&<span className="wallet-chip"><Wallet size={12}/>{short(account.accountId)}</span>}<button className="icon-button" aria-label="Open profile and alerts" onClick={()=>setTab("Profile")}><Bell size={18}/>{alerts.length>0&&<i/>}</button></div></header>
    <main className="content">
      {error&&<div className="alert error"><ShieldAlert size={17}/><span>{error}</span><button onClick={()=>setError("")} aria-label="Dismiss"><X size={15}/></button></div>}
      {notice&&<div className="alert success"><Check size={17}/><span>{notice}</span><button onClick={()=>setNotice("")} aria-label="Dismiss"><X size={15}/></button></div>}
      {tab==="Home"&&<><Suspense fallback={<div className="empty-activity">Loading Home…</div>}><HomeScreen accountId={account?.accountId??null} nativeBalance={nativeBalance} balanceError={portfolioError} busy={busy} swaps={intentSwaps} assets={assets} agentOn={agentOn} onConnect={()=>void connect()} onDisconnect={()=>void disconnect()} onSwap={()=>setTab("Swap")} onActivity={()=>setTab("Activity")}/></Suspense><details className="home-more-network" onToggle={event=>setNetworkDetailsOpen(event.currentTarget.open)}><summary>More network analytics and scenarios</summary>{networkDetailsOpen&&<Suspense fallback={<div className="empty-activity">Loading network details…</div>}><FlywheelScreen accountId={account?.accountId??null} nativeBalance={nativeBalance} busy={busy} onConnect={()=>void connect()} onStake={amount=>void submitRNearStake(amount)} showStaking={false}/></Suspense>}</details></>}
      {tab==="Activity"&&<Suspense fallback={<div className="empty-activity">Loading Activity…</div>}><ActivityScreen swaps={intentSwaps} selected={activeIntentSwap??intentSwaps[0]??null} assets={assets} depositHash={depositHash} statusError={swapStatusError} busy={busy} statusBusyId={swapStatusBusyId} onSelect={selectIntentSwap} onRefreshAll={()=>void refreshIntentSwaps()} onRefresh={id=>void refreshIntentSwap(id)} onDepositHashChange={setDepositHash} onSendNear={()=>void sendNearIntentDeposit()} onSubmitDepositHash={()=>void submitIntentDepositHash()}/></Suspense>}
      {tab==="Explore"&&<>
        <section className="page-title"><p className="eyebrow">DISCOVER NEAR</p><h1>Explore</h1><p>Find markets, earn opportunities, apps, games and agents.</p></section>
        <div className="discover-segments explore-categories" role="tablist" aria-label="Explore categories">
          {(["Markets","Earn","Apps & games","Agents"] as const).map(category=><button key={category} role="tab" aria-selected={exploreSection===category} className={exploreSection===category?"active":""} onClick={()=>setExploreSection(category)}>{category}</button>)}
        </div>
        {exploreSection==="Markets"&&<><Suspense fallback={<div className="empty-activity">Loading markets…</div>}><MarketPlaceScreen accountId={account?.accountId??null} nativeBalance={nativeBalance} nearPrice={prices.find(price=>price.symbol.toUpperCase()==="NEAR")?.priceUsd??null} assets={assets} prices={prices} loading={watchLoading} onRefresh={()=>void loadPrices()} onSwap={swapPair} memeBoard={memeBoard} memeBoardError={memeBoardError} onVoteMeme={(assetId,vote)=>void voteMeme(assetId,vote)} watchlist={watchlist} onToggleWatch={symbol=>void toggleWatch(symbol)} onTradePrice={tradePrice}/></Suspense>
        <section className="form-card">
          <div className="section-heading compact"><div><p className="eyebrow">PRICE ALERTS</p><h2>Create an alert</h2></div><Bell size={17}/></div>
          <div className="form-grid"><label className="field">Asset<select value={alertSymbol} onChange={event=>setAlertSymbol(event.target.value)}>{prices.map(price=><option key={price.id} value={price.symbol}>{price.symbol}</option>)}</select></label><label className="field">Condition<select value={alertOp} onChange={event=>setAlertOp(event.target.value as "gte"|"lte")}><option value="gte">At or above</option><option value="lte">At or below</option></select></label></div>
          <label className="field">Target USD<input inputMode="decimal" type="number" min="0" step="any" value={alertValue} onChange={event=>setAlertValue(event.target.value)} placeholder="Enter target price"/></label>
          <button className="primary-button" disabled={!alertSymbol||!Number(alertValue)} onClick={()=>void createPriceAlert()}>Create alert</button>
          {alerts.length>0&&<div className="market-list">{alerts.map(alert=><article className="market-row alert-row" key={alert.id}><div className="market-name"><strong>{alert.symbol} {alert.op==="gte"?"≥":"≤"} {usd(alert.thresholdUsd)}</strong><span>{alert.active?"Alert is active":"Paused"}</span></div><button className="mini-icon" aria-label={alert.active?"Pause alert":"Activate alert"} onClick={()=>void setPriceAlertActive(alert.id,!alert.active)}>{alert.active?<Pause size={15}/>:<Play size={15}/>}</button><button className="mini-icon" aria-label="Delete alert" onClick={()=>void removePriceAlert(alert.id)}><Trash2 size={15}/></button></article>)}</div>}
        </section>
</>}
        {exploreSection==="Earn"&&<><Suspense fallback={<div className="empty-activity">Loading earn opportunities…</div>}><EarnScreen protocols={earn} loading={discoverLoading} error={discoverError} onRefresh={()=>void loadDiscover()} onDiscover={(type,id,url)=>void openDiscover(type,id,url)} accountId={account?.accountId??null} nativeBalance={nativeBalance} busy={busy} onConnect={()=>void connect()} onStake={amount=>void submitRNearStake(amount)} pools={investmentOpportunities} poolSource={investmentOpportunitySource} poolDisclaimer={investmentOpportunityDisclaimer} yields={yieldOverview} onRefreshPools={()=>void refreshInvestmentOpportunities()}/></Suspense>
        <div className="section-heading compact"><div><p className="eyebrow">RHEA POSITIONS</p><h2>Detected positions</h2></div><button className="icon-button light" aria-label="Refresh detected positions" onClick={()=>void refreshPositions()} disabled={positionsLoading}><RefreshCw size={15}/></button></div>
        {rnearStatus&&<article className="coming-soon-card"><strong>rNEAR staking</strong><span>Staked: {rnearStatus.stakedNear} NEAR · Pending unstake: {rnearStatus.pendingNear} NEAR · APY: {rnearStatus.apyPct===null?"unavailable":`${rnearStatus.apyPct.toFixed(2)}%`} · rNEAR price: {rnearStatus.ftPrice===null?"unavailable":`${rnearStatus.ftPrice.toFixed(6)} NEAR`}</span><span>{rnearStatus.canWithdraw===null?"Withdrawal status unavailable":rnearStatus.canWithdraw?"Pending NEAR is ready to withdraw":"Pending NEAR is still unlocking"}{rnearStatus.estimatedUnlockAtMs?` · Estimated unlock ${new Date(rnearStatus.estimatedUnlockAtMs).toLocaleString()}`:""}</span><small>Source: {rnearStatus.source} · observed {new Date(rnearStatus.observedAt).toLocaleString()}</small></article>}
        {positionsLoading?<div className="empty-activity"><span className="loader"/><strong>Checking Rhea positions…</strong></div>:positionsError?<div className="alert error"><span>{positionsError}</span><button onClick={()=>void refreshPositions()}>Retry</button></div>:positions.length===0?<div className="empty-activity"><Wallet size={22}/><strong>No supported Rhea positions detected</strong><span>{positionsCoverage||"Connect a wallet to inspect supported Rhea positions."}</span></div>:<><div className="market-list">{positions.map(position=><article className="market-row" key={position.id}><div className="coin-mark">{position.symbol.slice(0,1)}</div><div className="market-name"><strong>{fmtExact(position.amount,position.decimals)} {position.symbol}</strong><span>{position.tokenId}{position.nearEquivalent?` · ${position.nearEquivalent} NEAR equivalent`:""}{position.canWithdraw===true?" · ready to withdraw":position.canWithdraw===false&&position.kind==="rnear_pending"?" · still unlocking":""}</span></div><div className="market-price"><strong>{position.valueUsd===null?"Value unavailable":usd(position.valueUsd)}</strong><span>{position.kind==="rnear_staked"?"rNEAR staking position":position.kind==="rnear_balance"?"Liquid rNEAR balance":position.kind==="rnear_pending"?"Pending withdrawal":"Rhea deposit"}</span></div></article>)}</div><p className="meme-disclaimer">{positionsCoverage}</p></>}
</>}
        {exploreSection==="Apps & games"&&<Suspense fallback={<div className="empty-activity">Loading apps and games…</div>}><DiscoverSections mode="apps" onOpenExternal={openExternal} onDiscover={(type,id,url)=>void openDiscover(type,id,url)} apps={apps} earn={earn} games={games} exploreLoading={discoverLoading} exploreError={discoverError} onRefreshExplore={()=>void loadDiscover()}/></Suspense>}
        {exploreSection==="Agents"&&<Suspense fallback={<div className="empty-activity">Loading NEAR agents…</div>}><DiscoverSections mode="agents" onOpenExternal={openExternal} onDiscover={(type,id,url)=>void openDiscover(type,id,url)} apps={apps} earn={earn} games={games} exploreLoading={discoverLoading} exploreError={discoverError} onRefreshExplore={()=>void loadDiscover()}/></Suspense>}
        </>}
        {tab==="Swap"&&<>
          <section className="page-title"><div className="watch-heading"><div><p className="eyebrow">WALLET-SIGNED SWAPS</p><h1>Swap</h1></div>{account&&<span className="wallet-chip"><Wallet size={12}/>{short(account.accountId)}</span>}</div><p>Get a live quote, review the details, then decide whether to continue.</p></section>
          {!account&&<div className="wallet-card"><p>Connect your wallet before requesting a quote.</p><button className="primary-button" disabled={busy} onClick={()=>void connect()}>{busy?"Connecting…":"Connect wallet"}</button></div>}
          <section className="quote-card swap-flow">
            <div className="swap-step-indicator"><span className={swapStep==="edit"?"active":""}>1 · Enter swap</span><span className={swapStep==="review"?"active":""}>2 · Review quote</span></div>
            {swapStep==="edit"&&<>
            <div className="routebook-route-caption"><span>INTENT ROUTE</span><span>Origin <i aria-hidden="true"/> Destination</span></div>
            <div className="pair-line"><div className="asset-select"><select value={fromId} disabled={busy} onChange={event=>{setFromId(event.target.value);clearActiveQuote();}} aria-label="Origin asset">{assets.map(asset=><option key={asset.assetId} value={asset.assetId}>{assetOptionLabel(asset)}</option>)}</select><ChevronDown size={14}/></div><button className="swap-directions" aria-label="Reverse pair" disabled={busy} onClick={()=>{setFromId(toId);setToId(fromId);clearActiveQuote();}}><ArrowDownUp size={16}/></button><div className="asset-select"><select value={toId} disabled={busy} onChange={event=>{setToId(event.target.value);clearActiveQuote();}} aria-label="Destination asset">{assets.map(asset=><option key={asset.assetId} value={asset.assetId}>{assetOptionLabel(asset)}</option>)}</select><ChevronDown size={14}/></div></div>
              <label className="amount-label">Amount<input inputMode="decimal" value={amount} disabled={busy} onChange={event=>{setAmount(event.target.value);clearActiveQuote();}} aria-label="Amount"/><span>{from?.symbol??""}</span></label>
              {to&&to.blockchain.toLowerCase()!=="near"&&<label className="field chain-address">Destination address · {to.blockchain}<input value={recipient} disabled={busy} onChange={event=>{setRecipient(event.target.value);clearActiveQuote();}} placeholder={`Your ${to.blockchain} address`} autoComplete="off"/></label>}
              {from&&from.blockchain.toLowerCase()!=="near"&&<label className="field chain-address">Refund address · {from.blockchain}<input value={refundTo} disabled={busy} onChange={event=>{setRefundTo(event.target.value);clearActiveQuote();}} placeholder={`Your ${from.blockchain} address`} autoComplete="off"/></label>}
              <button className="primary-button" onClick={()=>void fetchQuote()} disabled={!account||busy||!assetsReady}>{busy?<span className="loader small"/>:<Sparkles size={16}/>}Get live quote</button>
              {!assetsReady&&<p className="meme-disclaimer">Loading supported swap assets…</p>}
            </>}
            {swapStep==="review"&&quote&&<div className="quote-result">
              <div className="result-head"><div><span className="eyebrow">ESTIMATED OUTPUT</span><strong>{quote.amountOutFormatted??fmt(quote.amountOut,to?.decimals??0)} <small>{to?.symbol}</small></strong></div><span className={`quote-state ${quote.stale||quoteExpired?"stale":""}`}><i/>{quote.stale?"Stale · cache":quoteExpired?"Expired · request a new quote":`Live · ${quote.provider}`}</span></div>
              <div className="quote-details">
                <div><span>Deposit amount</span><b>{fmtExact(quote.amountIn,from?.decimals??0)} {from?.symbol}</b></div>
                <div><span>Route</span><b>{quote.route.length?quote.route.map(routePart=>assets.find(asset=>asset.assetId===routePart)?.symbol??routePart).join(" → "):"Not provided by 1-Click"}</b></div>
                <div><span>Fees</span><b>{quote.fees.length?quote.fees.map(fee=>{const feeAsset=assets.find(asset=>asset.assetId===fee.asset);return `${fmtExact(fee.amount,feeAsset?.decimals??0)} ${feeAsset?.symbol??fee.asset} ${fee.kind}`;}).join(", "):quote.provider==="rhea"?"Included in route output":"Fee detail not provided by 1-Click"}</b></div>
                <div><span>Minimum output</span><b>{quote.minAmountOut?`${fmtExact(quote.minAmountOut,to?.decimals??0)} ${to?.symbol}`:"Not provided by provider"}</b></div>
                <div><span>Slippage</span><b>{(quote.slippageBps/100).toFixed(2)}%</b></div>
                <div><span>Expires</span><b><Clock3 size={12}/>{new Date(quote.expiresAt).toLocaleTimeString()}</b></div>
                <div><span>Destination address</span><b>{recipient||(to?.blockchain.toLowerCase()==="near"?account?.accountId:"Not provided")}</b></div>
                <div><span>Refund address</span><b>{refundTo||(from?.blockchain.toLowerCase()==="near"?account?.accountId:"Not provided")}</b></div>
              </div>
              {quote.provider==="rhea"?<>
                <p className="meme-disclaimer">Next action: your wallet will show the Rhea pool swap call and exact NEAR transaction details before you approve it.</p>
                {rheaRiskNeedsAcknowledgement&&<div className="execution-status off"><strong>Review current Rhea market signals</strong>{rheaRiskMessages.map((message,index)=><span key={`${index}:${message}`}>{message}</span>)}<small>These data warnings do not prove a scam, wash trading or bot activity. They are not a security audit.</small><label className="investment-choice"><input type="checkbox" checked={rheaRiskAcknowledged} onChange={event=>setRheaRiskAcknowledged(event.target.checked)}/><span><strong>I reviewed these market signals and want to continue.</strong></span></label></div>}
                {(quote.raw.registration as {ready?:boolean}|undefined)?.ready===false&&<div className="execution-status error"><strong>Route registration needed</strong><span>Rhea reports route tokens that are not registered for this account. Set up the required wallet-approved registrations, then request a fresh quote.</span><button className="secondary-button" onClick={()=>void registerRheaQuote()} disabled={busy}>Register tokens in wallet</button></div>}
                <button className="primary-button" onClick={()=>void submitRheaSwap()} disabled={busy||!account||(quote.raw.registration as {ready?:boolean}|undefined)?.ready!==true||Boolean(rheaRiskNeedsAcknowledgement&&!rheaRiskAcknowledged)||quoteExpired}>{busy?<span className="loader small"/>:"Confirm swap in wallet"}</button>
              </>:<>
                <div className={`policy-status ${decision?.allowed?"ok":"blocked"}`}><Shield size={15}/><span>{decision?.allowed?"Policy check passed · wallet confirmation is still required":decision?.reason??(policy?"Policy check required":"No active signed policy · set one up in Profile → Safety")}</span></div>
                {policy&&<button className="secondary-button" onClick={()=>void runAgent()} disabled={busy}>{busy?<span className="loader small"/>:null}{decision?.allowed?"Recheck policy":"Check policy"}</button>}
                <p className="meme-disclaimer">If you continue, the deposit instructions will appear in Activity. Your wallet must sign and submit the transfer; the quote itself does not move funds.</p>
                {decision?.allowed&&<button className="primary-button" onClick={()=>void startIntentSwap()} disabled={busy||quote.stale||quoteExpired}>{busy?<span className="loader small"/>:"Continue to Activity"}</button>}
              </>}
              <button className="secondary-button" onClick={()=>{clearActiveQuote();setError("");}}>Edit swap</button>
              <button className="secondary-button share-preview" onClick={sharePreview}><ArrowUpRight size={14}/>Share quote preview</button>
            </div>}
            {executionStatus&&<div className={`execution-status ${executionStatus.kind}`} role="status"><strong>{executionStatus.kind==="submitted"?"Wallet transaction submitted":"Transaction error"}</strong><span>{executionStatus.message}</span>{executionStatus.txHash&&<a href={`https://nearblocks.io/txns/${encodeURIComponent(executionStatus.txHash)}`} target="_blank" rel="noreferrer">View transaction on NearBlocks <ExternalLink size={13}/></a>}</div>}
            {swapStep==="edit"&&account&&!quote&&<div className="quote-empty"><Activity size={18}/><span>Select assets and amount, then request a live quote.</span></div>}
          </section>
        </>}
      {tab==="Profile"&&<>
        <section className="page-title"><p className="eyebrow">YOUR ACCOUNT</p><h1>Profile</h1><p>Your wallet, signed policy and safety controls.</p></section>
        <section className="profile-card"><p className="eyebrow">WALLET</p><h2>{account?"Connected wallet":"No wallet connected"}</h2><strong>{profileAccountId??"Connect a NEAR wallet to sign in"}</strong><span>{account?<>Unlocked native balance: {nativeBalance!==null?`${nativeBalance} NEAR`:portfolioError||"Loading balance…"}. Your NEAR account ID is your Pocket Near identity.</>:"Connect your wallet to manage policies and personal settings."}</span>{account?<button className="subtle-button" disabled={busy} onClick={()=>void disconnect()}>Disconnect wallet</button>:<button className="secondary-button" disabled={busy} onClick={()=>void connect()}>Connect wallet <ArrowRight size={14}/></button>}</section>
        <div className="section-heading compact"><div><p className="eyebrow">PROFILE · SAFETY</p><h2>Safety</h2></div><ShieldAlert size={17}/></div>
        <Suspense fallback={<div className="empty-activity">Loading safety settings…</div>}><PolicyEditor assets={assets} accountId={profileAccountId} pairs={policyPairs} onPairsChange={setPolicyPairs} defaultFrom={fromId} defaultTo={toId} maxTrade={maxTrade} setMaxTrade={setMaxTrade} daily={daily} setDaily={setDaily} weekly={weekly} setWeekly={setWeekly} maxSlippage={maxSlippage} setMaxSlippage={setMaxSlippage} destinationInput={destinationInput} setDestinationInput={setDestinationInput} windowStart={windowStart} setWindowStart={setWindowStart} windowEnd={windowEnd} setWindowEnd={setWindowEnd} activeDaysLabel={policy?.timeWindows[0]?.days.length===7?"Every day":policy?.timeWindows[0]?.days.map(day=>ASSET_DAYS[day]).join(", ")??"Every day"} additionalWindowCount={Math.max(0,(policy?.timeWindows.length??1)-1)} timezone={policy?.timeWindows[0]?.timezone??DEFAULT_WINDOW.timezone} busy={busy} passwordSet={passwordSet} canSign={Boolean(account)} hasPolicy={Boolean(policy)} frozen={Boolean(policy?.freeze)} onSign={()=>requestUnlock("Unlock to authorize this policy change",savePolicy)} onFreeze={()=>requestUnlock(policy?.freeze?"Unlock to resume the agent":"Unlock to update the signed policy and activate emergency freeze",toggleFreeze)}/></Suspense>
        <section className="page-title"><h2>Agent monitoring</h2><p>Safety checks apply to policy-controlled swaps; every on-chain transaction still requires your wallet.</p></section>
        {!account&&<div className="alert info"><Wallet size={17}/>Connect your wallet before creating a signed policy.</div>}
        {!passwordSet&&<CreatePasswordCard onCreate={savePassword}/>}
        {policy&&<section className="signed-note"><Check size={15}/><span>Current policy is signed on {new Date(policy.updatedAt).toLocaleString()} for <b>{short(policy.accountId)}</b>.</span></section>}
        <div className="security-note"><CircleHelp size={17}/><p>Policy limits are enforced by Pocket Near's backend before an action is prepared. The NEAR Intents Verifier authorizes every registered key to act on the account; this app does not keep a delegated key or claim on-chain policy enforcement.</p></div>
        <div className="section-heading compact"><div><p className="eyebrow">MY AGENT</p><h2>Agent status</h2></div><button className="icon-button light" aria-label="Refresh events" onClick={()=>void refreshEvents()}><RefreshCw size={15}/></button></div>
        <section className="agent-card"><div className="agent-head"><div className="agent-orb"><Bot size={19}/></div><div className="agent-title"><span>MY TRADING AGENT</span><strong>{masterLock?"Locked":policy?.freeze?"Frozen":agentOn?"Notify only":"Off"}</strong></div></div><p className="agent-copy">Monitoring: {agentOn?"on":"off"} · Policy: {policy?.freeze?"frozen":"active"}</p><div className="agent-footer"><button onClick={()=>void safeToggleAgent()}>{agentOn?"Pause monitoring":"Start monitoring"}</button></div><div className="agent-footer"><button onClick={()=>masterLock?requestUnlock("Unlock the master lock to resume agent monitoring",p=>toggleMasterLock(p)):void toggleMasterLock()}>{masterLock?"Unlock agent":"Lock agent now"}</button></div><div className="agent-footer"><button onClick={()=>{setTab("Swap");document.querySelector(".quote-card")?.scrollIntoView({behavior:"smooth"});}}>Open Swap quote <ArrowRight size={14}/></button><button onClick={()=>{const json=JSON.stringify(policy??{version:1,allowedPairs:[],maxTradeAmount:"0",dailyLimit:"0",weeklyLimit:"0",allowedDestinations:[],timeWindows:[],maxSlippageBps:100,freeze:false},null,2);const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([json],{type:"application/json"}));link.download="pocket-near-policy-template.json";link.click();URL.revokeObjectURL(link.href);}}>Export template <ExternalLink size={13}/></button></div></section>
        <details className="profile-advanced"><summary>Advanced: Rhea monitoring and safety log</summary>
        <section className="form-card investment-settings">
          <div className="section-heading compact"><div><p className="eyebrow">POSITION MONITORING</p><h2>Monitoring settings</h2></div><TrendingUp size={17}/></div>
          <p className="meme-disclaimer">Explore Rhea pools containing NEAR and stablecoins, with reserve based TVL, 24 hour volume and an indicative fee run-rate where the available data supports it.</p>
          <label className="investment-choice"><input type="checkbox" checked={investmentPrefs.alertsEnabled} onChange={event=>setInvestmentPrefs(current=>({...current,alertsEnabled:event.target.checked}))}/><span><strong>Send pool alerts</strong><small>At most one suggestion every 48 hours.</small></span></label>
          <div className="chip-row" aria-label="Investment alert tokens">{["NEAR","USDC","USDT"].map(symbol=><label className={`chip ${investmentPrefs.symbols.includes(symbol)?"active":""}`} key={symbol}><input type="checkbox" checked={investmentPrefs.symbols.includes(symbol)} onChange={event=>setInvestmentPrefs(current=>({...current,symbols:event.target.checked?[...new Set([...current.symbols,symbol])]:current.symbols.filter(item=>item!==symbol)}))}/>{symbol}</label>)}</div>
          <label className="investment-choice"><input type="checkbox" checked={investmentPrefs.positionMonitoring} onChange={event=>setInvestmentPrefs(current=>({...current,positionMonitoring:event.target.checked}))}/><span><strong>Monitor my Rhea deposits</strong><small>Check balances periodically and send position reports.</small></span></label>
          <label className="field">Position reports<select value={investmentPrefs.reportFrequency} onChange={event=>setInvestmentPrefs(current=>({...current,reportFrequency:Number(event.target.value)}))}><option value={1}>Once per day</option><option value={2}>Twice per day</option><option value={3}>Three times per day</option><option value={4}>Four times per day</option></select></label>
          <p className="investment-disclaimer">Position monitoring sends scheduled balance reports and an alert when a detected rNEAR delayed unstake becomes withdrawable. Farm positions and concentrated-liquidity NFT positions are not currently covered. Fee run-rates are estimates and exclude impermanent loss and token-price movement.</p>
          <button className="primary-button" disabled={savingInvestmentPrefs} onClick={()=>void saveInvestmentPrefs()}>{savingInvestmentPrefs?"Saving…":"Save investment settings"}</button>
        </section>
        <div className="section-heading compact"><div><p className="eyebrow">POLICY &amp; AGENT LOG</p><h2>Safety events</h2></div></div><button className="secondary-button refresh-events" onClick={()=>void refreshEvents()}><RefreshCw size={15}/>Refresh safety events</button>{events.length===0?<div className="empty-activity"><Activity size={24}/><strong>No safety events yet</strong><span>Policy checks and agent events will appear here.</span></div>:<div className="event-list">{events.map((event,i)=><article className="event" key={`${event.created_at}-${i}`}><div className={`event-icon ${event.event_type}`}><Activity size={15}/></div><div><strong>{event.event_type.replaceAll("_"," ")}</strong><span>{String(event.details.reason??event.details.quoteId??"Policy event recorded")}</span></div><time>{new Date(event.created_at).toLocaleTimeString()}</time></article>)}</div>}
        </details>
      </>}
    </main>
    <nav className="tabbar">{(["Home","Swap","Activity","Explore","Profile"] as const).map(name=><button key={name} className={tab===name?"selected":""} onClick={()=>setTab(name)}>{name==="Home"?<House size={18}/>:name==="Swap"?<ArrowDownUp size={18}/>:name==="Activity"?<Activity size={18}/>:name==="Explore"?<Search size={18}/>:<UserRound size={18}/>}<span>{name}</span></button>)}</nav>
    {unlockAction&&<UnlockModal reason={unlockReason} onConfirm={async value=>{await unlockAction(value);setUnlockAction(null);}} onCancel={()=>setUnlockAction(null)}/>}
    {selectedApp&&<div className="modal-backdrop" onClick={()=>setSelectedApp(null)}><section className="confirm-sheet" onClick={e=>e.stopPropagation()}><button className="close-modal" aria-label="Close details" onClick={()=>setSelectedApp(null)}><X size={18}/></button><p className="eyebrow">{selectedApp.category}</p><h2>{selectedApp.name}</h2><p>{selectedApp.blurb}</p>{selectedApp.tvl&&<div className="signed-note">TVL ranking: {compactUsd(selectedApp.tvl)}</div>}<button className="primary-button" onClick={()=>void openDiscover("app",selectedApp.id,selectedApp.url)}>Open app <ArrowUpRight size={14}/></button></section></div>}
  </div>;
}
