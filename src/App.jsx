import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { BrowserProvider, Contract, parseUnits, formatUnits, MaxUint256 } from 'ethers';
import { SWAP_ADDRESS, ASH_ADDRESS, USDC_ADDRESS, ASH_PER_USDC, SWAP_ABI, ERC20_ABI } from './config/contracts';

const BASE_CHAIN_ID = 8453;
const BASE_HEX = '0x2105';
const BASE_PARAMS = { chainId: BASE_HEX, chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'] };
const USDC = { address: USDC_ADDRESS, symbol: 'USDC', decimals: 6 };
const ASH = { address: ASH_ADDRESS, symbol: 'ASH', decimals: 18 };
const short = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
const eth = () => (typeof window !== 'undefined' ? window.ethereum : undefined);

function App() {
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [usdcBal, setUsdcBal] = useState('0');
  const [ashBal, setAshBal] = useState('0');
  const [dir, setDir] = useState('USDC_TO_ASH');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('idle');
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);

  const isUsdcToAsh = dir === 'USDC_TO_ASH';
  const isOnBase = chainId === BASE_CHAIN_ID;
  const fromBal = isUsdcToAsh ? usdcBal : ashBal;
  const toBal = isUsdcToAsh ? ashBal : usdcBal;

  const out = useMemo(() => {
    const v = parseFloat(amount);
    if (!v || v <= 0) return '';
    const r = isUsdcToAsh ? v * ASH_PER_USDC : v / ASH_PER_USDC;
    return r.toLocaleString('en-US', { maximumFractionDigits: 6 });
  }, [amount, isUsdcToAsh]);

  const refresh = useCallback(async (acc) => {
    const e = eth(); const account = acc || address;
    if (!e || !account) return;
    try {
      const p = new BrowserProvider(e);
      const u = new Contract(USDC.address, ERC20_ABI, p);
      const a = new Contract(ASH.address, ERC20_ABI, p);
      const [ur, ar] = await Promise.all([u.balanceOf(account), a.balanceOf(account)]);
      setUsdcBal(formatUnits(ur, USDC.decimals));
      setAshBal(formatUnits(ar, ASH.decimals));
    } catch (e2) {}
  }, [address]);

  const switchToBase = useCallback(async () => {
    const e = eth(); if (!e) return;
    try { await e.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_HEX }] }); }
    catch (err) { if (err && err.code === 4902) await e.request({ method: 'wallet_addEthereumChain', params: [BASE_PARAMS] }); }
  }, []);

  const connect = useCallback(async () => {
    const e = eth();
    if (!e) { setError('Nessun wallet trovato. Installa MetaMask.'); return; }
    try {
      const accs = await e.request({ method: 'eth_requestAccounts' });
      const cidHex = await e.request({ method: 'eth_chainId' });
      const cid = parseInt(cidHex, 16);
      setAddress(accs[0]); setChainId(cid);
      if (cid !== BASE_CHAIN_ID) await switchToBase();
      await refresh(accs[0]);
    } catch (err) { setError((err && err.message) || 'Connessione rifiutata'); }
  }, [refresh, switchToBase]);

  useEffect(() => {
    const e = eth(); if (!e || !e.on) return;
    const onAcc = (a) => { setAddress(a[0] || null); if (a[0]) refresh(a[0]); };
    const onChain = (c) => setChainId(parseInt(c, 16));
    e.on('accountsChanged', onAcc); e.on('chainChanged', onChain);
    return () => { e.removeListener && e.removeListener('accountsChanged', onAcc); e.removeListener && e.removeListener('chainChanged', onChain); };
  }, [refresh]);

  const toggle = () => { setDir((d) => d === 'USDC_TO_ASH' ? 'ASH_TO_USDC' : 'USDC_TO_ASH'); setAmount(''); };

  const busy = status === 'approving' || status === 'swapping';
  const canSwap = address && isOnBase && parseFloat(amount) > 0 && !busy;

  const execute = async () => {
    const e = eth(); if (!e) return;
    try {
      setError(null); setTxHash(null);
      const p = new BrowserProvider(e);
      const signer = await p.getSigner();
      const inTok = isUsdcToAsh ? USDC : ASH;
      const amtIn = parseUnits(amount, inTok.decimals);
      const erc = new Contract(inTok.address, ERC20_ABI, signer);
      const owner = await signer.getAddress();
      const allow = await erc.allowance(owner, SWAP_ADDRESS);
      if (allow < amtIn) { setStatus('approving'); const at = await erc.approve(SWAP_ADDRESS, MaxUint256); await at.wait(); }
      setStatus('swapping');
      const swap = new Contract(SWAP_ADDRESS, SWAP_ABI, signer);
      const tx = isUsdcToAsh ? await swap.buy(amtIn) : await swap.sell(amtIn);
      setTxHash(tx.hash); await tx.wait();
      setStatus('success'); setAmount(''); refresh();
    } catch (err) { setError((err && (err.shortMessage || err.message)) || 'Swap fallito'); setStatus('error'); }
  };

  const label = () => {
    if (status === 'approving') return 'Approvazione…';
    if (status === 'swapping') return 'Swap in corso…';
    if (!(parseFloat(amount) > 0)) return 'Inserisci un importo';
    return 'Swap';
  };

  const Pill = ({ ash }) => (<div className='pill'><span>{ash ? '🔥' : '$'}</span>{ash ? 'ASH' : 'USDC'}</div>);

  return (
    <div className='page'><div className='card'>
      <div className='head'>
        <h1 className='title'>🔥 ASH Swap</h1>
        <button className='conn' onClick={connect}>{address ? short(address) : 'Connetti Wallet'}</button>
      </div>
      <div className='field'>
        <div className='frow'><span className='lbl'>Paghi</span><span className='bal'>Saldo: {parseFloat(fromBal).toLocaleString('en-US', { maximumFractionDigits: 4 })}</span></div>
        <div className='frow'><input className='inp' type='number' min='0' placeholder='0.0' value={amount} onChange={(e) => setAmount(e.target.value)} /><Pill ash={!isUsdcToAsh} /></div>
      </div>
      <div className='swc'><button className='sw' onClick={toggle}>↓</button></div>
      <div className='field'>
        <div className='frow'><span className='lbl'>Ricevi</span><span className='bal'>Saldo: {parseFloat(toBal).toLocaleString('en-US', { maximumFractionDigits: 4 })}</span></div>
        <div className='frow'><input className='inp' type='text' placeholder='0.0' value={out} readOnly /><Pill ash={isUsdcToAsh} /></div>
      </div>
      <div className='rate'><span>Prezzo fisso</span><span>1 USDC = {ASH_PER_USDC} ASH</span></div>
      {!address ? (<button className='act' onClick={connect}>Connetti Wallet</button>)
        : !isOnBase ? (<button className='act' onClick={switchToBase}>Passa alla rete Base</button>)
        : (<button className='act' disabled={!canSwap} onClick={execute}>{label()}</button>)}
      {error && <div className='err'>{error}</div>}
      {status === 'success' && txHash && <a className='ok' href={'https://basescan.org/tx/' + txHash} target='_blank' rel='noreferrer'>✅ Swap completato! Vedi su BaseScan</a>}
      <div className='note'>Swap a prezzo fisso USDC ↔ ASH sulla rete Base.<br/>Contratto: {short(SWAP_ADDRESS)}</div>
    </div></div>
  );
}

export default App;
