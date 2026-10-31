import { NearConnector } from "@hot-labs/near-connect";

export interface WalletAccount { accountId:string; publicKey?:string; signedMessage?:SignedMessage }
export interface SignedMessage { accountId:string; publicKey:string; signature:string; }
type Wallet = { signMessage:(args:{message:string;recipient:string;nonce:Uint8Array})=>Promise<SignedMessage>; signAndSendTransaction?:(args:unknown)=>Promise<unknown> };
let connector:NearConnector|undefined;
let activeWallet:Wallet|undefined;
export function getConnector(){return connector??=(new NearConnector({features:{signMessage:true,testnet:false}}));}
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
export async function disconnectWallet(){
  if(connector){await connector.disconnect();activeWallet=undefined;}
}
