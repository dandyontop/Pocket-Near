import type { MemeBoardAsset } from "@pocket-near/shared";

export function getRheaMarketRiskFlags(asset:MemeBoardAsset):string[]{
  const flags:string[]=[];
  if(asset.frozen===true)flags.push("Listed on Rhea's token-freeze list.");
  else if(asset.frozen!==false)flags.push("Rhea token-freeze status is unavailable.");
  if(asset.liquidityUsd==null)flags.push("Pool liquidity is unavailable.");
  else if(asset.liquidityUsd<10_000)flags.push("Reported pool liquidity is below $10,000.");
  if(asset.volume24hUsd==null)flags.push("24-hour volume is unavailable.");
  else if(asset.volume24hUsd<100)flags.push("Reported 24-hour volume is below $100.");
  if(asset.trades24h==null)flags.push("24-hour trade count is unavailable.");
  else if(asset.trades24h<3)flags.push("Fewer than 3 trades were reported in 24 hours.");
  if(asset.priceChange24hPct==null)flags.push("24-hour price movement is unavailable.");
  else if(Math.abs(asset.priceChange24hPct)>=20)flags.push("Reported 24-hour price movement is at least 20%.");
  return flags;
}
