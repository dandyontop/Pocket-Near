import type { ThesisReport } from "@pocket-near/shared";

const usd=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumSignificantDigits:6}).format(value);

export default function ThesisReportCard({thesis}:{thesis:ThesisReport}){
  return <div className="thesis-report" aria-live="polite">
    <p className="eyebrow">{thesis.source==="near-ai-cloud"?"NEAR AI CLOUD ANALYSIS":"RULES-BASED SNAPSHOT"} · {new Date(thesis.generatedAt).toLocaleString()}</p>
    <strong>{thesis.summary}</strong>
    <div className="thesis-facts">
      <span>NEAR price</span>
      <b>{thesis.facts.market.priceUsd===null?"Unavailable":usd(thesis.facts.market.priceUsd)}{thesis.facts.market.change24hPct===null?"":` · ${thesis.facts.market.change24hPct.toFixed(2)}% 24h`}</b>
      <small>Market source: {thesis.facts.market.source??"unavailable"}{thesis.facts.market.updatedAt?` · ${new Date(thesis.facts.market.updatedAt).toLocaleString()}`:""}</small>
      <span>Intents volume (24h)</span>
      <b>{thesis.facts.intents24h?`${usd(thesis.facts.intents24h.volumeUsd24h)} · ${thesis.facts.intents24h.txCount24h} transactions${thesis.facts.intents24h.partial?" · partial sample":""}`:"Unavailable"}</b>
      {thesis.facts.intents24h&&<small>Explorer window: {new Date(thesis.facts.intents24h.windowStart).toLocaleString()} – {new Date(thesis.facts.intents24h.windowEnd).toLocaleString()} · updated {new Date(thesis.facts.intents24h.updatedAt).toLocaleString()}</small>}
    </div>
    {thesis.facts.unavailable.length>0&&<small>Unavailable data: {thesis.facts.unavailable.join(" ")}</small>}
    {(["bull","bear","risks","whatToVerify"] as const).map((section,index)=><div className="thesis-section" key={section}>
      <b>{["Positive evidence","Counter-evidence","Risks","What to verify"][index]}</b>
      <ul>{thesis[section].map((item,itemIndex)=><li key={`${section}-${itemIndex}`}>{item}</li>)}</ul>
    </div>)}
    {thesis.note&&<small>{thesis.note}</small>}
    <p className="thesis-disclaimer">Not financial advice. Do your own research. AI commentary is not independently verified or attested by Pocket Near.</p>
  </div>;
}
