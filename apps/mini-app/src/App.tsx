import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownUp, ArrowRight, Bell, Bot, Check, ChevronDown, CircleHelp, Clock3, ExternalLink, Fingerprint, LockKeyhole, Pause, Play, Plus, RefreshCw, Shield, ShieldAlert, Sparkles, Wallet, X } from "lucide-react";
import type { AgentPolicy, Asset, QuoteInput, QuoteView } from "../../../packages/shared/dist/index.js";
import { canonicalPolicy } from "../../../packages/shared/dist/index.js";
import { api } from "./lib/api.js";
import { connectWallet, disconnectWallet, getConnector, signPolicy, type WalletAccount } from "./lib/wallet.js";

type Tab="Overview"|"Policy"|"Activity";
const fmt=(amount:string,decimals:number)=>{try{const n=BigInt(amount),base=10n**BigInt(decimals);if(decimals===0)return n.toString();const fraction=(n%base).toString().padStart(decimals,"0").slice(0,4).replace(/0+$/g,"");return fraction?`${n/base}.${fraction}`:(n/base).toString();}catch{return "0";}};
const toBase=(value:string,decimals:number)=>{const [whole="0",fraction=""]=value.trim().split(".");if(!/^\d+$/.test(whole)||fraction.length>decimals||!/^\d*$/.test(fraction))throw new Error(`Enter at most ${decimals} decimal places.`);return (BigInt(whole)*10n**BigInt(decimals)+BigInt((fraction+"0".repeat(decimals)).slice(0,decimals)||"0")).toString();};
const short=(s:string)=>s.length>24?`${s.slice(0,10)}…${s.slice(-8)}`:s;
const DEFAULT_WINDOW={days:[0,1,2,3,4,5,6],start:"00:00",end:"23:59",timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC"};

export default function App(){
  const [tab,setTab]=useState<Tab>("Overview");
  const [account,setAccount]=useState<WalletAccount|null>(null);
  const [assets,setAssets]=useState<Asset[]>([]);
  const [policy,setPolicy]=useState<AgentPolicy|null>(null);
  const [passwordSet,setPasswordSet]=useState(false);
  const [password,setPassword]=useState("");
  const [unlock,setUnlock]=useState("");
  const [assetsReady,setAssetsReady]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  const [agentOn,setAgentOn]=useState(false);
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
  const [autoRunning,setAutoRunning]=useState(false);
  const [showUnlock,setShowUnlock]=useState(false);
  const [showPassword,setShowPassword]=useState(false);
  const pollRef=useRef<number|undefined>(undefined);
  const from=useMemo(()=>assets.find(a=>a.assetId===fromId),[assets,fromId]);
  const to=useMemo(()=>assets.find(a=>a.assetId===toId),[assets,toId]);

  const loadDashboard=useCallback(async()=>{
    const me=await api.me();
    setPasswordSet(me.passwordSet);
    if(me.accountId)setAccount({accountId:me.accountId});
    const [assetData,policyData,eventData]=await Promise.all([api.assets(),api.policy(),api.events()]);
    const sorted=assetData.assets.sort((a,b)=>a.symbol.localeCompare(b.symbol));
    setAssets(sorted);setAssetsReady(true);setPolicy(policyData.policy?.body??null);setEvents(eventData.events);
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
    const onSignOut=()=>{setAccount(null);setPolicy(null);setAgentOn(false);};
    c.on("wallet:signOut",onSignOut);
    return()=>{c.off("wallet:signOut",onSignOut);};
  },[loadDashboard]);

  useEffect(()=>{if(!notice)return;const id=window.setTimeout(()=>setNotice(""),4500);return()=>window.clearTimeout(id);},[notice]);

  const fetchQuote=useCallback(async():Promise<QuoteView|null>=>{
    if(!account||!from||!to)return null;
    try{
      const isNear=(asset:Asset)=>asset.blockchain.toLowerCase()==="near";
      const target=recipient||(isNear(to)?account.accountId:"");
      const refund=refundTo||(isNear(from)?account.accountId:"");
      if(!target||!refund)throw new Error("Enter the destination and refund addresses for the selected chains before requesting a quote.");
      const input:QuoteInput={originAsset:from.assetId,destinationAsset:to.assetId,amount:toBase(amount,from.decimals),sender:account.accountId,refundTo:refund,recipient:target,slippageToleranceBps:Number(maxSlippage)};
      const data=await api.quote(input);setQuote(data.quote);
      if(policy){const result=await api.evaluate(data.quote.id);setDecision(result.decision);if(!result.decision.allowed){await api.events().then(v=>setEvents(v.events));}}
      return data.quote;
    }catch(e){setError(e instanceof Error?e.message:"Could not load a live quote.");return null;}
  },[account,from,to,amount,maxSlippage,policy,recipient,refundTo]);

  useEffect(()=>{
    if(!agentOn||!policy||policy.freeze||!account)return;
    void fetchQuote();
    pollRef.current=window.setInterval(()=>void fetchQuote(),12_000);
    return()=>{if(pollRef.current)window.clearInterval(pollRef.current);};
  },[agentOn,policy,account,fetchQuote]);

  const connect=async()=>{setBusy(true);setError("");try{const a=await connectWallet();const challenge=await api.walletChallenge(a.accountId);const signed=await signPolicy(challenge.message,challenge.recipient,challenge.nonce);await api.walletVerify({...signed,payload:{message:challenge.message,recipient:challenge.recipient,nonce:challenge.nonce}});setAccount(a);setNotice(`Connected ${a.accountId}`);await loadDashboard();}catch(e){setError(e instanceof Error?e.message:"Wallet connection failed.");}finally{setBusy(false);}};

  const savePassword=async()=>{setBusy(true);setError("");try{await api.savePassword(password);setPasswordSet(true);setShowPassword(false);setNotice("Unlock password saved. Keep it private.");}catch(e){setError(e instanceof Error?e.message:"Could not save password.");}finally{setBusy(false);}};

  const savePolicy=async()=>{
    if(!account||!from||!to)throw new Error("Connect a wallet and select the policy pair first.");
    if(!passwordSet)throw new Error("Create an unlock password before signing a policy.");
    if(!unlock)throw new Error("Enter your unlock password to authorize this policy change.");
    const isNear=(asset:Asset)=>asset.blockchain.toLowerCase()==="near";
    const allowedDestination=recipient||(isNear(to)?account.accountId:"");
    if(!allowedDestination)throw new Error("Enter a destination address for this chain before signing the policy.");
    const next:AgentPolicy={version:1,accountId:account.accountId,allowedPairs:[{from:from.assetId,to:to.assetId}],maxTradeAmount:toBase(maxTrade,from.decimals),dailyLimit:toBase(daily,from.decimals),weeklyLimit:toBase(weekly,from.decimals),allowedDestinations:[allowedDestination],timeWindows:[DEFAULT_WINDOW],maxSlippageBps:Number(maxSlippage),freeze:false,updatedAt:new Date().toISOString()};
    const challenge=await api.challenge(account.accountId);
    const message=`Pocket Near policy authorization\nAccount: ${account.accountId}\nNonce: ${challenge.nonce}\nPolicy: ${canonicalPolicy(next)}`;
    const signed=await signPolicy(message,challenge.recipient,challenge.nonce);
    await api.savePolicy(next,{...signed,payload:{message,recipient:challenge.recipient,nonce:challenge.nonce}},unlock);
    setPolicy(next);setUnlock("");setNotice("Policy saved and signed by your wallet.");
  };

  const toggleFreeze=async()=>{
    if(!policy)return;
    if(!unlock){setError("Enter your unlock password, then save a new signed policy to freeze or resume the agent.");setTab("Policy");return;}
    setBusy(true);setError("");
    try{
      const next={...policy,freeze:!policy.freeze,updatedAt:new Date().toISOString()};
      const challenge=await api.challenge(policy.accountId);
      const message=`Pocket Near policy authorization\nAccount: ${policy.accountId}\nNonce: ${challenge.nonce}\nPolicy: ${canonicalPolicy(next)}`;
      const signed=await signPolicy(message,challenge.recipient,challenge.nonce);
      await api.savePolicy(next,{...signed,payload:{message,recipient:challenge.recipient,nonce:challenge.nonce}},unlock);
      setPolicy(next);setAgentOn(!next.freeze);setNotice(next.freeze?"Emergency freeze is active.":"Policy updated; agent may run again.");
    }catch(e){setError(e instanceof Error?e.message:"Policy update failed.");}finally{setBusy(false);}
  };

  const runAgent=async()=>{setError("");setBusy(true);try{const fresh=await fetchQuote();if(fresh){const result=await api.evaluate(fresh.id,true);setDecision(result.decision);setShowUnlock(true);}}catch(e){setError(e instanceof Error?e.message:"Could not evaluate this request.");}finally{setBusy(false);}};
  const confirmAction=async()=>{if(!quote)return;setBusy(true);setError("");try{await api.execute(quote.id,unlock);setNotice("Wallet confirmation is required for every on-chain action.");}catch(e){setError(e instanceof Error?e.message:"Action could not be prepared.");}finally{setBusy(false);setShowUnlock(false);}};
  const refreshEvents=async()=>{try{setEvents((await api.events()).events);}catch(e){setError(e instanceof Error?e.message:"Could not refresh activity.");}};
  const safeToggleAgent=()=>{if(!policy){setError("Sign a policy before activating the agent.");setTab("Policy");return;}if(policy.freeze){setError("Emergency freeze is active. Sign an updated policy to resume.");return;}setAgentOn(v=>!v);setNotice(agentOn?"Agent paused.":"Agent watching live quotes.");};

  if(loading)return <main className="splash"><div className="brandmark">pn</div><span className="loader"/><p>Opening your pocket…</p></main>;
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brandmark">pn</div><div><strong>Pocket Near</strong><span>Personal intent desk</span></div></div><button className="icon-button" aria-label="Alerts" onClick={()=>setTab("Activity")}><Bell size={18}/><i/></button></header>
    <main className="content">
      {error&&<div className="alert error"><ShieldAlert size={17}/><span>{error}</span><button onClick={()=>setError("")} aria-label="Dismiss"><X size={15}/></button></div>}
      {notice&&<div className="alert success"><Check size={17}/><span>{notice}</span><button onClick={()=>setNotice("")} aria-label="Dismiss"><X size={15}/></button></div>}
      {tab==="Overview"&&<>
        <section className="greeting"><div><p className="eyebrow">YOUR ACCOUNT</p><h1>Good to see you.</h1></div><div className="secure-pill"><span/> Non-custodial</div></section>
        <section className="wallet-card">
          <div className="wallet-card-top"><div className="wallet-icon"><Wallet size={19}/></div><div className="wallet-meta"><span>Connected wallet</span><strong>{account?short(account.accountId):"Not connected"}</strong></div>{account?<button className="subtle-button" onClick={async()=>{await disconnectWallet();setAccount(null);}}>Disconnect</button>:<button className="connect-button" disabled={busy} onClick={()=>void connect()}>{busy?"Connecting…":"Connect wallet"}<ArrowRight size={15}/></button>}</div>
          <div className="wallet-card-bottom"><div><span className="tiny-label">INTENTS PORTFOLIO</span><p>{account?"Balances load when your Intents account is linked":"Connect your wallet to get started"}</p></div><span className="live-indicator"><i/> {account?"CONNECTED":"WAITING"}</span></div>
        </section>

        <div className="section-heading"><div><p className="eyebrow">LIVE SOLVER NETWORK</p><h2>Quote monitor</h2></div><button className="icon-button light" aria-label="Refresh quote" onClick={()=>void fetchQuote()} disabled={!account||busy}><RefreshCw size={16}/></button></div>
        <section className="quote-card">
          <div className="pair-line"><div className="asset-select"><select value={fromId} onChange={e=>setFromId(e.target.value)} aria-label="Origin asset">{assets.map(a=><option key={a.assetId} value={a.assetId}>{a.symbol} · {a.blockchain}</option>)}</select><ChevronDown size={14}/></div><button className="swap-directions" aria-label="Reverse pair" onClick={()=>{setFromId(toId);setToId(fromId);}}><ArrowDownUp size={16}/></button><div className="asset-select"><select value={toId} onChange={e=>setToId(e.target.value)} aria-label="Destination asset">{assets.map(a=><option key={a.assetId} value={a.assetId}>{a.symbol} · {a.blockchain}</option>)}</select><ChevronDown size={14}/></div></div>
          {to&&to.blockchain.toLowerCase()!=="near"&&<label className="field chain-address">Destination address · {to.blockchain}<input value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder={`Your ${to.blockchain} address`} autoComplete="off"/></label>}
          {from&&from.blockchain.toLowerCase()!=="near"&&<label className="field chain-address">Refund address · {from.blockchain}<input value={refundTo} onChange={e=>setRefundTo(e.target.value)} placeholder={`Your ${from.blockchain} address`} autoComplete="off"/></label>}
          <label className="amount-label">Amount<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} aria-label="Amount"/><span>{from?.symbol??""}</span></label>
          <button className="primary-button" onClick={()=>void fetchQuote()} disabled={!account||busy||!assetsReady}>{busy?<span className="loader small"/>:<Sparkles size={16}/>}Get live quote</button>
          {quote&&<div className="quote-result"><div className="result-head"><div><span className="eyebrow">ESTIMATED OUTPUT</span><strong>{quote.amountOutFormatted??fmt(quote.amountOut,to?.decimals??0)} <small>{to?.symbol}</small></strong></div><span className={`quote-state ${quote.stale?"stale":""}`}><i/>{quote.stale?"Cached":"Live"}</span></div><div className="quote-details"><div><span>Route</span><b>{quote.route.join(" → ")}</b></div><div><span>Fees</span><b>{quote.fees.length?quote.fees.map(f=>`${f.amount} ${f.asset}`).join(", "):"Included in quote"}</b></div><div><span>Slippage</span><b>{(quote.slippageBps/100).toFixed(2)}%</b></div><div><span>Expires</span><b><Clock3 size={12}/>{new Date(quote.expiresAt).toLocaleTimeString()}</b></div></div><div className={`policy-status ${decision?.allowed?"ok":"blocked"}`}><Shield size={15}/><span>{decision?.allowed?"Inside policy · wallet confirmation still required":decision?.reason??"Policy match pending"}</span></div><button className="preview-button" onClick={()=>void runAgent()} disabled={busy||!policy}>Review policy preview <ArrowRight size={14}/></button></div>}
          {!quote&&<div className="quote-empty"><Activity size={18}/><span>{account?"Request a quote to see current solver pricing":"Connect a wallet to request a quote"}</span></div>}
        </section>

        <section className={`agent-card ${agentOn?"active":""}`}><div className="agent-head"><div className="agent-orb"><Bot size={20}/></div><div className="agent-title"><span>POLICY AGENT</span><strong>{agentOn?"Watching for matches":"Agent is paused"}</strong></div><button className={`toggle ${agentOn?"on":""}`} onClick={safeToggleAgent} aria-label={agentOn?"Pause agent":"Start agent"}><i/></button></div><p className="agent-copy">The agent checks live quotes against your signed limits. It will never move funds without an in-wallet authorization.</p><div className="agent-footer"><span><i className={agentOn?"green":"gray"}/>{agentOn?"MONITORING":"IDLE"}</span><button onClick={()=>setTab("Policy")}>Review policy <ArrowRight size={14}/></button></div></section>
        <div className="section-heading compact"><div><p className="eyebrow">ACCOUNT SAFETY</p><h2>Your controls</h2></div></div>
        <section className="control-row"><div className="control-icon"><Fingerprint size={18}/></div><div><strong>Signed policy</strong><span>{policy?`${policy.allowedPairs.length} pair · ${(policy.maxSlippageBps/100).toFixed(2)}% slippage max`:"Set the agent's guardrails"}</span></div><button onClick={()=>setTab("Policy")}><ArrowRight size={16}/></button></section>
        <section className="control-row"><div className="control-icon warning"><ShieldAlert size={18}/></div><div><strong>Emergency freeze</strong><span>{policy?.freeze?"Agent is frozen":"Immediately pause all agent activity"}</span></div><button onClick={()=>void toggleFreeze()} disabled={!policy}><Pause size={15}/></button></section>
      </>}
      {tab==="Policy"&&<>
        <section className="page-title"><p className="eyebrow">AGENT SETTINGS</p><h1>Set your guardrails.</h1><p>Every amount and destination is checked before the agent evaluates a quote.</p></section>
        {!account&&<div className="alert info"><Wallet size={17}/>Connect your wallet before creating a signed policy.</div>}
        {!passwordSet&&<section className="form-card"><div className="form-title"><LockKeyhole size={17}/><div><strong>Create an unlock password</strong><span>Required before policy changes and freeze actions.</span></div></div><label className="field">New password<input type="password" minLength={10} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 10 characters"/></label><button className="secondary-button" disabled={busy||password.length<10} onClick={()=>void savePassword()}>Save password</button></section>}
        <section className="form-card"><div className="form-title"><Shield size={17}/><div><strong>Allowed pair</strong><span>The agent can evaluate this pair only.</span></div></div><div className="form-grid"><label className="field">From<select value={fromId} onChange={e=>setFromId(e.target.value)}>{assets.map(a=><option key={a.assetId} value={a.assetId}>{a.symbol} · {a.blockchain}</option>)}</select></label><label className="field">To<select value={toId} onChange={e=>setToId(e.target.value)}>{assets.map(a=><option key={a.assetId} value={a.assetId}>{a.symbol} · {a.blockchain}</option>)}</select></label></div><div className="form-grid"><label className="field">Maximum per trade ({from?.symbol})<input inputMode="decimal" value={maxTrade} onChange={e=>setMaxTrade(e.target.value)}/></label><label className="field">Daily limit ({from?.symbol})<input inputMode="decimal" value={daily} onChange={e=>setDaily(e.target.value)}/></label></div><div className="form-grid"><label className="field">Weekly limit ({from?.symbol})<input inputMode="decimal" value={weekly} onChange={e=>setWeekly(e.target.value)}/></label><label className="field">Maximum slippage<input inputMode="numeric" value={maxSlippage} onChange={e=>setMaxSlippage(e.target.value)}/><small>basis points (100 = 1%)</small></label></div><div className="destination"><div className="destination-icon"><Wallet size={15}/></div><div><span>Allowed destination</span><strong>{account?short(account.accountId):"Connect your wallet"}</strong></div><Check size={15}/></div><div className="window-note"><Clock3 size={15}/><span>Active every day · 00:00–23:59 ({DEFAULT_WINDOW.timezone})</span></div><label className="field password-field">Unlock password<input type="password" autoComplete="current-password" value={unlock} onChange={e=>setUnlock(e.target.value)} placeholder="Enter to authorize changes"/></label><div className="action-pair"><button className="secondary-button" disabled={busy||!account||!passwordSet} onClick={()=>void savePolicy()}><Fingerprint size={16}/>Sign and save policy</button><button className="freeze-button" disabled={busy||!policy} onClick={()=>void toggleFreeze()}>{policy?.freeze?<Play size={15}/>:<Pause size={15}/>} {policy?.freeze?"Resume":"Freeze"}</button></div></section>
        {policy&&<section className="signed-note"><Check size={15}/><span>Current policy is signed on {new Date(policy.updatedAt).toLocaleString()} for <b>{short(policy.accountId)}</b>.</span></section>}
        <div className="security-note"><CircleHelp size={17}/><p>Policy limits are enforced by Pocket Near's backend before an action is prepared. The NEAR Intents Verifier authorizes every registered key to act on the account; this app does not keep a delegated key or claim on-chain policy enforcement.</p></div>
      </>}
      {tab==="Activity"&&<><section className="page-title"><p className="eyebrow">RECENT EVENTS</p><h1>Activity</h1><p>Policy checks and account events from this session.</p></section><button className="secondary-button refresh-events" onClick={()=>void refreshEvents()}><RefreshCw size={15}/>Refresh activity</button>{events.length===0?<div className="empty-activity"><Activity size={24}/><strong>Nothing here yet</strong><span>Quote checks and agent events will appear here.</span></div>:<div className="event-list">{events.map((event,i)=><article className="event" key={`${event.created_at}-${i}`}><div className={`event-icon ${event.event_type}`}><Activity size={15}/></div><div><strong>{event.event_type.replaceAll("_"," ")}</strong><span>{String(event.details.reason??event.details.quoteId??"Policy event recorded")}</span></div><time>{new Date(event.created_at).toLocaleTimeString()}</time></article>)}</div>}</>}
    </main>
    <nav className="tabbar">{(["Overview","Policy","Activity"] as const).map((name,i)=><button key={name} className={tab===name?"selected":""} onClick={()=>setTab(name)}>{i===0?<Activity size={18}/>:i===1?<Shield size={18}/>:<Clock3 size={18}/>}<span>{name}</span></button>)}</nav>
    {showUnlock&&<div className="modal-backdrop" onClick={()=>setShowUnlock(false)}><section className="confirm-sheet" onClick={e=>e.stopPropagation()}><button className="close-modal" onClick={()=>setShowUnlock(false)}><X size={18}/></button><div className="modal-icon"><Shield size={20}/></div><p className="eyebrow">POLICY PREVIEW</p><h2>{decision?.allowed?"Quote is within your limits":"Quote is blocked"}</h2><p>{decision?.allowed?"This live quote fits the active signed policy. Your wallet must still confirm any on-chain action.":decision?.reason}</p><div className="modal-amount">{quote?fmt(quote.amountIn,from?.decimals??0):amount} <small>{from?.symbol}</small><ArrowRight size={15}/>{quote?fmt(quote.amountOut,to?.decimals??0):"—"} <small>{to?.symbol}</small></div><label className="field">Unlock password<input type="password" autoComplete="current-password" value={unlock} onChange={e=>setUnlock(e.target.value)} placeholder="Your unlock password"/></label><button className="primary-button" disabled={!decision?.allowed||busy||unlock.length<10} onClick={()=>void confirmAction()}><LockKeyhole size={16}/>{busy?"Checking policy…":"Continue to wallet confirmation"}</button><span className="wallet-disclaimer">No authorization key is stored by Pocket Near.</span></section></div>}
    {showPassword&&<div className="modal-backdrop" onClick={()=>setShowPassword(false)}><section className="confirm-sheet" onClick={e=>e.stopPropagation()}><button className="close-modal" onClick={()=>setShowPassword(false)}><X size={18}/></button><h2>Protect your session</h2><p>Your password is stored as a one-way salted hash and is required for policy updates.</p><label className="field">Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="primary-button" disabled={busy||password.length<10} onClick={()=>void savePassword()}>Save password</button></section></div>}
  </div>;
}
