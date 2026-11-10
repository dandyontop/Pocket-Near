import { NearConnector } from "@hot-labs/near-connect";

export interface WalletAccount { accountId:string; publicKey?:string; signedMessage?:SignedMessage }
export interface SignedMessage { accountId:string; publicKey:string; signature:string; }
type Wallet = { signMessage:(args:{message:string;recipient:string;nonce:Uint8Array})=>Promise<SignedMessage>; signAndSendTransaction?:(args:unknown)=>Promise<unknown> };
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
export async function disconnectWallet(){
  activeWallet=undefined;
  if(connector)await connector.disconnect();
}
