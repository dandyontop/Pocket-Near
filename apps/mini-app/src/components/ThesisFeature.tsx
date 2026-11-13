import { useState } from "react";
import { Sparkles } from "lucide-react";
import { api } from "../lib/api.js";
import type { ThesisReport } from "@pocket-near/shared";
import ThesisReportCard from "./ThesisReportCard.js";

export default function ThesisFeature(){
  const [thesis,setThesis]=useState<ThesisReport|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const generate=async()=>{
    setLoading(true);setError("");
    try{setThesis(await api.thesis());}
    catch(e){setError(e instanceof Error?e.message:"Research thesis could not be generated.");}
    finally{setLoading(false);}
  };
  return <>
    <div className="agent-footer"><button onClick={()=>void generate()} disabled={loading}>{loading?<span className="loader small"/>:<Sparkles size={14}/>}Generate NEAR research thesis</button></div>
    {error&&<div className="execution-status error" role="alert"><span>{error}</span><button className="secondary-button" onClick={()=>void generate()} disabled={loading}>Retry</button></div>}
    {thesis&&<ThesisReportCard thesis={thesis}/>}
  </>;
}
