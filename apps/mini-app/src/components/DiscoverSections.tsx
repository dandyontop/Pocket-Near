import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Bot, RefreshCw, Search, Star } from "lucide-react";
import type { EarnProtocol, ExploreApp, ExploreGame, MarketAgentCard, MarketAgentDetail } from "@pocket-near/shared";
import { api } from "../lib/api.js";

type Props = {
  mode:"earn"|"apps"|"agents";
  onOpenExternal:(url:string)=>void;
  onDiscover:(type:"app"|"game"|"earn",id:string,url:string)=>void;
  apps:ExploreApp[];
  earn:EarnProtocol[];
  games:ExploreGame[];
  exploreLoading:boolean;
  exploreError:string;
  onRefreshExplore:()=>void;
};

export function DiscoverSections({mode,onOpenExternal,onDiscover,apps,earn,games,exploreLoading,exploreError,onRefreshExplore}:Props){
  const [agents,setAgents]=useState<MarketAgentCard[]>([]);
  const [agentCategories,setAgentCategories]=useState<string[]>([]);
  const [agentQuery,setAgentQuery]=useState("");
  const [agentCategory,setAgentCategory]=useState("");
  const [agentCursor,setAgentCursor]=useState<string|null>(null);
  const [agentError,setAgentError]=useState("");
  const [agentLoading,setAgentLoading]=useState(false);
  const [selectedAgent,setSelectedAgent]=useState<MarketAgentDetail|null>(null);
  const [agentDetailLoading,setAgentDetailLoading]=useState("");
  const [appCategory,setAppCategory]=useState("");

  const loadAgents=async(reset=true,query=agentQuery,category=agentCategory)=>{
    setAgentLoading(true);setAgentError("");
    try{
      const result=await api.marketAgents(query,category,reset?null:agentCursor);
      setAgents(current=>reset?result.agents:[...current,...result.agents]);
      setAgentCursor(result.nextCursor);
      setAgentCategories(current=>[...new Set([...current,...result.agents.map(agent=>agent.category).filter((value):value is string=>Boolean(value))])]);
    }catch(error){setAgentError(error instanceof Error?error.message:"NEAR Agent Market is temporarily unavailable.");}
    finally{setAgentLoading(false);}
  };
  useEffect(()=>{if(mode==="agents")void loadAgents(true);},[mode]);
  const openAgentDetail=async(agent:MarketAgentCard)=>{
    setAgentDetailLoading(agent.id);
    try{setSelectedAgent((await api.marketAgent(agent.id)).agent);}
    catch(error){setAgentError(error instanceof Error?error.message:"Could not load agent details.");}
    finally{setAgentDetailLoading("");}
  };

  return <>
    <section className="page-title"><p className="eyebrow">EXPLORE</p><h1>{mode==="earn"?"Earn opportunities":mode==="agents"?"NEAR agents":"Apps & games"}</h1><p>{mode==="agents"?"Browse listings from NEAR Agent Market. Hiring and payment stay on the marketplace.":mode==="earn"?"Review current protocol and staking opportunities. Data and returns are not guaranteed.":"Discover ecosystem apps and games from the configured listings."}</p></section>
    {mode!=="agents"&&<section className="discover-content">
      {exploreLoading&&<div className="empty-activity"><span className="loader"/><strong>Loading ecosystem listings…</strong></div>}
      {exploreError&&<div className="alert error"><span>{exploreError}</span><button onClick={onRefreshExplore}>Retry</button></div>}
      {mode==="apps"&&<><div className="section-heading compact"><div><p className="eyebrow">ACTIVE APPS</p><h2>Explore NEAR</h2></div><button className="icon-button light" aria-label="Refresh app and game listings" onClick={onRefreshExplore} disabled={exploreLoading}><RefreshCw size={15}/></button></div>
      <div className="chip-row" aria-label="App categories"><button className={!appCategory?"chip active":"chip"} onClick={()=>setAppCategory("")}>All</button>{[...new Set(apps.map(app=>app.category))].map(category=><button key={category} className={appCategory===category?"chip active":"chip"} onClick={()=>setAppCategory(category)}>{category}</button>)}</div>
      {apps.length===0&&!exploreLoading&&!exploreError?<article className="coming-soon-card"><strong>No app listings available</strong><span>Try again when the ecosystem feed is available.</span></article>:apps.filter(app=>!appCategory||app.category===appCategory).length===0?<div className="empty-activity"><strong>No apps in this category</strong><span>Choose another category to view its listings.</span></div>:<div className="discover-list">{apps.filter(app=>!appCategory||app.category===appCategory).map(app=><article className="discover-card" key={app.id}>
        <div className="discover-top"><span className="rank-badge">{app.category}</span>{app.featured&&<span className="rank-badge featured"><Star size={11}/>Featured</span>}</div>
        <h2>{app.name}</h2><p>{app.blurb}</p>
        <div className="discover-actions"><button className="secondary-button" onClick={()=>onDiscover("app",app.id,app.url)}>Explore <ArrowUpRight size={14}/></button></div>
      </article>)}</div>}
      <div className="section-heading compact"><div><p className="eyebrow">GAMES</p><h2>Games on NEAR</h2></div></div>
      {games.length===0&&!exploreLoading&&!exploreError?<article className="coming-soon-card"><strong>No game listings available</strong><span>There are no current games in the feed.</span></article>:<div className="discover-list">{games.map(game=><article className="discover-card" key={game.id}>
        <div className="discover-top"><span className="rank-badge">Game</span></div><h2>{game.name}</h2><p>{game.blurb}</p>
        <div className="tag-list">{game.tags.join(" · ")}</div><div className="discover-actions"><button className="secondary-button" onClick={()=>onDiscover("game",game.id,game.url)}>Open <ArrowUpRight size={14}/></button></div>
      </article>)}</div>}</>}
      {mode==="earn"&&<><div className="section-heading compact"><div><p className="eyebrow">DEFI & EARN</p><h2>Available opportunities</h2></div><button className="icon-button light" aria-label="Refresh earn listings" onClick={onRefreshExplore} disabled={exploreLoading}><RefreshCw size={15}/></button></div>
      {earn.length===0&&!exploreLoading&&!exploreError?<article className="coming-soon-card"><strong>No earn listings available</strong><span>There are no current opportunities in the feed.</span></article>:<div className="discover-list">{earn.map(protocol=><article className="discover-card" key={protocol.id}>
        <div className="discover-top"><span className="rank-badge">{protocol.category}</span>{protocol.tvl>0&&<span className="rank-badge">TVL ${new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1}).format(protocol.tvl)}</span>}</div>
        <h2>{protocol.name}</h2><div className="discover-actions"><button className="secondary-button" onClick={()=>onDiscover("earn",protocol.id,protocol.url)}>Explore <ArrowUpRight size={14}/></button></div>
      </article>)}</div>}</>}
    </section>}
    {mode==="agents"&&<section className="discover-content">
      <div className="market-toolbar"><label className="field market-search"><Search size={15}/><input value={agentQuery} onChange={event=>setAgentQuery(event.target.value)} placeholder="Search agents" aria-label="Search agents" onKeyDown={event=>{if(event.key==="Enter")void loadAgents(true);}}/></label><button className="icon-button light" aria-label="Search agents" onClick={()=>void loadAgents(true)} disabled={agentLoading}><Search size={15}/></button></div>
      <div className="chip-row"><button className={agentCategory===""?"chip active":"chip"} onClick={()=>{setAgentCategory("");void loadAgents(true,agentQuery,"");}}>All</button>{agentCategories.map(category=><button key={category} className={agentCategory===category?"chip active":"chip"} onClick={()=>{setAgentCategory(category);void loadAgents(true,agentQuery,category);}}>{category}</button>)}</div>
      {agentError&&<div className="alert error"><span>{agentError}</span><button onClick={()=>void loadAgents(true)}>Retry</button></div>}
      {agents.length===0&&!agentLoading&&!agentError?<div className="empty-activity"><Bot size={24}/><strong>No listings found</strong><span>Try another search or open the official marketplace.</span><button className="secondary-button" onClick={()=>onOpenExternal("https://market.near.ai")}>Open NEAR Agent Market <ArrowUpRight size={14}/></button></div>:<div className="discover-list">{agents.map(agent=><article className="discover-card" key={agent.id}>
        <div className="discover-top"><div className="discover-icon"><Bot size={17}/></div><span className="rank-badge">{agent.category??"Agent"}</span></div>
        <h2>{agent.name}</h2><p>{agent.tagline}</p><p>{agent.priceLabel}</p><div className="tag-list">{agent.tags.join(" · ")}</div>
        <div className="discover-actions"><button className="secondary-button" disabled={agentDetailLoading===agent.id} onClick={()=>void openAgentDetail(agent)}>{agentDetailLoading===agent.id?"Loading…":"Details"} <ArrowRight size={14}/></button><button className="primary-button" onClick={()=>onOpenExternal(agent.hireUrl)}>Hire <ArrowUpRight size={14}/></button></div>
      </article>)}</div>}
      {agentLoading&&<div className="empty-activity"><span className="loader"/><strong>Loading listings…</strong></div>}
      {agentCursor&&<button className="secondary-button" disabled={agentLoading} onClick={()=>void loadAgents(false)}>Load more</button>}
      <p className="market-attribution">Listings from NEAR Agent Market</p>
      <button className="secondary-button" onClick={()=>onOpenExternal("https://market.near.ai")}>Open market.near.ai <ArrowUpRight size={14}/></button>
    </section>}
    {selectedAgent&&<div className="modal-backdrop" onClick={()=>setSelectedAgent(null)}><section className="confirm-sheet" onClick={event=>event.stopPropagation()}>
      <button className="icon-button light" aria-label="Close agent details" onClick={()=>setSelectedAgent(null)}>×</button><p className="eyebrow">NEAR AGENT MARKET</p><h2>{selectedAgent.name}</h2><p>{selectedAgent.description}</p>{selectedAgent.bioMarkdown&&<p>{selectedAgent.bioMarkdown}</p>}
      <div className="tag-list">{selectedAgent.tags.join(" · ")}</div><div className="discover-actions"><button className="secondary-button" onClick={()=>onOpenExternal(selectedAgent.detailUrl)}>Full details <ArrowUpRight size={14}/></button><button className="primary-button" onClick={()=>onOpenExternal(selectedAgent.hireUrl)}>Hire on Market <ArrowUpRight size={14}/></button></div>
    </section></div>}
  </>;
}
