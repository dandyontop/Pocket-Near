import { NearConnector } from "@hot-labs/near-connect";

export interface WalletAccount { accountId:string; publicKey?:string; signedMessage?:SignedMessage }
export interface SignedMessage { accountId:string; publicKey:string; signature:string; }
type Wallet = { signMessage:(args:{message:string;recipient:string;nonce:Uint8Array})=>Promise<SignedMessage>; signAndSendTransaction?:(args:{receiverId:string;actions:Array<{type:"FunctionCall";params:{methodName:string;args:Record<string,unknown>;gas:string;deposit:string}}>})=>Promise<unknown> };
let connector:NearConnector|undefined;
let activeWallet:Wallet|undefined;
export function getConnector(){return connector??=(new NearConnector({features:{signMessage:true,testnet:false}}));}
export async function restoreWallet():Promise<WalletAccount|null>{
  try{
    const {wallet,accounts}=await getConnector().getConnectedWallet();
    const account=accounts[0];
    if(!account)return null;
    activeWallet=wallet as Wallet;
    return {accountId:account.accountId,...(account.publicKey?{publicKey:account.publicKey}:{})};
  }catch(error){
    const message=error instanceof Error?error.message:"";
    if(message==="No wallet selected"||message==="No accounts found"){activeWallet=undefined;return null;}
    throw error;
  }
}
export async function connectWallet():Promise<WalletAccount>{
  const c=getConnector();
  let resolveAccount:(value:WalletAccount)=>void=()=>{};
  const accountEvent=new Promise<WalletAccount>((resolve)=>{resolveAccount=resolve;});
  const onSignIn=(event:{accounts?:Array<{accountId:string;publicKey?:string}>})=>{
    const a=event.accounts?.[0];
    if(a)resolveAccount({accountId:a.accountId,...(a.publicKey?{publicKey:a.publicKey}:{})});
  };
  c.on("wallet:signIn",onSignIn);
  await c.connect();
  const wallet=await c.wallet() as Wallet;
  activeWallet=wallet;
  const timeout=new Promise<never>((_,reject)=>window.setTimeout(()=>reject(new Error("Wallet did not return an account.")),15_000));
  try{return await Promise.race([accountEvent,timeout]);}
  finally{c.off("wallet:signIn",onSignIn);}
}
export async function signPolicy(message:string,recipient:string,nonce:string):Promise<SignedMessage>{
  if(!activeWallet)throw new Error("Connect your wallet before signing the policy.");
  const raw=atob(nonce);
  const signed=await activeWallet.signMessage({message,recipient,nonce:Uint8Array.from(raw,c=>c.charCodeAt(0))});
  return signed;
}
export async function executeRheaSwap(input:{accountId:string;tokenIn:string;amount:string;msg:string;signature:string}):Promise<unknown>{
  if(!activeWallet?.signAndSendTransaction)throw new Error("The connected wallet does not support transaction signing. Reconnect with a NEAR wallet that supports function calls.");
  if(!/^[a-z0-9._-]+$/.test(input.tokenIn)||!/^[1-9]\d*$/.test(input.amount)||!input.msg||!input.signature)throw new Error("Rhea route data is incomplete or invalid. Request a fresh quote.");
  return activeWallet.signAndSendTransaction({receiverId:input.tokenIn,actions:[{type:"FunctionCall",params:{methodName:"ft_transfer_call",args:{receiver_id:"aggregatedex.near",amount:input.amount,msg:JSON.stringify({msg:input.msg,signature:input.signature})},gas:"300000000000000",deposit:"1"}}]});
}
export async function registerRheaRoute(input:{accountId:string;missingTokens:string[];missingStorage:Array<{token:string;accountId:string}>}):Promise<void>{
  if(!activeWallet?.signAndSendTransaction)throw new Error("The connected wallet does not support NEAR transactions.");
  const uniqueTokens=[...new Set(input.missingTokens)];
  if(uniqueTokens.length){
    await activeWallet.signAndSendTransaction({receiverId:"aggregatedex.near",actions:[{type:"FunctionCall",params:{methodName:"tokens_storage_deposit",args:{user:input.accountId,tokens:uniqueTokens},gas:"100000000000000",deposit:(5_000_000_000_000_000_000_000n*BigInt(uniqueTokens.length)).toString()}}]});
  }
  for(const item of input.missingStorage){
    if(!/^[a-z0-9._-]+$/.test(item.token)||item.accountId!==input.accountId&&item.accountId!=="aggregatedexstg.near/user")throw new Error("Rhea registration preflight returned an invalid storage account.");
    await activeWallet.signAndSendTransaction({receiverId:item.token,actions:[{type:"FunctionCall",params:{methodName:"storage_deposit",args:{account_id:item.accountId,registration_only:true},gas:"30000000000000",deposit:"5000000000000000000000"}}]});
  }
}
export async function disconnectWallet(){
  activeWallet=undefined;
  if(connector)await connector.disconnect();
}
